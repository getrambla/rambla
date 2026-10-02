// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: the app's relay wrapper passes frames through un-negotiated and pairs with old and new daemons (criterion 3).
import { describe, expect, it } from "vitest";
import { createWebSocketTransportFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type {
  DaemonTransport,
  WebSocketLike,
} from "@getrambla/client/internal/daemon-client-transport-types";
import {
  createClientChannel,
  createDaemonChannel,
  createDaemonDirectCarrier,
  exportPublicKey,
  generateKeyPair,
  type DirectCarrierSocket,
  type Transport,
} from "@getrambla/relay/e2ee";
import { relayDirectCarrierConfig } from "./direct-carrier.rambla";

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

/** Fake WebSocket in the `ws` listener shape the client's WebSocket transport binds to. */
class FakeWebSocket implements WebSocketLike {
  readyState = 1;
  binaryType = "blob";
  sent: Frame[] = [];
  onSend: ((data: Frame) => void) | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(readonly url: string) {}

  send(data: Frame): void {
    this.sent.push(data);
    this.onSend?.(data);
  }

  close(): void {
    this.readyState = 3;
  }

  on(event: string, listener: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(event, set);
  }

  off(event: string, listener: Listener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

/** Fake daemon-side relay data socket in the `ws` shape the daemon wraps. */
class FakeDaemonSocket implements DirectCarrierSocket {
  readyState = 1;
  peer: FakeWebSocket | null = null;
  private readonly listeners = new Map<string, Listener[]>();

  send(data: Frame, callback?: (error?: Error) => void): void {
    this.peer?.emit("message", data, typeof data !== "string");
    callback?.();
  }

  close(): void {}
  terminate(): void {}
  ping(): void {}

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

const TARGET = {
  serverId: "srv_test",
  connectionId: "relay:relay.example:443",
  relayEndpoint: "relay.example:443",
};

/** Opens a relay transport through the app's wrapper over a fake WebSocket. */
function openWrapped(): { ws: FakeWebSocket; transport: DaemonTransport } {
  let ws: FakeWebSocket | null = null;
  const { transportFactory } = relayDirectCarrierConfig({
    ...TARGET,
    webSocketFactory: (url) => {
      ws = new FakeWebSocket(url);
      return ws;
    },
  });
  if (!transportFactory) throw new Error("expected a transport factory");
  const transport = transportFactory({ url: "wss://relay.example/ws?role=client" });
  if (!ws) throw new Error("expected the relay leg to open through the WebSocket factory");
  return { ws, transport };
}

/** Opens a relay transport with the client's plain WebSocket transport, as today. */
function openPlain(): { ws: FakeWebSocket; transport: DaemonTransport } {
  let ws: FakeWebSocket | null = null;
  const transport = createWebSocketTransportFactory((url) => {
    ws = new FakeWebSocket(url);
    return ws;
  })({ url: "wss://relay.example/ws?role=client" });
  if (!ws) throw new Error("expected a WebSocket");
  return { ws, transport };
}

const outgoing = (): Frame[] => [
  "c2VjcmV0",
  new Uint8Array([1, 2, 3]),
  '{"type":"session"}',
  new Uint8Array([4, 5]).buffer,
];

const incoming = (): Array<[Frame, boolean]> => [
  ["c2VjcmV0", false],
  [new Uint8Array([6, 7]).buffer, true],
  ['{"type":"e2ee_ready"}', false],
  ["dGFpbA==", false],
];

describe("app relay wrapper, un-negotiated", () => {
  it("opens the relay leg through the given WebSocket factory with the relay URL", () => {
    const { ws } = openWrapped();
    expect(ws.url).toBe("wss://relay.example/ws?role=client");
  });

  it("sends frames byte for byte, in order, straight to the WebSocket", () => {
    const { ws, transport } = openWrapped();
    const frames = outgoing();

    for (const frame of frames) {
      const before = ws.sent.length;
      transport.send(frame);
      expect(ws.sent.length).toBe(before + 1);
    }

    frames.forEach((frame, index) => expect(ws.sent[index]).toBe(frame));
  });

  it("delivers incoming frames exactly as the plain WebSocket transport does", () => {
    const wrapped = openWrapped();
    const plain = openPlain();
    const wrappedReceived: Array<[unknown, boolean]> = [];
    const plainReceived: Array<[unknown, boolean]> = [];
    wrapped.transport.onMessage((data, isBinary) => wrappedReceived.push([data, isBinary]));
    plain.transport.onMessage((data, isBinary) => plainReceived.push([data, isBinary]));

    for (const [data, isBinary] of incoming()) {
      wrapped.ws.emit("message", data, isBinary);
      plain.ws.emit("message", data, isBinary);
    }

    expect(wrappedReceived).toHaveLength(4);
    expect(wrappedReceived).toEqual(plainReceived);
  });
});

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
    transport.onmessage?.({ data: data as string | ArrayBuffer, isBinary: isBinary === true });
  });
  return transport;
}

/** Adapts the wrapped client transport to the E2EE channel's transport, as the client does. */
function clientTransport(base: DaemonTransport): Transport {
  const transport: Transport = {
    send: (data) => base.send(data),
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  base.onMessage((data, isBinary) => {
    transport.onmessage?.({ data: data as string | ArrayBuffer, isBinary });
  });
  return transport;
}

/** Connects the wrapped client to a daemon over an in-memory relay and exchanges messages. */
async function connectAndExchange(wrapDaemon: boolean) {
  const { ws, transport } = openWrapped();
  const daemonSocket = new FakeDaemonSocket();
  daemonSocket.peer = ws;
  ws.onSend = (data) => daemonSocket.emit("message", data, typeof data !== "string");
  const daemonSide = wrapDaemon
    ? createDaemonDirectCarrier(daemonSocket, { offer: true })
    : daemonSocket;

  const daemonKeyPair = generateKeyPair();
  const daemonReceived: Array<string | ArrayBuffer> = [];
  const clientReceived: Array<string | ArrayBuffer> = [];
  const daemonChannelPromise = createDaemonChannel(daemonTransport(daemonSide), daemonKeyPair, {
    onmessage: (data) => daemonReceived.push(data),
  });
  let resolveOpen: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve;
  });
  const clientChannel = await createClientChannel(
    clientTransport(transport),
    exportPublicKey(daemonKeyPair.publicKey),
    { onopen: () => resolveOpen?.(), onmessage: (data) => clientReceived.push(data) },
  );
  const daemonChannel = await daemonChannelPromise;
  await opened;

  await clientChannel.send("client 1");
  await clientChannel.send("client 2");
  await daemonChannel.send("daemon 1");
  await daemonChannel.send("daemon 2");
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { daemonSide, daemonReceived, clientReceived };
}

describe("app relay wrapper with old and new daemons", () => {
  it("connects to an old daemon and messages flow in order", async () => {
    const { daemonReceived, clientReceived } = await connectAndExchange(false);
    expect(daemonReceived).toEqual(["client 1", "client 2"]);
    expect(clientReceived).toEqual(["daemon 1", "daemon 2"]);
  });

  it("connects to a new daemon, negotiates the carrier, and messages flow in order", async () => {
    const { daemonSide, daemonReceived, clientReceived } = await connectAndExchange(true);
    expect(daemonReceived).toEqual(["client 1", "client 2"]);
    expect(clientReceived).toEqual(["daemon 1", "daemon 2"]);
    expect("negotiated" in daemonSide && daemonSide.negotiated).toBe(true);
  });
});
