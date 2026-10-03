// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: the relay branch of createClient runs over the direct carrier wrapper (criterion 3).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "@/hosts/appearance";
import type {
  ConnectionState,
  DaemonClient,
  DaemonTransport,
  DaemonTransportFactory,
} from "@getrambla/client/internal/daemon-client";
import type { DirectCarrierTransport, DirectPeerFactory } from "@getrambla/relay/e2ee";
import { HostRuntimeController } from "./host-runtime";
import { isDirectCarrierActive, relayDirectCarrierConfig } from "./direct-carrier.rambla";

const { appWebSocketFactory } = vi.hoisted(() => {
  const listenerFree = () => undefined;
  return {
    appWebSocketFactory: vi.fn((url: string) => ({
      url,
      readyState: 0,
      binaryType: "blob",
      send: listenerFree,
      close: listenerFree,
      on: listenerFree,
      off: listenerFree,
    })),
  };
});

vi.mock("./websocket-factory", () => ({ createAppWebSocketFactory: () => appWebSocketFactory }));

vi.mock("./direct-carrier.rambla", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./direct-carrier.rambla")>();
  return { ...actual, relayDirectCarrierConfig: vi.fn(actual.relayDirectCarrierConfig) };
});

const relay: Extract<HostConnection, { type: "relay" }> = {
  id: "relay:relay.example.com:443",
  type: "relay",
  relayEndpoint: "relay.example.com:443",
  daemonPublicKeyB64: "pk_test",
};

const direct: HostConnection = {
  id: "direct:lan:6767",
  type: "directTcp",
  endpoint: "lan:6767",
};

const host: HostProfile = {
  serverId: "srv_rambla_test",
  label: "test host",
  appearance: defaultHostAppearance(),
  lifecycle: {},
  connections: [direct, relay],
  preferredConnectionId: null,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

afterEach(() => {
  vi.mocked(relayDirectCarrierConfig).mockClear();
  appWebSocketFactory.mockClear();
});

/** Builds a client through the controller's default deps, as the app does. */
function createDefaultClient(connection: HostConnection) {
  const controller = new HostRuntimeController({ host });
  return controller["deps"].createClient({
    host,
    connection,
    clientId: "cid_test",
    runtimeGeneration: 1,
  });
}

describe("host-runtime relay branch with the direct carrier", () => {
  it("passes the wrapper with the host's server id and the connection's id and relay endpoint", () => {
    const client = createDefaultClient(relay);

    expect(relayDirectCarrierConfig).toHaveBeenCalledTimes(1);
    expect(relayDirectCarrierConfig).toHaveBeenCalledWith({
      serverId: "srv_rambla_test",
      connectionId: "relay:relay.example.com:443",
      relayEndpoint: "relay.example.com:443",
      webSocketFactory: appWebSocketFactory,
    });
    const wrapper = vi.mocked(relayDirectCarrierConfig).mock.results[0].value.transportFactory;
    expect(wrapper).toBeTypeOf("function");
    expect(client["config"].transportFactory).toBe(wrapper);
  });

  it("opens the relay leg through the app's WebSocket factory", async () => {
    const client = createDefaultClient(relay);

    void client.connect().catch(() => undefined);
    await vi.waitFor(() => expect(appWebSocketFactory).toHaveBeenCalledTimes(1));
    const url = new URL(appWebSocketFactory.mock.calls[0][0]);
    expect(url.host).toBe("relay.example.com");
    expect(url.toString()).toContain("srv_rambla_test");

    await client.close();
  });

  it("leaves direct connections unwrapped", () => {
    createDefaultClient(direct);
    expect(relayDirectCarrierConfig).not.toHaveBeenCalled();
  });
});

const relayOnlyHost: HostProfile = {
  ...host,
  connections: [relay],
  preferredConnectionId: relay.id,
};

type DirectPeerEvents = Parameters<DirectPeerFactory>[1];

/** WebSocket stand-in that lets a test push frames to the relay leg. */
function fakeWebSocket(url: string) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    url,
    readyState: 1,
    binaryType: "blob",
    send: () => undefined,
    close: () => undefined,
    on: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
    },
    off: (event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    },
    emit: (event: string, ...args: unknown[]) => {
      for (const listener of listeners.get(event) ?? []) listener(...args);
    },
  };
}

/** Client stand-in whose relay transports come from the real app wrapper over fake peers. */
class CarrierClient {
  authFailureReason = null;
  lastError = null;
  readonly transportFactory: DaemonTransportFactory;
  private readonly sockets: Array<ReturnType<typeof fakeWebSocket>> = [];
  private readonly peers: DirectPeerEvents[] = [];
  private transport: DaemonTransport | null = null;

  constructor() {
    const { transportFactory } = relayDirectCarrierConfig({
      serverId: host.serverId,
      connectionId: relay.id,
      relayEndpoint: relay.relayEndpoint,
      webSocketFactory: (url) => {
        const ws = fakeWebSocket(url);
        this.sockets.push(ws);
        return ws;
      },
      createPeer: (_config, events) => {
        this.peers.push(events);
        return {
          signal: () => undefined,
          send: () => undefined,
          bufferedAmount: 0,
          close: () => undefined,
        };
      },
    });
    if (!transportFactory) throw new Error("expected a transport factory");
    this.transportFactory = transportFactory;
  }

  /** The newest peer, which a test opens to cut over or closes to drop the DataChannel. */
  get peer(): DirectPeerEvents {
    const peer = this.peers[this.peers.length - 1];
    if (!peer) throw new Error("expected a peer");
    return peer;
  }

  /** Opens a relay transport and negotiates the carrier, as `DaemonClient` does on connect and on reconnect. */
  openTransport(): void {
    this.transport = this.transportFactory({ url: "wss://relay.example.com/ws?role=client" });
    (this.transport as DirectCarrierTransport).bindControl(() => undefined);
    this.sockets[this.sockets.length - 1].emit(
      "message",
      JSON.stringify({ type: "e2ee_ready", capabilities: { directCarrier: true } }),
      false,
    );
  }

  /** Opens the first relay transport. */
  async connect(): Promise<void> {
    this.openTransport();
  }

  /** Closes the current relay transport on purpose. */
  async close(): Promise<void> {
    this.transport?.close(1000, "Client closed");
  }

  /** Accepts the controller's reconnect toggle. */
  setReconnectEnabled(): void {}

  /** Accepts the controller's liveness nudge. */
  ensureConnected(): void {}

  /** Reports the client as connected. */
  subscribeConnectionStatus(listener: (state: ConnectionState) => void): () => void {
    listener({ status: "connected" });
    return () => undefined;
  }

  /** Answers the speed check. */
  async measureLatency(): Promise<number> {
    return 12;
  }

  /** Answers the active connection's liveness read. */
  getLastLivenessRttMs(): number {
    return 12;
  }
}

const onDirect = () => isDirectCarrierActive(host.serverId, relay.id);

describe("host-runtime marks only the live client's connection as on the DataChannel", () => {
  it("leaves the store unmarked while a speed-check client cuts over, then marks it once adopted as live", async () => {
    let markedDuringSpeedCheck: boolean | null = null;
    const speedCheck = new CarrierClient();
    const controller = new HostRuntimeController({
      host: relayOnlyHost,
      deps: {
        createClient: () => {
          throw new Error("createClient should not be called");
        },
        connectToDaemon: async () => {
          await speedCheck.connect();
          speedCheck.peer.open();
          markedDuringSpeedCheck = onDirect();
          return {
            client: speedCheck as unknown as DaemonClient,
            serverId: host.serverId,
            hostname: null,
          };
        },
        getClientId: async () => "cid_test",
      },
    });

    await controller.start({ autoProbe: false });

    expect(markedDuringSpeedCheck).toBe(false);
    expect(controller.getSnapshot().activeConnectionId).toBe(relay.id);
    expect(onDirect()).toBe(true);

    await controller.stop();
    expect(onDirect()).toBe(false);
  });

  it("marks the live client again after it reconnects on its own and cuts over again", async () => {
    const live = new CarrierClient();
    const controller = new HostRuntimeController({
      host: relayOnlyHost,
      deps: {
        createClient: () => live as unknown as DaemonClient,
        connectToDaemon: async () => {
          throw new Error("connectToDaemon should not be called");
        },
        getClientId: async () => "cid_test",
      },
    });
    await controller.activateConnection({ connectionId: relay.id });
    live.peer.open();
    expect(onDirect()).toBe(true);

    live.peer.close();
    expect(onDirect()).toBe(false);
    live.openTransport();
    expect(onDirect()).toBe(false);
    live.peer.open();
    expect(onDirect()).toBe(true);

    await controller.stop();
  });

  it("leaves a client switchToConnection builds itself unmarked until it cuts over, then marks it", async () => {
    const built = new CarrierClient();
    const controller = new HostRuntimeController({
      host: relayOnlyHost,
      deps: {
        createClient: () => built as unknown as DaemonClient,
        connectToDaemon: async () => {
          throw new Error("connectToDaemon should not be called");
        },
        getClientId: async () => "cid_test",
      },
    });

    await controller.activateConnection({ connectionId: relay.id });
    expect(controller.getSnapshot().activeConnectionId).toBe(relay.id);
    expect(onDirect()).toBe(false);

    built.peer.open();
    expect(onDirect()).toBe(true);

    await controller.stop();
  });
});
