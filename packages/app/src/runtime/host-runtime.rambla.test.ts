// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: the relay branch of createClient runs over the direct carrier wrapper (criterion 3).
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "@/hosts/appearance";
import { HostRuntimeController } from "./host-runtime";
import { relayDirectCarrierConfig } from "./direct-carrier.rambla";

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
