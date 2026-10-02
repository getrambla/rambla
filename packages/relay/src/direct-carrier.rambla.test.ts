// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: carrier negotiation and un-negotiated pass-through (criterion 3).
import { describe, expect, it } from "vitest";
import {
  createDaemonDirectCarrier,
  createDirectCarrierTransportFactory,
  type DirectCarrierBaseTransport,
  type DirectCarrierSocket,
  type DirectCarrierTransport,
} from "./direct-carrier.rambla.js";
import { createClientChannel, createDaemonChannel, type Transport } from "./encrypted-channel.js";
import { exportPublicKey, generateKeyPair } from "./crypto.js";

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

/** Fake daemon-side relay data socket in the `ws` shape the server hands the carrier. */
class FakeDaemonSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: Frame[] = [];
  deferSendCompletion = false;
  peer: FakeClientBase | null = null;
  private readonly pendingCallbacks: Array<(error?: Error) => void> = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  once(event: string, listener: Listener): void {
    this.on(event, listener);
  }

  send(data: Frame, callback?: (error?: Error) => void): void {
    this.sent.push(data);
    this.peer?.deliver(data);
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
  }

  terminate(): void {
    this.readyState = 3;
  }

  ping(): void {}

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

/** Fake client-side base transport in the client's `DaemonTransport` shape. */
class FakeClientBase implements DirectCarrierBaseTransport {
  sent: Frame[] = [];
  peer: FakeDaemonSocket | null = null;
  private readonly messageHandlers = new Set<(data: unknown, isBinary: boolean) => void>();

  send(data: Frame): void {
    this.sent.push(data);
    this.peer?.emit("message", data, typeof data !== "string");
  }

  close(): void {}

  onMessage(handler: (data: unknown, isBinary: boolean) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onOpen(): () => void {
    return () => {};
  }

  onClose(): () => void {
    return () => {};
  }

  onError(): () => void {
    return () => {};
  }

  deliver(data: Frame): void {
    for (const handler of this.messageHandlers) handler(data, typeof data !== "string");
  }
}

/** Adapts a daemon-side socket to the E2EE channel's transport, as the server does. */
function daemonTransport(socket: DirectCarrierSocket): Transport {
  const transport: Transport = {
    send: (data) =>
      new Promise<void>((resolve, reject) => {
        socket.send(data, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  socket.on("message", (data, isBinary) => {
    transport.onmessage?.({ data: toChannelData(data), isBinary: isBinary === true });
  });
  return transport;
}

/** Adapts a client-side base transport to the E2EE channel's transport, as the client does. */
function clientTransport(base: DirectCarrierBaseTransport): Transport {
  const transport: Transport = {
    send: (data) => base.send(data),
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  base.onMessage((data, isBinary) => {
    transport.onmessage?.({ data: toChannelData(data), isBinary });
  });
  return transport;
}

function toChannelData(data: unknown): string | ArrayBuffer {
  if (typeof data === "string" || data instanceof ArrayBuffer) return data;
  if (data instanceof Uint8Array) return data.slice().buffer;
  throw new Error("unexpected frame");
}

function wire(clientBase: FakeClientBase, daemonSocket: FakeDaemonSocket): void {
  clientBase.peer = daemonSocket;
  daemonSocket.peer = clientBase;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

interface Pair {
  clientReceived: Array<string | ArrayBuffer>;
  daemonReceived: Array<string | ArrayBuffer>;
  clientSend: (data: string | ArrayBuffer) => Promise<void>;
  daemonSend: (data: string | ArrayBuffer) => Promise<void>;
}

/** Runs a real E2EE handshake over the given client and daemon transports. */
async function connectPair(client: Transport, daemon: Transport): Promise<Pair> {
  const daemonKeyPair = generateKeyPair();
  const clientReceived: Array<string | ArrayBuffer> = [];
  const daemonReceived: Array<string | ArrayBuffer> = [];
  const daemonChannelPromise = createDaemonChannel(daemon, daemonKeyPair, {
    onmessage: (data) => daemonReceived.push(data),
  });
  let resolveOpen: (() => void) | undefined;
  const clientOpen = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const clientChannel = await createClientChannel(
    client,
    exportPublicKey(daemonKeyPair.publicKey),
    { onopen: () => resolveOpen?.(), onmessage: (data) => clientReceived.push(data) },
  );
  const daemonChannel = await daemonChannelPromise;
  await clientOpen;
  return {
    clientReceived,
    daemonReceived,
    clientSend: (data) => clientChannel.send(data),
    daemonSend: (data) => daemonChannel.send(data),
  };
}

async function expectMessagesFlow(pair: Pair): Promise<void> {
  const bytes = new Uint8Array([7, 8, 9]).buffer;
  await pair.clientSend("from client 1");
  await pair.clientSend(bytes);
  await pair.clientSend("from client 2");
  await pair.daemonSend("from daemon 1");
  await pair.daemonSend("from daemon 2");
  await settle();
  expect(pair.daemonReceived.map(describeMessage)).toEqual([
    "from client 1",
    "bytes:7,8,9",
    "from client 2",
  ]);
  expect(pair.clientReceived).toEqual(["from daemon 1", "from daemon 2"]);
}

function describeMessage(data: string | ArrayBuffer): string {
  return typeof data === "string" ? data : `bytes:${Array.from(new Uint8Array(data)).join(",")}`;
}

function newClient(offer: boolean): { base: FakeClientBase; transport: DirectCarrierTransport } {
  const base = new FakeClientBase();
  const factory = createDirectCarrierTransportFactory({ baseFactory: () => base, offer });
  return { base, transport: factory({ url: "wss://relay.example/ws" }) };
}

describe("daemon direct carrier, un-negotiated", () => {
  it("passes outgoing frames through byte for byte and in order", () => {
    const socket = new FakeDaemonSocket();
    const carrier = createDaemonDirectCarrier(socket, { offer: true });
    const binary = new Uint8Array([1, 2, 3]);
    const buffer = new Uint8Array([4, 5]).buffer;
    const frames: Frame[] = ["c2VjcmV0", binary, '{"type":"session"}', buffer, " {not json"];

    for (const frame of frames) carrier.send(frame, () => undefined);

    expect(socket.sent).toHaveLength(frames.length);
    frames.forEach((frame, index) => expect(socket.sent[index]).toBe(frame));
    expect(carrier.negotiated).toBe(false);
  });

  it("passes incoming frames through byte for byte and in order", () => {
    const socket = new FakeDaemonSocket();
    const carrier = createDaemonDirectCarrier(socket, { offer: true });
    const received: unknown[][] = [];
    carrier.on("message", (...args) => received.push(args));
    const binary = new Uint8Array([1, 2, 3]);
    const text = new TextEncoder().encode('{"type":"session"}');

    socket.emit("message", "c2VjcmV0", false);
    socket.emit("message", binary, true);
    socket.emit("message", text, false);

    expect(received).toHaveLength(3);
    expect(received[0][0]).toBe("c2VjcmV0");
    expect(received[0][1]).toBe(false);
    expect(received[1][0]).toBe(binary);
    expect(received[1][1]).toBe(true);
    expect(received[2][0]).toBe(text);
    expect(received[2][1]).toBe(false);
  });

  it("waits for the relay socket's completion callback before a send completes", () => {
    const socket = new FakeDaemonSocket();
    socket.deferSendCompletion = true;
    const carrier = createDaemonDirectCarrier(socket, { offer: true });
    let completed = false;

    carrier.send("c2VjcmV0", () => {
      completed = true;
    });
    expect(completed).toBe(false);

    socket.completeNextSend();
    expect(completed).toBe(true);
  });

  it("forwards the relay socket's state and controls", () => {
    const socket = new FakeDaemonSocket();
    const carrier = createDaemonDirectCarrier(socket, { offer: true });
    socket.bufferedAmount = 4096;
    expect(carrier.bufferedAmount).toBe(4096);
    expect(carrier.readyState).toBe(1);
    carrier.terminate();
    expect(carrier.readyState).toBe(3);
  });

  it("leaves the ready frame unchanged for a client that did not offer the capability", async () => {
    const socket = new FakeDaemonSocket();
    const clientBase = new FakeClientBase();
    wire(clientBase, socket);
    const carrier = createDaemonDirectCarrier(socket, { offer: true });

    await connectPair(clientTransport(clientBase), daemonTransport(carrier));

    expect(socket.sent[0]).toBe(
      JSON.stringify({ type: "e2ee_ready", capabilities: { binaryCiphertext: true } }),
    );
    expect(carrier.negotiated).toBe(false);
  });
});

describe("client direct carrier, un-negotiated", () => {
  it("passes outgoing frames through byte for byte, in order, without queueing", () => {
    const { base, transport } = newClient(false);
    const binary = new Uint8Array([1, 2, 3]);
    const frames: Frame[] = ["c2VjcmV0", binary, '{"type":"e2ee_hello","key":"k"}', "abc"];

    for (const frame of frames) {
      const before = base.sent.length;
      transport.send(frame);
      expect(base.sent.length).toBe(before + 1);
    }

    frames.forEach((frame, index) => expect(base.sent[index]).toBe(frame));
    expect(transport.negotiated).toBe(false);
  });

  it("passes incoming frames through byte for byte and in order", () => {
    const { base, transport } = newClient(true);
    const received: Array<[unknown, boolean]> = [];
    transport.onMessage((data, isBinary) => received.push([data, isBinary]));
    const binary = new Uint8Array([1, 2, 3]).buffer;

    base.deliver("c2VjcmV0");
    base.deliver(binary);
    base.deliver('{"type":"e2ee_ready"}');

    expect(received).toEqual([
      ["c2VjcmV0", false],
      [binary, true],
      ['{"type":"e2ee_ready"}', false],
    ]);
    expect(received[1][0]).toBe(binary);
    expect(transport.negotiated).toBe(false);
  });
});

describe("old and new pairs connect", () => {
  it("old client with new daemon", async () => {
    const socket = new FakeDaemonSocket();
    const clientBase = new FakeClientBase();
    wire(clientBase, socket);
    const carrier = createDaemonDirectCarrier(socket, { offer: true });

    await expectMessagesFlow(
      await connectPair(clientTransport(clientBase), daemonTransport(carrier)),
    );
    expect(carrier.negotiated).toBe(false);
  });

  it("new client with old daemon", async () => {
    const socket = new FakeDaemonSocket();
    const client = newClient(true);
    wire(client.base, socket);

    await expectMessagesFlow(
      await connectPair(clientTransport(client.transport), daemonTransport(socket)),
    );
    expect(client.transport.negotiated).toBe(false);
  });

  it("new client with new daemon negotiate the carrier", async () => {
    const socket = new FakeDaemonSocket();
    const client = newClient(true);
    wire(client.base, socket);
    const carrier = createDaemonDirectCarrier(socket, { offer: true });

    await expectMessagesFlow(
      await connectPair(clientTransport(client.transport), daemonTransport(carrier)),
    );
    expect(client.transport.negotiated).toBe(true);
    expect(carrier.negotiated).toBe(true);
  });

  it("a daemon that does not offer leaves a new client un-negotiated", async () => {
    const socket = new FakeDaemonSocket();
    const client = newClient(true);
    wire(client.base, socket);
    const carrier = createDaemonDirectCarrier(socket, { offer: false });

    await expectMessagesFlow(
      await connectPair(clientTransport(client.transport), daemonTransport(carrier)),
    );
    expect(client.transport.negotiated).toBe(false);
    expect(carrier.negotiated).toBe(false);
  });

  it("a client that does not offer leaves a new daemon un-negotiated", async () => {
    const socket = new FakeDaemonSocket();
    const client = newClient(false);
    wire(client.base, socket);
    const carrier = createDaemonDirectCarrier(socket, { offer: true });

    await expectMessagesFlow(
      await connectPair(clientTransport(client.transport), daemonTransport(carrier)),
    );
    expect(client.transport.negotiated).toBe(false);
    expect(carrier.negotiated).toBe(false);
  });
});
