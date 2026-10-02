import { afterEach, expect, test, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "./daemon-client";

// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: imports for the chunker hook tests.
import {
  createDaemonChannel,
  createDaemonChunkerSocket,
  createDaemonDirectCarrier,
  createDirectCarrierTransportFactory,
  exportPublicKey,
  generateKeyPair,
  type ChunkerSocket,
  type DirectCarrierSocket,
  type Transport,
} from "@getrambla/relay/e2ee";
import type { DaemonTransportFactory, WebSocketFactory, WebSocketLike } from "./daemon-client";

/** 15 s waiting for the finish to be taken plus 10 s for the text, inside the 30 s a person waits. */
const SILENT_DAEMON_FAILURE_MS = 25_000;

/** Minimal logger the client is happy with. */
function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** In-memory transport that answers the handshake and lets a test push session frames. */
function createMockTransport() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];

  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};

  const transport: DaemonTransport = {
    send: (data) => {
      sent.push(data);
      if (typeof data !== "string") {
        return;
      }
      const frame = JSON.parse(data) as { type?: string };
      if (frame.type === "ping") {
        onMessage(JSON.stringify({ type: "pong" }));
      }
    },
    close: () => {},
    onMessage: (handler) => {
      onMessage = (data) => handler(data, typeof data !== "string");
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: () => () => {},
    onError: () => () => {},
  };

  return {
    transport,
    sent,
    triggerOpen: () => {
      onOpen();
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "srv_rambla_test",
              hostname: null,
              version: null,
              features: { ownedSubscriptions: true },
            },
          },
        }),
      );
    },
    triggerMessage: (data: unknown) => onMessage(data),
  };
}

/** Wraps a session message in the envelope the transport delivers. */
function wrapSessionMessage(message: unknown): string {
  return JSON.stringify({ type: "session", message });
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients.length = 0;
  vi.useRealTimers();
});

/** A connected client whose timers the test drives. */
async function connectClient() {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_unit_test",
    logger: createMockLogger(),
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen();
  await connectPromise;
  return { client, mock };
}

test("gives up on a silent daemon inside the 30 second dictation ceiling", async () => {
  const { client } = await connectClient();

  const finishPromise = client.finishDictationStream("dict-silent", 0);
  let settled = false;
  const outcome = finishPromise.then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  // The daemon never takes the finish and never sends a final.
  await vi.advanceTimersByTimeAsync(SILENT_DAEMON_FAILURE_MS - 1);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await expect(outcome).resolves.toBeInstanceOf(Error);
});

test("honors a daemon deadline that asks for longer than the fallback", async () => {
  const { client, mock } = await connectClient();

  const finishPromise = client.finishDictationStream("dict-greedy", 0);
  let settled = false;
  const outcome = finishPromise.then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  const statedDeadlineMs = 5 * 60 * 1000;
  mock.triggerMessage(
    wrapSessionMessage({
      type: "dictation_stream_finish_accepted",
      payload: { dictationId: "dict-greedy", timeoutMs: statedDeadlineMs },
    }),
  );

  // The daemon measured the work; its stated deadline plus grace is what the client waits.
  await vi.advanceTimersByTimeAsync(statedDeadlineMs + 5_000 - 1);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await expect(outcome).resolves.toBeInstanceOf(Error);
});

// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: the relay E2EE chunker hook pairs with its own carrier and passes through without one.
type WireFrame = string | Uint8Array | ArrayBuffer;
type WireListener = (...args: unknown[]) => void;

const RELAY_URL = "wss://relay.test:443/ws?serverId=srv_rambla_test&role=client&v=2";
const SERVER_INFO = wrapSessionMessage({
  type: "status",
  payload: {
    status: "server_info",
    serverId: "srv_rambla_test",
    hostname: null,
    version: null,
    features: { ownedSubscriptions: true },
  },
});

/** Copies a frame into its own buffer, as a real socket delivers it. */
function toWire(data: WireFrame): string | ArrayBuffer {
  if (typeof data === "string") return data;
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  return bytes.slice().buffer;
}

/** In-memory relay leg: client ends in both shapes, and a daemon running the real carrier, E2EE, and chunker. */
function createRelayPeer(options: { daemonOffersCarrier: boolean }) {
  const daemonKeyPair = generateKeyPair();
  const toDaemon = new Set<WireListener>();
  const toClient = new Set<WireListener>();
  const deliver = (listeners: Set<WireListener>, data: WireFrame) => {
    const frame = toWire(data);
    queueMicrotask(() => {
      for (const listener of listeners) listener(frame, typeof frame !== "string");
    });
  };

  const daemonSocket: DirectCarrierSocket = {
    readyState: 1,
    send: (data, callback) => {
      deliver(toClient, data);
      callback?.();
    },
    close: () => undefined,
    terminate: () => undefined,
    ping: () => undefined,
    on: (event, listener) => {
      if (event === "message") toDaemon.add(listener);
    },
    once: () => undefined,
  };
  const carrier = createDaemonDirectCarrier(daemonSocket, { offer: options.daemonOffersCarrier });
  const relayTransport: Transport = {
    send: (data) => carrier.send(data),
    close: () => undefined,
    onmessage: null,
    onclose: null,
    onerror: null,
  };
  carrier.on("message", (data, isBinary) => {
    relayTransport.onmessage?.({ data: data as string | ArrayBuffer, isBinary: isBinary === true });
  });

  const decrypted: unknown[] = [];
  const appMessages: Array<{ type?: string }> = [];
  const plaintextListeners = new Set<WireListener>();
  const channelReady = createDaemonChannel(relayTransport, daemonKeyPair, {
    onmessage: (data) => {
      decrypted.push(data);
      for (const listener of plaintextListeners) listener(data);
    },
  });
  const plaintextSocket: ChunkerSocket = {
    readyState: 1,
    send: (data) =>
      channelReady.then((channel) =>
        channel.send(typeof data === "string" ? data : (toWire(data) as ArrayBuffer)),
      ),
    close: () => undefined,
    on: (event, listener) => {
      if (event === "message") plaintextListeners.add(listener);
    },
    once: () => undefined,
  };
  const chunked = createDaemonChunkerSocket(plaintextSocket, carrier);
  chunked.on("message", (data) => {
    const message = JSON.parse(String(data)) as { type?: string };
    appMessages.push(message);
    if (message.type === "hello") void chunked.send(SERVER_INFO);
  });

  const baseTransport: DaemonTransport = {
    send: (data) => deliver(toDaemon, data),
    close: () => undefined,
    onMessage: (handler) => {
      toClient.add(handler as WireListener);
      return () => toClient.delete(handler as WireListener);
    },
    onOpen: (handler) => {
      queueMicrotask(handler);
      return () => undefined;
    },
    onClose: () => () => undefined,
    onError: () => () => undefined,
  };
  const webSocket: WebSocketLike = {
    readyState: 1,
    send: (data) => deliver(toDaemon, data),
    close: () => undefined,
    on: (event, listener) => {
      if (event === "open") queueMicrotask(() => listener());
      if (event === "message") toClient.add(listener);
    },
    off: (event, listener) => {
      if (event === "message") toClient.delete(listener);
    },
  };

  return {
    daemonPublicKeyB64: exportPublicKey(daemonKeyPair.publicKey),
    baseTransport,
    webSocket,
    decrypted,
    appMessages,
  };
}

/** A relay E2EE client built with a transport factory, as the app's is, or a WebSocket factory, as the CLI's is. */
function createRelayClient(
  peer: ReturnType<typeof createRelayPeer>,
  factories: { transportFactory?: DaemonTransportFactory; webSocketFactory?: WebSocketFactory },
): DaemonClient {
  const client = new DaemonClient({
    url: RELAY_URL,
    clientId: "clsk_unit_test",
    logger: createMockLogger(),
    reconnect: { enabled: false },
    e2ee: { enabled: true, daemonPublicKeyB64: peer.daemonPublicKeyB64 },
    ...factories,
  });
  clients.push(client);
  return client;
}

test("the chunker pairs with the carrier made in the same factory call and chunks once it negotiates", async () => {
  const peer = createRelayPeer({ daemonOffersCarrier: true });
  const client = createRelayClient(peer, {
    transportFactory: createDirectCarrierTransportFactory({
      offer: true,
      baseFactory: () => peer.baseTransport,
    }),
  });

  await client.connect();

  expect(peer.appMessages[0]?.type).toBe("hello");
  expect(peer.decrypted.length).toBeGreaterThan(0);
  for (const frame of peer.decrypted) expect(frame).toBeInstanceOf(ArrayBuffer);
});

test("an un-negotiated carrier leaves the chunker passing through", async () => {
  const peer = createRelayPeer({ daemonOffersCarrier: false });
  const client = createRelayClient(peer, {
    transportFactory: createDirectCarrierTransportFactory({
      offer: true,
      baseFactory: () => peer.baseTransport,
    }),
  });

  await client.connect();

  expect(typeof peer.decrypted[0]).toBe("string");
  expect(JSON.parse(String(peer.decrypted[0])).type).toBe("hello");
  expect(peer.appMessages[0]?.type).toBe("hello");
});

test("a client built with only a webSocketFactory, as the CLI's is, passes through", async () => {
  const strayHandlers = new Set<WireListener>();
  const stray = createDirectCarrierTransportFactory({
    offer: true,
    baseFactory: () => ({
      send: () => undefined,
      close: () => undefined,
      onMessage: (handler) => {
        strayHandlers.add(handler as WireListener);
        return () => strayHandlers.delete(handler as WireListener);
      },
      onOpen: () => () => undefined,
      onClose: () => () => undefined,
      onError: () => () => undefined,
    }),
  })({ url: RELAY_URL });
  stray.onMessage(() => undefined);
  for (const handler of strayHandlers) {
    handler(JSON.stringify({ type: "e2ee_ready", capabilities: { directCarrier: true } }), false);
  }
  // A negotiated carrier made outside the client's factory call must not be paired with.
  expect(stray.negotiated).toBe(true);

  const peer = createRelayPeer({ daemonOffersCarrier: true });
  const client = createRelayClient(peer, { webSocketFactory: () => peer.webSocket });

  await client.connect();

  expect(peer.decrypted.length).toBeGreaterThan(0);
  for (const frame of peer.decrypted) expect(typeof frame).toBe("string");
  expect(peer.appMessages[0]?.type).toBe("hello");
});
