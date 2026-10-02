// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: relay-transport runs the direct carrier; un-negotiated pass-through and old/new pairs (criterion 3).
import { afterEach, describe, expect, test } from "vitest";
import type pino from "pino";
import {
  createChunkerTransportFactory,
  createClientChannel,
  createDirectCarrierTransportFactory,
  type DirectCarrierTransport,
  type EncryptedChannel,
  type Transport,
} from "@getrambla/relay/e2ee";
import { exportPublicKey, generateKeyPair } from "@getrambla/relay";
import { startRelayTransport } from "./relay-transport";
import {
  MAX_PHYSICAL_SOCKET_BUFFERED_BYTES,
  sendBoundedPhysicalFrameAndWait,
} from "./websocket/physical-socket.js";

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

/** Silent pino stand-in. */
function createLogger(): pino.Logger {
  const logger = {
    child: () => logger,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return logger as unknown as pino.Logger;
}

/** Fake relay socket in the `ws` shape `startRelayTransport` creates. */
class FakeRelayWebSocket {
  readyState = 0;
  bufferedAmount = 0;
  sent: Frame[] = [];
  deferSendCompletion = false;
  onSend: ((data: Frame) => void) | null = null;
  private readonly listeners = new Map<string, Listener[]>();
  private readonly pendingCallbacks: Array<(error?: Error) => void> = [];

  constructor(readonly url: string) {}

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  once(event: string, listener: Listener): void {
    this.on(event, listener);
  }

  send(data: Frame, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    this.onSend?.(data);
    if (!callback) return;
    if (this.deferSendCompletion) {
      this.pendingCallbacks.push(callback);
      return;
    }
    callback();
  }

  completeNextSend(): void {
    this.pendingCallbacks.shift()?.();
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", 1000, "");
  }

  terminate(): void {
    this.close();
  }

  ping(): void {}

  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  message(data: unknown, isBinary: boolean): void {
    this.emit("message", data, isBinary);
  }

  private emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

interface AttachedSocket {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send: (data: string | Uint8Array | ArrayBuffer) => void | Promise<void>;
  on: (event: "message", listener: Listener) => void;
}

interface Harness {
  dataSocket: FakeRelayWebSocket;
  daemonPublicKeyB64: string;
  attached: Promise<AttachedSocket>;
}

const controllers: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(controllers.map((controller) => controller.stop()));
  controllers.length = 0;
});

/** Starts an encrypted relay transport and opens one client data socket on it. */
function startHarness(): Harness {
  const sockets: FakeRelayWebSocket[] = [];
  const daemonKeyPair = generateKeyPair();
  let resolveAttached: ((socket: AttachedSocket) => void) | undefined;
  const attached = new Promise<AttachedSocket>((resolve) => {
    resolveAttached = resolve;
  });
  controllers.push(
    startRelayTransport({
      logger: createLogger(),
      attachSocket: async (socket) => resolveAttached?.(socket as unknown as AttachedSocket),
      relayEndpoint: "relay.rambla.sh:443",
      relayUseTls: true,
      serverId: "srv_test",
      daemonKeyPair,
      createWebSocket: (url) => {
        const socket = new FakeRelayWebSocket(url);
        sockets.push(socket);
        return socket;
      },
    }),
  );
  const control = sockets[0];
  control.open();
  control.message(JSON.stringify({ type: "sync", connectionIds: [] }), false);
  control.message(JSON.stringify({ type: "connected", connectionId: "clt_test" }), false);
  const dataSocket = sockets[1];
  dataSocket.open();
  return {
    dataSocket,
    daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
    attached,
  };
}

/** Client transport that talks straight to the data socket, as a client without the carrier does. */
function oldClientTransport(dataSocket: FakeRelayWebSocket, clientSent: Frame[]): Transport {
  const transport: Transport = {
    send: (data) => {
      clientSent.push(data);
      dataSocket.message(data, data instanceof ArrayBuffer);
    },
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  dataSocket.onSend = (data) => {
    transport.onmessage?.({
      data: data instanceof Uint8Array ? data.slice().buffer : data,
      isBinary: typeof data !== "string",
    });
  };
  return transport;
}

/** Client transport over the relay package's carrier factory, as a new client has. */
function newClientTransport(dataSocket: FakeRelayWebSocket): {
  transport: Transport;
  carrier: DirectCarrierTransport;
} {
  const handlers = new Set<(data: unknown, isBinary: boolean) => void>();
  const factory = createDirectCarrierTransportFactory({
    offer: true,
    baseFactory: () => ({
      send: (data) => dataSocket.message(data, typeof data !== "string"),
      close: () => undefined,
      onMessage: (handler) => {
        handlers.add(handler);
        return () => undefined;
      },
      onOpen: () => () => undefined,
      onClose: () => () => undefined,
      onError: () => () => undefined,
    }),
  });
  const carrier = factory({ url: dataSocket.url });
  dataSocket.onSend = (data) => {
    const payload = data instanceof Uint8Array ? data.slice().buffer : data;
    for (const handler of handlers) handler(payload, typeof data !== "string");
  };
  const transport: Transport = {
    send: (data) => carrier.send(data),
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  carrier.onMessage((data, isBinary) => {
    transport.onmessage?.({ data: data as string | ArrayBuffer, isBinary });
  });
  return { transport, carrier };
}

/** Opens the client's E2EE channel and waits until the daemon has attached its socket. */
async function connectClient(harness: Harness, transport: Transport) {
  const clientReceived: Array<string | ArrayBuffer> = [];
  let resolveOpen: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const channel = await createClientChannel(transport, harness.daemonPublicKeyB64, {
    onopen: () => resolveOpen?.(),
    onmessage: (data) => clientReceived.push(data),
  });
  await opened;
  const attached = await harness.attached;
  const daemonReceived: unknown[] = [];
  attached.on("message", (data) => daemonReceived.push(data));
  return { channel, attached, clientReceived, daemonReceived };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function bytes(data: unknown): number[] {
  if (data instanceof ArrayBuffer) return Array.from(new Uint8Array(data));
  if (data instanceof Uint8Array) return Array.from(data);
  throw new Error("expected bytes");
}

describe("relay-transport with the direct carrier, un-negotiated", () => {
  test("an old client connects and its frames pass through byte for byte and in order", async () => {
    const harness = startHarness();
    const clientSent: Frame[] = [];
    const { channel, attached, clientReceived, daemonReceived } = await connectClient(
      harness,
      oldClientTransport(harness.dataSocket, clientSent),
    );

    expect(harness.dataSocket.sent[0]).toBe(
      JSON.stringify({ type: "e2ee_ready", capabilities: { binaryCiphertext: true } }),
    );

    const sentBefore = harness.dataSocket.sent.length;
    await channel.send("client 1");
    await channel.send(new Uint8Array([1, 2]).buffer);
    await channel.send("client 2");
    await attached.send("daemon 1");
    await attached.send(new Uint8Array([3, 4]));
    await attached.send("daemon 2");
    await settle();

    expect(daemonReceived[0]).toBe("client 1");
    expect(bytes(daemonReceived[1])).toEqual([1, 2]);
    expect(daemonReceived[2]).toBe("client 2");
    expect(clientReceived[0]).toBe("daemon 1");
    expect(bytes(clientReceived[1])).toEqual([3, 4]);
    expect(clientReceived[2]).toBe("daemon 2");
    // Ciphertext is authenticated, so any byte the carrier changed would fail to decrypt.
    expect(harness.dataSocket.sent.length - sentBefore).toBe(3);
    expect(clientReceived).toHaveLength(3);
    expect(daemonReceived).toHaveLength(3);
  });

  test("encrypted sends still wait for the relay socket's completion callback", async () => {
    const harness = startHarness();
    harness.dataSocket.deferSendCompletion = true;
    const transport = oldClientTransport(harness.dataSocket, []);
    const opening = connectClient(harness, transport);
    await settle();
    harness.dataSocket.completeNextSend();
    const { attached } = await opening;

    let completed = false;
    const sending = Promise.resolve(attached.send(new Uint8Array([1, 2, 3]))).then(() => {
      completed = true;
      return undefined;
    });
    await settle();
    expect(completed).toBe(false);

    harness.dataSocket.completeNextSend();
    await sending;
    expect(completed).toBe(true);
  });
});

// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: chunking over the relay and the 64 MiB high-water close.
/** New client with its chunker over the E2EE channel, stacked as daemon-client stacks them. */
async function connectChunkedClient(harness: Harness) {
  let channel: EncryptedChannel | null = null;
  let client: ReturnType<typeof newClientTransport> | null = null;
  const handlers = new Set<(data: unknown, isBinary: boolean) => void>();
  const factory = createChunkerTransportFactory(() => {
    client = newClientTransport(harness.dataSocket);
    return {
      send: (data) => {
        void channel?.send(data instanceof Uint8Array ? data.slice().buffer : data);
      },
      close: () => undefined,
      onMessage: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      onOpen: () => () => undefined,
      onClose: () => () => undefined,
      onError: () => () => undefined,
    };
  });
  const app = factory({ url: harness.dataSocket.url });
  const clientReceived: unknown[] = [];
  app.onMessage((data) => clientReceived.push(data));
  const { carrier, transport } = client as unknown as ReturnType<typeof newClientTransport>;
  let resolveOpen: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  channel = await createClientChannel(transport, harness.daemonPublicKeyB64, {
    onopen: () => resolveOpen?.(),
    onmessage: (data) => {
      for (const handler of handlers) handler(data, data instanceof ArrayBuffer);
    },
  });
  await opened;
  const attached = await harness.attached;
  const daemonReceived: unknown[] = [];
  attached.on("message", (data) => daemonReceived.push(data));
  return { app, attached, carrier, clientReceived, daemonReceived };
}

function patterned(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

/** Byte-for-byte comparison; `toEqual` on multi-MiB arrays outlasts the test timeout. */
function sameBytes(data: unknown, expected: Uint8Array): boolean {
  const actual = new Uint8Array(data as ArrayBuffer);
  if (actual.byteLength !== expected.byteLength) return false;
  for (let i = 0; i < actual.byteLength; i += 1) if (actual[i] !== expected[i]) return false;
  return true;
}

function wireBytes(frame: Frame): number {
  return typeof frame === "string" ? Buffer.byteLength(frame) : frame.byteLength;
}

describe("relay-transport with the chunker, negotiated", () => {
  test("a new client negotiates the carrier on the relay, and messages flow through both chunkers", async () => {
    const harness = startHarness();
    const { app, attached, carrier, clientReceived, daemonReceived } =
      await connectChunkedClient(harness);

    expect(carrier.negotiated).toBe(true);

    app.send("client 1");
    await attached.send("daemon 1");
    await settle();
    expect(daemonReceived).toEqual(["client 1"]);
    expect(clientReceived).toEqual(["daemon 1"]);
  });

  test("a 5 MiB message crosses the relay in chunks of at most 64 KiB, in both directions", async () => {
    const harness = startHarness();
    const { app, attached, clientReceived, daemonReceived } = await connectChunkedClient(harness);
    const fromClient = patterned(5 * 1024 * 1024, 11);
    const fromDaemon = patterned(5 * 1024 * 1024, 5);

    const clientFrames: Frame[] = [];
    const deliver = harness.dataSocket.message.bind(harness.dataSocket);
    harness.dataSocket.message = (data, isBinary) => {
      clientFrames.push(data as Frame);
      deliver(data, isBinary);
    };
    app.send(fromClient);
    app.send("after client");
    const sentBefore = harness.dataSocket.sent.length;
    await attached.send(fromDaemon);
    await attached.send("after daemon");
    await settle();

    const daemonFrames = harness.dataSocket.sent.slice(sentBefore);
    expect(clientFrames.length).toBeGreaterThan(80);
    expect(daemonFrames.length).toBeGreaterThan(80);
    for (const frame of [...clientFrames, ...daemonFrames]) {
      expect(wireBytes(frame)).toBeLessThanOrEqual(64 * 1024);
    }
    expect(daemonReceived).toHaveLength(2);
    expect(sameBytes(daemonReceived[0], fromClient)).toBe(true);
    expect(daemonReceived[1]).toBe("after client");
    expect(clientReceived).toHaveLength(2);
    expect(sameBytes(clientReceived[0], fromDaemon)).toBe(true);
    expect(clientReceived[1]).toBe("after daemon");
  });

  test("a relay socket over 64 MiB buffered fails the daemon's capacity check, which closes it", async () => {
    const harness = startHarness();
    const { attached } = await connectChunkedClient(harness);

    harness.dataSocket.bufferedAmount = MAX_PHYSICAL_SOCKET_BUFFERED_BYTES + 1;
    let highWater = 0;
    const sent = await sendBoundedPhysicalFrameAndWait({
      socket: attached,
      frame: "status",
      onHighWater: () => {
        highWater += 1;
      },
    });
    expect(sent).toBe(false);
    expect(highWater).toBe(1);
  });

  test("a large message that crosses 64 MiB buffered mid-transfer closes the relay socket", async () => {
    const harness = startHarness();
    const { attached } = await connectChunkedClient(harness);
    const sentBefore = harness.dataSocket.sent.length;
    const send = harness.dataSocket.send.bind(harness.dataSocket);
    // A relay that never drains: every frame sent stays buffered.
    harness.dataSocket.send = (data, callback) => {
      harness.dataSocket.bufferedAmount += wireBytes(data);
      send(data, callback);
    };

    harness.dataSocket.bufferedAmount = MAX_PHYSICAL_SOCKET_BUFFERED_BYTES - 100 * 1024;
    await expect(attached.send(patterned(5 * 1024 * 1024, 1))).rejects.toThrow(/high-water/);

    expect(harness.dataSocket.readyState).toBe(3);
    expect(attached.readyState).toBe(3);
    expect(harness.dataSocket.sent.length - sentBefore).toBeGreaterThan(0);
    expect(harness.dataSocket.sent.length - sentBefore).toBeLessThan(3);
  });
});
