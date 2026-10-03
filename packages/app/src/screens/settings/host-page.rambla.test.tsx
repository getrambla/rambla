/**
 * @vitest-environment jsdom
 */
// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: the connection label and active connection badge show WebRTC while on the DataChannel (criterion 15).
import { i18n as testI18n } from "@/i18n/i18next";
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DirectCarrierTransport, DirectPeerFactory } from "@getrambla/relay/e2ee";
import type { WebSocketLike } from "@getrambla/client/internal/daemon-client-transport-types";
import type { HostConnection, HostProfile } from "@/types/host-connection";
import { defaultHostAppearance } from "@/hosts/appearance";
import { markLiveDirectCarrier, relayDirectCarrierConfig } from "@/runtime/direct-carrier.rambla";
import { HostConnectionsPage, HostSettingsPage } from "./host-page";

void testI18n;
// host-page.tsx builds JSX at module load with the classic runtime, before any test body runs.
await vi.hoisted(async () => {
  const { default: ReactModule } = await import("react");
  vi.stubGlobal("React", ReactModule);
});

const relay: Extract<HostConnection, { type: "relay" }> = {
  id: "relay:relay.example:443",
  type: "relay",
  relayEndpoint: "relay.example:443",
  daemonPublicKeyB64: "pk_test",
};

const host: HostProfile = {
  serverId: "srv_host_page",
  label: "test host",
  appearance: defaultHostAppearance(),
  lifecycle: {},
  connections: [relay],
  preferredConnectionId: relay.id,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

const runtime = vi.hoisted(() => ({ hosts: [] as unknown[], snapshot: null as unknown }));
runtime.hosts = [host];
runtime.snapshot = {
  serverId: host.serverId,
  connectionStatus: "online",
  activeConnectionId: relay.id,
  activeConnection: { type: "relay", display: relay.relayEndpoint },
  lastError: null,
  probeByConnectionId: new Map(),
};

vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({}),
  isHostRuntimeConnected: () => true,
  useHostMutations: () => ({ removeConnection: vi.fn(), removeHost: vi.fn() }),
  useHostRuntimeClient: () => null,
  useHostRuntimeIsConnected: () => true,
  useHostRuntimeSnapshot: () => runtime.snapshot,
  useHosts: () => runtime.hosts,
}));

vi.mock("@/hooks/use-is-local-daemon", () => ({ useIsLocalDaemon: () => true }));

// These three do not parse under vitest (Flow `typeof` imports, expo-clipboard JSX), and neither page under test renders them.
vi.mock("@/agent-profiles", () => ({ AgentProfilesSection: () => null }));
vi.mock("@/agent-skills", () => ({ AgentSkillsSection: () => null }));
vi.mock("@/desktop/components/pair-device-modal", () => ({ PairDeviceModal: () => null }));

vi.mock("@/desktop/components/desktop-updates-section", () => ({
  LocalDaemonSection: () => null,
}));

vi.mock("@/screens/settings/host-appearance-section", () => ({
  HostAppearanceSection: () => null,
}));

vi.mock("@/desktop/settings/desktop-settings", () => ({
  useDesktopSettings: () => ({ updateSettings: vi.fn() }),
}));

vi.mock("@/desktop/hooks/use-daemon-status", () => ({
  useDaemonStatus: () => ({ data: null, setStatus: vi.fn() }),
}));

afterEach(() => {
  cleanup();
});

/** Relay wrapper for this host's relay connection, marked live, over a fake WebSocket and peer. */
function liveRelayTransport() {
  const sockets: Array<WebSocketLike & { emit: (event: string, ...args: unknown[]) => void }> = [];
  const peers: Array<Parameters<DirectPeerFactory>[1]> = [];
  const { transportFactory } = relayDirectCarrierConfig({
    serverId: host.serverId,
    connectionId: relay.id,
    relayEndpoint: relay.relayEndpoint,
    webSocketFactory: () => {
      const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
      const ws = {
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
      sockets.push(ws);
      return ws;
    },
    createPeer: (_config, events) => {
      peers.push(events);
      return {
        signal: () => undefined,
        send: () => undefined,
        bufferedAmount: 0,
        close: () => undefined,
      };
    },
  });
  if (!transportFactory) throw new Error("expected a transport factory");
  markLiveDirectCarrier(transportFactory);
  const transport = transportFactory({ url: "wss://relay.example/ws?role=client" });
  (transport as DirectCarrierTransport).bindControl(() => undefined);
  sockets[0].emit(
    "message",
    JSON.stringify({ type: "e2ee_ready", capabilities: { directCarrier: true } }),
    false,
  );
  const peer = peers[0];
  if (!peer) throw new Error("expected a peer");
  return peer;
}

describe("host page connection label and badge", () => {
  it("shows WebRTC in the Connections label while on the DataChannel and Relay after it clears", () => {
    const peer = liveRelayTransport();
    render(<HostConnectionsPage serverId={host.serverId} />);
    expect(screen.getByText("Relay (relay.example:443)")).toBeTruthy();

    act(() => peer.open());
    expect(screen.getByText("WebRTC (relay.example:443)")).toBeTruthy();
    expect(screen.queryByText("Relay (relay.example:443)")).toBeNull();

    act(() => peer.close());
    expect(screen.getByText("Relay (relay.example:443)")).toBeTruthy();
    expect(screen.queryByText("WebRTC (relay.example:443)")).toBeNull();
  });

  it("shows WebRTC in the active connection badge while on the DataChannel and Relay after it clears", () => {
    const peer = liveRelayTransport();
    render(<HostSettingsPage serverId={host.serverId} />);
    const badges = () => screen.getByTestId("host-page-identity");
    expect(badges().textContent).toContain("Relay");
    expect(badges().textContent).not.toContain("WebRTC");

    act(() => peer.open());
    expect(badges().textContent).toContain("WebRTC");
    expect(badges().textContent).not.toContain("Relay");

    act(() => peer.close());
    expect(badges().textContent).toContain("Relay");
    expect(badges().textContent).not.toContain("WebRTC");
  });
});
