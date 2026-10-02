// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: relay configs from buildClientConfig run over the direct carrier wrapper (criterion 3).
import { afterEach, describe, expect, it, vi } from "vitest";
import { DaemonClient } from "@getrambla/client/internal/daemon-client";
import { defaultWebSocketFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type { HostConnection } from "@/types/host-connection";
import { relayDirectCarrierConfig } from "@/runtime/direct-carrier.rambla";
import { buildClientConfig } from "./test-daemon-connection";

vi.mock("@/runtime/direct-carrier.rambla", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/runtime/direct-carrier.rambla")>();
  return { ...actual, relayDirectCarrierConfig: vi.fn(actual.relayDirectCarrierConfig) };
});

const relay: Extract<HostConnection, { type: "relay" }> = {
  id: "relay:relay.example.com:443",
  type: "relay",
  relayEndpoint: "relay.example.com:443",
  daemonPublicKeyB64: "pk_test",
};

const deps = {
  getClientId: async () => "cid_test",
  resolveAppVersion: () => null,
  createDesktopTransportFactory: () => null,
  buildDesktopTransportUrl: () => "unused",
};

/** Stand-in for the runtime's global WebSocket that records each URL it opens. */
class RecordingWebSocket {
  static urls: string[] = [];
  readyState = 0;
  binaryType = "blob";

  constructor(url: string) {
    RecordingWebSocket.urls.push(url);
  }

  send(): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}

afterEach(() => {
  vi.mocked(relayDirectCarrierConfig).mockClear();
  vi.unstubAllGlobals();
  RecordingWebSocket.urls = [];
});

describe("buildClientConfig relay configs with the direct carrier", () => {
  it("carries the wrapper with the server id, the connection's id, and its relay endpoint", async () => {
    const config = await buildClientConfig(relay, "srv_rambla_test", undefined, deps);

    expect(relayDirectCarrierConfig).toHaveBeenCalledTimes(1);
    expect(relayDirectCarrierConfig).toHaveBeenCalledWith({
      serverId: "srv_rambla_test",
      connectionId: "relay:relay.example.com:443",
      relayEndpoint: "relay.example.com:443",
      webSocketFactory: defaultWebSocketFactory,
    });
    const wrapper = vi.mocked(relayDirectCarrierConfig).mock.results[0].value.transportFactory;
    expect(wrapper).toBeTypeOf("function");
    expect(config.transportFactory).toBe(wrapper);
  });

  it("opens the relay leg through the client's default WebSocket factory", async () => {
    vi.stubGlobal("WebSocket", RecordingWebSocket);
    const config = await buildClientConfig(relay, "srv_rambla_test", undefined, deps);
    const client = new DaemonClient(config);

    void client.connect().catch(() => undefined);
    await vi.waitFor(() => expect(RecordingWebSocket.urls).toHaveLength(1));
    const url = new URL(RecordingWebSocket.urls[0]);
    expect(url.host).toBe("relay.example.com");
    expect(url.toString()).toContain("srv_rambla_test");

    await client.close();
  });

  it("leaves direct connections unwrapped", async () => {
    await buildClientConfig(
      { id: "direct:lan:6767", type: "directTcp", endpoint: "lan:6767" },
      undefined,
      undefined,
      deps,
    );
    expect(relayDirectCarrierConfig).not.toHaveBeenCalled();
  });
});
