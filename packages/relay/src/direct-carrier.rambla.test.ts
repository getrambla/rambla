// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: carrier negotiation and un-negotiated pass-through (criterion 3).
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDaemonDirectCarrier,
  createDirectCarrierTransportFactory,
  directCarrierStunUrl,
  type DirectCarrierBaseTransport,
  type DirectCarrierControl,
  type DirectCarrierSocket,
  type DirectCarrierTransport,
  type DirectPeer,
  type DirectPeerConfig,
  type DirectPeerEvents,
  type DirectPeerFactory,
  type DirectPeerSignal,
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

  close(code?: number, reason?: string): void {
    this.readyState = 3;
    this.emit("close", code ?? 1005, reason ?? "");
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
  closed = false;
  private readonly messageHandlers = new Set<(data: unknown, isBinary: boolean) => void>();
  private readonly closeHandlers = new Set<(event?: unknown) => void>();

  send(data: Frame): void {
    this.sent.push(data);
    this.peer?.emit("message", data, typeof data !== "string");
  }

  close(code?: number, reason?: string): void {
    this.closed = true;
    for (const handler of this.closeHandlers) handler({ code, reason });
  }

  onMessage(handler: (data: unknown, isBinary: boolean) => void): () => void {
    this.messageHandlers.add(handler);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onOpen(): () => void {
    return () => {};
  }

  onClose(handler: (event?: unknown) => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
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
  socket.on("close", (code, reason) => transport.onclose?.(Number(code), String(reason)));
  socket.on("error", (error) => transport.onerror?.(error as Error));
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
  base.onClose(() => transport.onclose?.(1006, ""));
  base.onError((error) => transport.onerror?.(error as Error));
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
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(20);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}

interface Pair {
  clientReceived: Array<string | ArrayBuffer>;
  daemonReceived: Array<string | ArrayBuffer>;
  channelEvents: string[];
  clientSend: (data: string | ArrayBuffer) => Promise<void>;
  daemonSend: (data: string | ArrayBuffer) => Promise<void>;
}

/** Runs a real E2EE handshake over the given client and daemon transports. */
async function connectPair(client: Transport, daemon: Transport): Promise<Pair> {
  const daemonKeyPair = generateKeyPair();
  const clientReceived: Array<string | ArrayBuffer> = [];
  const daemonReceived: Array<string | ArrayBuffer> = [];
  const channelEvents: string[] = [];
  const daemonChannelPromise = createDaemonChannel(daemon, daemonKeyPair, {
    onmessage: (data) => daemonReceived.push(data),
    onclose: () => channelEvents.push("daemon close"),
    onerror: () => channelEvents.push("daemon error"),
  });
  let resolveOpen: (() => void) | undefined;
  const clientOpen = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const clientChannel = await createClientChannel(
    client,
    exportPublicKey(daemonKeyPair.publicKey),
    {
      onopen: () => resolveOpen?.(),
      onmessage: (data) => clientReceived.push(data),
      onclose: () => channelEvents.push("client close"),
      onerror: () => channelEvents.push("client error"),
    },
  );
  const daemonChannel = await daemonChannelPromise;
  await clientOpen;
  return {
    clientReceived,
    daemonReceived,
    channelEvents,
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

// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: STUN URL, ICE timeout, ICE failure, and cutover over fake peers (criteria 2 and 11).
/** Fake DataChannel peer that records its config and lets a test drive its events. */
class FakePeer implements DirectPeer {
  bufferedAmount = 0;
  sent: Frame[] = [];
  signals: DirectPeerSignal[] = [];
  closed = false;
  remote: FakePeer | null = null;

  constructor(
    readonly config: DirectPeerConfig,
    readonly events: DirectPeerEvents,
  ) {}

  signal(signal: DirectPeerSignal): void {
    this.signals.push(signal);
  }

  send(data: Frame): void {
    this.sent.push(data);
    this.remote?.events.message(toChannelData(data), typeof data !== "string");
  }

  close(): void {
    this.closed = true;
  }
}

const OFFER_SIGNAL: DirectPeerSignal = { type: "description", sdp: "v=0 offer", sdpType: "offer" };

/** Client and daemon carriers with fake peers over a real E2EE handshake, control links joined as the chunkers join them. */
async function connectDirectPair(relayEndpoint = "relay.example.com:443") {
  const clientPeers: FakePeer[] = [];
  const daemonPeers: FakePeer[] = [];
  const peerFactory =
    (peers: FakePeer[]): DirectPeerFactory =>
    (config, events) => {
      const peer = new FakePeer(config, events);
      peers.push(peer);
      return peer;
    };
  const socket = new FakeDaemonSocket();
  const base = new FakeClientBase();
  wire(base, socket);
  const clientCarrier = createDirectCarrierTransportFactory({
    baseFactory: () => base,
    offer: true,
    direct: { createPeer: peerFactory(clientPeers), relayEndpoint },
  })({ url: "wss://relay.example/ws" });
  const daemonCarrier = createDaemonDirectCarrier(socket, {
    offer: true,
    direct: { createPeer: peerFactory(daemonPeers), relayEndpoint },
  });
  let receiveOnDaemon: (message: DirectCarrierControl) => void = () => undefined;
  const receiveOnClient = clientCarrier.bindControl((message) => receiveOnDaemon(message));
  receiveOnDaemon = daemonCarrier.bindControl((message) => receiveOnClient(message));
  const pair = await connectPair(clientTransport(clientCarrier), daemonTransport(daemonCarrier));
  return { pair, socket, base, clientCarrier, daemonCarrier, clientPeers, daemonPeers };
}

/** Signals the daemon peer into being, links the two fake peers, and opens both DataChannels. */
function cutOver(link: Awaited<ReturnType<typeof connectDirectPair>>): [FakePeer, FakePeer] {
  link.clientPeers[0].events.signal(OFFER_SIGNAL);
  const [clientPeer] = link.clientPeers;
  const [daemonPeer] = link.daemonPeers;
  clientPeer.remote = daemonPeer;
  daemonPeer.remote = clientPeer;
  clientPeer.events.open();
  daemonPeer.events.open();
  return [clientPeer, daemonPeer];
}

describe("direct link", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the STUN URL from the relay host, on port 3478, keeping IPv6 brackets", () => {
    expect(directCarrierStunUrl("relay.example.com:443")).toBe("stun:relay.example.com:3478");
    expect(directCarrierStunUrl("203.0.113.5:443")).toBe("stun:203.0.113.5:3478");
    expect(directCarrierStunUrl("[::1]:443")).toBe("stun:[::1]:3478");
  });

  it("gives every peer only the relay host's STUN URL and no TURN", async () => {
    const link = await connectDirectPair("[::1]:443");
    link.clientPeers[0].events.signal(OFFER_SIGNAL);

    expect(link.daemonPeers).toHaveLength(1);
    expect(link.daemonPeers[0].signals).toEqual([OFFER_SIGNAL]);
    expect(link.clientPeers[0].config).toStrictEqual({
      iceServers: ["stun:[::1]:3478"],
      initiator: true,
    });
    expect(link.daemonPeers[0].config).toStrictEqual({
      iceServers: ["stun:[::1]:3478"],
      initiator: false,
    });
  });

  it("with no ICE success, gives up on the DataChannel at 15 s and stays on relay", async () => {
    vi.useFakeTimers();
    const link = await connectDirectPair();
    link.clientPeers[0].events.signal(OFFER_SIGNAL);

    await vi.advanceTimersByTimeAsync(14_999);
    expect(link.clientPeers[0].closed).toBe(false);
    expect(link.daemonPeers[0].closed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(link.clientPeers[0].closed).toBe(true);
    expect(link.daemonPeers[0].closed).toBe(true);

    link.clientPeers[0].events.open();
    link.daemonPeers[0].events.open();
    const relayFrames = link.socket.sent.length + link.base.sent.length;
    await expectMessagesFlow(link.pair);
    expect(link.socket.sent.length + link.base.sent.length).toBe(relayFrames + 5);
    expect(link.clientPeers[0].sent).toEqual([]);
    expect(link.daemonPeers[0].sent).toEqual([]);
    expect(link.pair.channelEvents).toEqual([]);
  });

  it("when ICE fails, the transport stays open on relay and no error or close reaches the E2EE channel", async () => {
    const link = await connectDirectPair();
    link.clientPeers[0].events.signal(OFFER_SIGNAL);

    link.clientPeers[0].events.close();
    link.daemonPeers[0].events.close();

    expect(link.clientPeers[0].closed).toBe(true);
    expect(link.daemonPeers[0].closed).toBe(true);
    const relayFrames = link.socket.sent.length + link.base.sent.length;
    await expectMessagesFlow(link.pair);
    expect(link.socket.sent.length + link.base.sent.length).toBe(relayFrames + 5);
    expect(link.base.closed).toBe(false);
    expect(link.socket.readyState).toBe(1);
    expect(link.daemonCarrier.readyState).toBe(1);
    expect(link.pair.channelEvents).toEqual([]);
  });

  it("cuts over to the DataChannel and closes the relay leg on both ends without the E2EE channel seeing it", async () => {
    const link = await connectDirectPair();
    const [clientPeer, daemonPeer] = cutOver(link);

    expect(link.base.closed).toBe(true);
    expect(link.socket.readyState).toBe(3);
    expect(link.daemonCarrier.readyState).toBe(1);
    const relayFrames = link.socket.sent.length + link.base.sent.length;
    await expectMessagesFlow(link.pair);
    expect(link.socket.sent.length + link.base.sent.length).toBe(relayFrames);
    expect(clientPeer.sent).toHaveLength(3);
    expect(daemonPeer.sent).toHaveLength(2);
    expect(link.pair.channelEvents).toEqual([]);
  });

  it("a DataChannel drop after cutover closes the E2EE channel on both ends", async () => {
    const link = await connectDirectPair();
    const [clientPeer, daemonPeer] = cutOver(link);

    clientPeer.events.close();
    daemonPeer.events.close();
    await settle();

    expect([...link.pair.channelEvents].sort()).toEqual(["client close", "daemon close"]);
    expect(link.daemonCarrier.readyState).toBe(3);
  });
});
