// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: chunker order, chunk size, pairing, and pass-through (criterion 12).
import { describe, expect, test } from "vitest";
import {
  createChunkerTransportFactory,
  createDaemonChunkerSocket,
  type ChunkerSocket,
} from "./chunker.rambla.js";
import {
  createDirectCarrierTransportFactory,
  type DirectCarrierBaseTransport,
  type DirectCarrierTransport,
} from "./direct-carrier.rambla.js";
import { base64EncryptedWireByteLength } from "./encrypted-channel.js";

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

const MAX_CHUNK_WIRE_BYTES = 64 * 1024;
const READY_WITH_CAPABILITY = JSON.stringify({
  type: "e2ee_ready",
  capabilities: { binaryCiphertext: true, directCarrier: true },
});

/** In-memory client base transport that records sends and lets a test push frames. */
function createBaseTransport() {
  const sent: Frame[] = [];
  const handlers = new Set<(data: unknown, isBinary: boolean) => void>();
  const transport: DirectCarrierBaseTransport = {
    send: (data) => {
      sent.push(data);
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
  return {
    transport,
    sent,
    push: (data: unknown, isBinary: boolean) => {
      for (const handler of handlers) handler(data, isBinary);
    },
  };
}

/** Client chunker over a carrier transport; `negotiate` settles the carrier as the daemon would. */
function createClient(options: { negotiate: boolean }) {
  const base = createBaseTransport();
  const carrierFactory = createDirectCarrierTransportFactory({
    offer: true,
    baseFactory: () => base.transport,
  });
  const carriers: DirectCarrierTransport[] = [];
  const factory = createChunkerTransportFactory((transportOptions) => {
    const carrier = carrierFactory(transportOptions);
    carriers.push(carrier);
    return carrier;
  });
  const transport = factory({ url: "wss://relay.test/ws?serverId=srv&role=client" });
  if (options.negotiate) {
    // In the real stack the E2EE channel, not the chunker, consumes the handshake frame.
    const unsubscribe = carriers[0].onMessage(() => undefined);
    base.push(READY_WITH_CAPABILITY, false);
    unsubscribe();
  }
  const received: Array<{ data: unknown; isBinary: boolean }> = [];
  transport.onMessage((data, isBinary) => received.push({ data, isBinary }));
  return { base, transport, received };
}

/** Fake plaintext socket in the shape the daemon hands to `attachSocket`. */
class FakePlaintextSocket implements ChunkerSocket {
  readyState = 1;
  bufferedAmount = 0;
  sent: Frame[] = [];
  callbacks: Array<((error?: Error) => void) | undefined> = [];
  completions: Array<() => void> = [];
  private readonly listeners = new Map<string, Listener[]>();

  // Settles like the daemon's encrypted relay socket: through the returned promise.
  send(data: Frame, callback?: (error?: Error) => void): Promise<void> {
    this.sent.push(data);
    this.callbacks.push(callback);
    return new Promise((resolve) => this.completions.push(resolve));
  }

  close(): void {}

  on(event: string, listener: Listener): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  once(event: string, listener: Listener): void {
    this.on(event, listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

/** Daemon chunker over a fake plaintext socket, collecting the messages it delivers. */
function createDaemon(options: { negotiated: boolean }) {
  const socket = new FakePlaintextSocket();
  const chunked = createDaemonChunkerSocket(socket, { negotiated: options.negotiated });
  const received: unknown[] = [];
  chunked.on("message", (data) => received.push(data));
  return { socket, chunked, received };
}

function bytesOf(data: Frame): Uint8Array {
  if (typeof data === "string") return new TextEncoder().encode(data);
  return data instanceof Uint8Array ? data : new Uint8Array(data);
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

function expectChunksFit(frames: Frame[]): void {
  for (const frame of frames) {
    expect(typeof frame).not.toBe("string");
    expect(base64EncryptedWireByteLength(bytesOf(frame).byteLength)).toBeLessThanOrEqual(
      MAX_CHUNK_WIRE_BYTES,
    );
  }
}

describe("chunker, negotiated", () => {
  test("client to daemon: a mix of text and binary sent during a large transfer arrives in send order", () => {
    const client = createClient({ negotiate: true });
    const daemon = createDaemon({ negotiated: true });
    const large = patterned(5 * 1024 * 1024, 7);
    const largeText = "é".repeat(1024 * 1024);

    client.transport.send(large);
    client.transport.send("text 1");
    client.transport.send(new Uint8Array([1, 2, 3]).buffer);
    client.transport.send(largeText);
    client.transport.send("");
    client.transport.send("text 2");

    expect(client.base.sent.length).toBeGreaterThan(100);
    expectChunksFit(client.base.sent);
    for (const frame of client.base.sent) daemon.socket.emit("message", frame);

    expect(daemon.received).toHaveLength(6);
    expect(sameBytes(daemon.received[0], large)).toBe(true);
    expect(daemon.received[1]).toBe("text 1");
    expect(Array.from(new Uint8Array(daemon.received[2] as ArrayBuffer))).toEqual([1, 2, 3]);
    expect(daemon.received[3]).toBe(largeText);
    expect(daemon.received[4]).toBe("");
    expect(daemon.received[5]).toBe("text 2");
  });

  test("daemon to client: a mix of text and binary sent during a large transfer arrives in send order", async () => {
    const client = createClient({ negotiate: true });
    const daemon = createDaemon({ negotiated: true });
    const large = patterned(5 * 1024 * 1024, 3);

    const sends = [
      daemon.chunked.send(large),
      daemon.chunked.send("text 1"),
      daemon.chunked.send(new Uint8Array([4, 5])),
      daemon.chunked.send("text 2"),
    ];

    expect(daemon.socket.sent.length).toBeGreaterThan(80);
    expectChunksFit(daemon.socket.sent);
    for (const frame of daemon.socket.sent) client.base.push(frame, true);
    for (const complete of daemon.socket.completions) complete();
    await Promise.all(sends);

    expect(client.received).toHaveLength(4);
    expect(client.received[0].isBinary).toBe(true);
    expect(sameBytes(client.received[0].data, large)).toBe(true);
    expect(client.received[1]).toEqual({ data: "text 1", isBinary: false });
    expect(client.received[2].isBinary).toBe(true);
    expect(Array.from(new Uint8Array(client.received[2].data as ArrayBuffer))).toEqual([4, 5]);
    expect(client.received[3]).toEqual({ data: "text 2", isBinary: false });
  });

  test("a daemon send completes only when every chunk's send has completed", async () => {
    const daemon = createDaemon({ negotiated: true });
    let completed = false;
    const sending = Promise.resolve(daemon.chunked.send(patterned(200 * 1024, 1))).then(() => {
      completed = true;
      return undefined;
    });
    expect(daemon.socket.completions.length).toBeGreaterThan(1);

    for (const complete of daemon.socket.completions.slice(0, -1)) complete();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(completed).toBe(false);

    daemon.socket.completions.at(-1)?.();
    await sending;
    expect(completed).toBe(true);
  });
});

describe("chunker, un-negotiated", () => {
  test("the client passes frames through unchanged", () => {
    const client = createClient({ negotiate: false });
    const binary = new Uint8Array([9, 8, 7]);

    client.transport.send("app 1");
    client.transport.send(binary);
    client.base.push("daemon 1", false);

    expect(client.base.sent).toEqual(["app 1", binary]);
    expect(client.base.sent[1]).toBe(binary);
    expect(client.received).toEqual([{ data: "daemon 1", isBinary: false }]);
  });

  test("the daemon passes frames and the completion callback through unchanged", () => {
    const daemon = createDaemon({ negotiated: false });
    const binary = new Uint8Array([1, 2]);
    const callback = () => undefined;

    daemon.chunked.send("app 1", callback);
    daemon.chunked.send(binary);
    daemon.socket.emit("message", "client 1");

    expect(daemon.socket.sent).toEqual(["app 1", binary]);
    expect(daemon.socket.sent[1]).toBe(binary);
    expect(daemon.socket.callbacks[0]).toBe(callback);
    expect(daemon.received).toEqual(["client 1"]);
  });
});

describe("chunker pairing on the client", () => {
  test("a factory call that makes no carrier passes through, even after a negotiated carrier was made elsewhere", () => {
    const stray = createClient({ negotiate: true });
    expect(stray.transport).toBeDefined();

    const base = createBaseTransport();
    const factory = createChunkerTransportFactory(() => base.transport);
    const transport = factory({ url: "wss://relay.test/ws?serverId=srv&role=client" });

    expect(transport).toBe(base.transport);
  });

  test("the chunker reads the negotiation of the carrier made in its own factory call", () => {
    const negotiated = createClient({ negotiate: true });
    const plain = createClient({ negotiate: false });

    negotiated.transport.send("hello");
    plain.transport.send("hello");

    expect(typeof negotiated.base.sent[0]).not.toBe("string");
    expect(plain.base.sent[0]).toBe("hello");
  });
});
