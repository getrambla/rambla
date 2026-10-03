// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: app wiring of the relay package's direct carrier for relay client configs.
import { create } from "zustand";
import {
  createDirectCarrierTransportFactory,
  type DirectCarrierTransport,
  type DirectCarrierTransportFactory,
  type DirectPeerFactory,
} from "@getrambla/relay/e2ee";
import { createWebSocketTransportFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type { WebSocketFactory } from "@getrambla/client/internal/daemon-client-transport-types";
import type { DaemonClientConfig } from "@getrambla/client/internal/daemon-client";

export interface DirectCarrierTarget {
  serverId: string;
  connectionId: string;
  relayEndpoint: string;
  webSocketFactory: WebSocketFactory;
  createPeer?: DirectPeerFactory;
}

interface DirectCarrierStoreState {
  /** Connections on the DataChannel, by store key, each owned by the transport that cut over. */
  onDirect: ReadonlyMap<string, DirectCarrierTransport>;
}

const useDirectCarrierStore = create<DirectCarrierStoreState>()(() => ({ onDirect: new Map() }));

/** One relay wrapper's connection, whether the app adopted it as live, and its transports on the DataChannel. */
interface DirectCarrierLane {
  key: string;
  marked: boolean;
  onDirect: Set<DirectCarrierTransport>;
}

const lanes = new WeakMap<object, DirectCarrierLane>();

/** Returns the store key for a server's connection. */
function storeKey(serverId: string, connectionId: string): string {
  return JSON.stringify([serverId, connectionId]);
}

/** Records a connection as on the DataChannel, owned by the given transport. */
function setEntry(key: string, owner: DirectCarrierTransport): void {
  useDirectCarrierStore.setState((state) => ({
    onDirect: new Map(state.onDirect).set(key, owner),
  }));
}

/** Clears a connection's entry, only when the given transport owns it. */
function clearEntry(key: string, owner: DirectCarrierTransport): void {
  const { onDirect } = useDirectCarrierStore.getState();
  if (onDirect.get(key) !== owner) return;
  const next = new Map(onDirect);
  next.delete(key);
  useDirectCarrierStore.setState({ onDirect: next });
}

/** Marks the transport factory of the client the app adopts as live; ignores any other factory. */
export function markLiveDirectCarrier(transportFactory: unknown): void {
  const lane = typeof transportFactory === "function" ? lanes.get(transportFactory) : undefined;
  if (!lane) return;
  lane.marked = true;
  const newest = [...lane.onDirect].at(-1);
  if (newest) setEntry(lane.key, newest);
}

/** Returns whether a server's connection is on the DataChannel. */
export function isDirectCarrierActive(serverId: string, connectionId: string): boolean {
  return useDirectCarrierStore.getState().onDirect.has(storeKey(serverId, connectionId));
}

/** Returns whether a server's connection is on the DataChannel, redrawing when that changes. */
export function useDirectCarrierActive(serverId: string, connectionId: string | null): boolean {
  return useDirectCarrierStore(
    (state) => connectionId !== null && state.onDirect.has(storeKey(serverId, connectionId)),
  );
}

/** Returns the config field that runs a relay client's relay leg over the direct carrier. */
export function relayDirectCarrierConfig(
  target: DirectCarrierTarget,
): Pick<DaemonClientConfig, "transportFactory"> {
  const lane: DirectCarrierLane = {
    key: storeKey(target.serverId, target.connectionId),
    marked: false,
    onDirect: new Set(),
  };
  const baseFactory = createWebSocketTransportFactory(target.webSocketFactory);
  const createPeer = target.createPeer;
  const transportFactory: DirectCarrierTransportFactory = (options) => {
    const transport = createDirectCarrierTransportFactory({
      baseFactory,
      offer: true,
      ...(createPeer
        ? {
            direct: {
              createPeer,
              relayEndpoint: target.relayEndpoint,
              onCutover: () => {
                lane.onDirect.add(transport);
                if (lane.marked) setEntry(lane.key, transport);
              },
            },
          }
        : {}),
    })(options);
    transport.onClose(() => {
      lane.onDirect.delete(transport);
      clearEntry(lane.key, transport);
    });
    return transport;
  };
  lanes.set(transportFactory, lane);
  return { transportFactory };
}
