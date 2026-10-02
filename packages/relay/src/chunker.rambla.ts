// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: plaintext-side chunker over the E2EE channel, in send order.
/// <reference lib="dom" />
import {
  takeCreatedDirectCarrierTransport,
  type DirectCarrierBaseFactory,
} from "./direct-carrier.rambla.js";
import { maxBase64EncryptedPlaintextByteLength } from "./encrypted-channel.js";

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

// Mirrors the server's RelaySocketLike; packages/relay takes no workspace dependency.
export interface ChunkerSocket {
  readyState: number;
  bufferedAmount?: number;
  send: (data: Frame, callback?: (error?: Error) => void) => void | Promise<void>;
  close: (code?: number, reason?: string) => void;
  terminate?: () => void;
  on: (event: "message" | "close" | "error", listener: Listener) => void;
  once: (event: "close" | "error", listener: Listener) => void;
}

export interface ChunkerCarrier {
  readonly negotiated: boolean;
}

const FINAL = 0x01;
const TEXT = 0x02;
// Sized for base64 ciphertext so a chunk fits 64 KiB in either E2EE ciphertext mode.
const MAX_CHUNK_PAYLOAD_BYTES = maxBase64EncryptedPlaintextByteLength(64 * 1024) - 1;

/** Splits one message into chunk frames, each a flags byte followed by payload. */
function splitMessage(data: Frame): ArrayBuffer[] {
  const isText = typeof data === "string";
  let bytes: Uint8Array;
  if (typeof data === "string") bytes = new TextEncoder().encode(data);
  else bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const chunks: ArrayBuffer[] = [];
  let offset = 0;
  do {
    const end = Math.min(offset + MAX_CHUNK_PAYLOAD_BYTES, bytes.byteLength);
    const chunk = new Uint8Array(1 + end - offset);
    chunk[0] = (isText ? TEXT : 0) | (end === bytes.byteLength ? FINAL : 0);
    chunk.set(bytes.subarray(offset, end), 1);
    chunks.push(chunk.buffer);
    offset = end;
  } while (offset < bytes.byteLength);
  return chunks;
}

/** Returns the bytes of a received chunk frame. */
function chunkBytes(frame: unknown): Uint8Array {
  if (frame instanceof ArrayBuffer) return new Uint8Array(frame);
  if (ArrayBuffer.isView(frame)) {
    return new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  throw new Error("Chunker received a frame that is not a chunk");
}

/** Joins chunk frames back into whole messages. */
class ChunkJoiner {
  private parts: Uint8Array[] = [];

  /** Adds a chunk frame and returns the whole message once its final chunk arrives. */
  push(frame: unknown): string | ArrayBuffer | null {
    const bytes = chunkBytes(frame);
    this.parts.push(bytes.subarray(1));
    if ((bytes[0] & FINAL) === 0) return null;
    const message = new Uint8Array(this.parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of this.parts) {
      message.set(part, offset);
      offset += part.byteLength;
    }
    this.parts = [];
    return (bytes[0] & TEXT) !== 0 ? new TextDecoder().decode(message) : message.buffer;
  }
}

/** Wraps the daemon's plaintext relay socket in the chunker, once the carrier has negotiated. */
export function createDaemonChunkerSocket(
  socket: ChunkerSocket,
  carrier: ChunkerCarrier,
): ChunkerSocket {
  return {
    get readyState() {
      return socket.readyState;
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    send: (data, callback) => {
      if (!carrier.negotiated) return socket.send(data, callback);
      // Settles through the promise alone, as the daemon's encrypted relay socket does.
      return Promise.all(splitMessage(data).map((chunk) => socket.send(chunk))).then(
        () => undefined,
      );
    },
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate?.(),
    on: (event, listener) => {
      if (event !== "message") {
        socket.on(event, listener);
        return;
      }
      const joiner = new ChunkJoiner();
      socket.on("message", (...args) => {
        if (!carrier.negotiated) {
          listener(...args);
          return;
        }
        const message = joiner.push(args[0]);
        if (message !== null) listener(message);
      });
    },
    once: (event, listener) => socket.once(event, listener),
  };
}

/** Wraps a client transport factory so each transport pairs with the carrier made in the same call. */
export function createChunkerTransportFactory(
  baseFactory: DirectCarrierBaseFactory,
): DirectCarrierBaseFactory {
  return (options) => {
    takeCreatedDirectCarrierTransport();
    const transport = baseFactory(options);
    const carrier = takeCreatedDirectCarrierTransport();
    if (!carrier) return transport;
    return {
      send: (data) => {
        if (!carrier.negotiated) {
          transport.send(data);
          return;
        }
        for (const chunk of splitMessage(data)) transport.send(chunk);
      },
      close: (code, reason) => transport.close(code, reason),
      onMessage: (handler) => {
        const joiner = new ChunkJoiner();
        return transport.onMessage((data, isBinary) => {
          if (!carrier.negotiated) {
            handler(data, isBinary);
            return;
          }
          const message = joiner.push(data);
          if (message !== null) handler(message, typeof message !== "string");
        });
      },
      onOpen: (handler) => transport.onOpen(handler),
      onClose: (handler) => transport.onClose(handler),
      onError: (handler) => transport.onError(handler),
    };
  };
}
