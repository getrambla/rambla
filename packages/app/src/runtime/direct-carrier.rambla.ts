// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: app wiring of the relay package's direct carrier for relay client configs.
import { createDirectCarrierTransportFactory } from "@getrambla/relay/e2ee";
import { createWebSocketTransportFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@getrambla/client/internal/daemon-client-transport-types";
import type { DaemonClientConfig } from "@getrambla/client/internal/daemon-client";

export interface DirectCarrierTarget {
  serverId: string;
  connectionId: string;
  relayEndpoint: string;
  webSocketFactory: WebSocketFactory;
}

/** Returns the config field that runs a relay client's relay leg over the direct carrier. */
export function relayDirectCarrierConfig(
  target: DirectCarrierTarget,
): Pick<DaemonClientConfig, "transportFactory"> {
  return {
    transportFactory: createDirectCarrierTransportFactory({
      baseFactory: createWebSocketTransportFactory(target.webSocketFactory),
      offer: true,
    }),
  };
}
