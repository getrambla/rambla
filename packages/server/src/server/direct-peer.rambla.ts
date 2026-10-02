// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: node-datachannel peer, the daemon side of the direct carrier.
import type pino from "pino";
import type * as NodeDataChannel from "node-datachannel";
import type { DataChannel, DescriptionType } from "node-datachannel";
import type { DirectCarrierOptions, DirectPeerFactory } from "@getrambla/relay/e2ee";

let nodeDataChannel: typeof NodeDataChannel | null = null;
let loadError: unknown = null;
let loadLogged = false;
const loading = (async () => {
  try {
    nodeDataChannel = await import("node-datachannel");
  } catch (error) {
    loadError = error;
  }
})();

/** Returns the bytes of a binary DataChannel message as an ArrayBuffer of their own. */
function toArrayBuffer(message: Buffer | ArrayBuffer): ArrayBuffer {
  if (message instanceof ArrayBuffer) return message;
  const out = new Uint8Array(message.byteLength);
  out.set(message);
  return out.buffer;
}

/** Wraps node-datachannel in the direct carrier's peer shape. */
function createNodeDirectPeer(module: typeof NodeDataChannel): DirectPeerFactory {
  return (config, events) => {
    const connection = new module.PeerConnection("rambla", { iceServers: config.iceServers });
    let channel: DataChannel | null = null;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      events.close();
    };
    const attach = (dataChannel: DataChannel) => {
      channel = dataChannel;
      dataChannel.onOpen(() => events.open());
      dataChannel.onMessage((message) => {
        if (typeof message === "string") events.message(message, false);
        else events.message(toArrayBuffer(message), true);
      });
      dataChannel.onClosed(close);
      dataChannel.onError(close);
      if (dataChannel.isOpen()) events.open();
    };
    connection.onLocalDescription((sdp, sdpType) =>
      events.signal({ type: "description", sdp, sdpType }),
    );
    connection.onLocalCandidate((candidate, mid) =>
      events.signal({ type: "candidate", candidate, mid }),
    );
    connection.onStateChange((state) => {
      if (state === "failed" || state === "closed") close();
    });
    if (config.initiator) attach(connection.createDataChannel("rambla"));
    else connection.onDataChannel(attach);
    return {
      signal: (signal) => {
        if (signal.type === "description") {
          connection.setRemoteDescription(signal.sdp, signal.sdpType as DescriptionType);
        } else {
          connection.addRemoteCandidate(signal.candidate, signal.mid);
        }
      },
      send: (data) => {
        if (typeof data === "string") channel?.sendMessage(data);
        else channel?.sendMessageBinary(data instanceof Uint8Array ? data : new Uint8Array(data));
      },
      get bufferedAmount() {
        return channel?.bufferedAmount() ?? 0;
      },
      close: () => {
        channel?.close();
        connection.close();
      },
    };
  };
}

/** Resolves to the node-datachannel peer factory, or null when node-datachannel cannot load. */
export async function loadNodeDirectPeerFactory(): Promise<DirectPeerFactory | null> {
  await loading;
  return nodeDataChannel ? createNodeDirectPeer(nodeDataChannel) : null;
}

/** Returns the direct carrier options for one relay connection, logging once whether node-datachannel loaded. */
export function daemonDirectCarrierOptions(
  relayEndpoint: string,
  logger: pino.Logger,
): DirectCarrierOptions {
  if (!loadLogged && (nodeDataChannel || loadError)) {
    loadLogged = true;
    if (nodeDataChannel) logger.info("node_datachannel_loaded");
    else logger.warn({ err: loadError }, "node_datachannel_load_failed");
  }
  if (!nodeDataChannel) return { offer: false };
  return {
    offer: true,
    direct: {
      createPeer: createNodeDirectPeer(nodeDataChannel),
      relayEndpoint,
      onCutover: () => logger.info("relay_direct_cutover"),
    },
  };
}
