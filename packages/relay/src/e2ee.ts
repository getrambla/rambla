export { createClientChannel, createDaemonChannel, EncryptedChannel } from "./encrypted-channel.js";
export type { Transport, TransportMessage, EncryptedChannelEvents } from "./encrypted-channel.js";

export {
  generateKeyPair,
  exportPublicKey,
  importPublicKey,
  exportSecretKey,
  importSecretKey,
} from "./crypto.js";
export type { KeyPair, SharedKey } from "./crypto.js";
// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: exports the direct carrier.
export {
  createDaemonDirectCarrier,
  createDirectCarrierTransportFactory,
} from "./direct-carrier.rambla.js";
export type {
  DaemonDirectCarrier,
  DirectCarrierOptions,
  DirectCarrierSocket,
  DirectCarrierTransport,
  DirectCarrierTransportFactory,
  DirectPeer,
  DirectPeerFactory,
  DirectPeerSignal,
} from "./direct-carrier.rambla.js";
export { createChunkerTransportFactory, createDaemonChunkerSocket } from "./chunker.rambla.js";
export type { ChunkerSocket } from "./chunker.rambla.js";
