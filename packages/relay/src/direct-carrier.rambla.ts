// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: direct carrier under E2EE, negotiated on the e2ee_hello / e2ee_ready capabilities.
/// <reference lib="dom" />

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

export interface DirectCarrierOptions {
  offer: boolean;
}

// Mirrors the server's RelayWebSocketLike; packages/relay takes no workspace dependency.
export interface DirectCarrierSocket {
  readyState: number;
  bufferedAmount?: number;
  send: (data: Frame, callback?: (error?: Error) => void) => void;
  close: (code?: number, reason?: string) => void;
  terminate: () => void;
  ping: () => void;
  on: (event: "open" | "message" | "close" | "error" | "pong", listener: Listener) => void;
  once: (event: "close" | "error", listener: Listener) => void;
}

export interface DaemonDirectCarrier extends DirectCarrierSocket {
  readonly negotiated: boolean;
}

// Mirrors the client's DaemonTransport and DaemonTransportFactory.
export interface DirectCarrierBaseTransport {
  send: (data: Frame) => void;
  close: (code?: number, reason?: string) => void;
  onMessage: (handler: (data: unknown, isBinary: boolean) => void) => () => void;
  onOpen: (handler: () => void) => () => void;
  onClose: (handler: (event?: unknown) => void) => () => void;
  onError: (handler: (event?: unknown) => void) => () => void;
}

export interface DirectCarrierTransportOptions {
  url: string;
  headers?: Record<string, string>;
  protocols?: string[];
}

export type DirectCarrierBaseFactory = (
  options: DirectCarrierTransportOptions,
) => DirectCarrierBaseTransport;

export interface DirectCarrierTransport extends DirectCarrierBaseTransport {
  readonly negotiated: boolean;
}

export type DirectCarrierTransportFactory = (
  options: DirectCarrierTransportOptions,
) => DirectCarrierTransport;

const CAPABILITY = "directCarrier";
const OPEN_BRACE = 0x7b;

type HandshakeFrame = Record<string, unknown> & { type: "e2ee_hello" | "e2ee_ready" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the text of a frame that could be JSON, without decoding any other frame. */
function jsonCandidateText(data: unknown): string | null {
  if (typeof data === "string") return data.charCodeAt(0) === OPEN_BRACE ? data : null;
  let bytes: Uint8Array;
  if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else return null;
  if (bytes[0] !== OPEN_BRACE) return null;
  return new TextDecoder().decode(bytes);
}

/** Parses an `e2ee_hello` or `e2ee_ready` frame, or returns null for any other frame. */
function readHandshake(data: unknown): HandshakeFrame | null {
  const text = jsonCandidateText(data);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) return null;
    if (parsed.type !== "e2ee_hello" && parsed.type !== "e2ee_ready") return null;
    return parsed as HandshakeFrame;
  } catch {
    return null;
  }
}

/** Reads whether a handshake frame carries the direct carrier capability. */
function offersCapability(frame: HandshakeFrame): boolean {
  return isRecord(frame.capabilities) && frame.capabilities[CAPABILITY] === true;
}

/** Negotiation state shared by the daemon and client carriers. */
class DirectCarrierCore {
  negotiated = false;
  private peerOffered = false;

  constructor(private readonly offer: boolean) {}

  /** Returns the frame to send, adding the capability to an outgoing handshake frame when offered. */
  outgoing(data: Frame): Frame {
    if (!this.offer || typeof data !== "string") return data;
    const frame = readHandshake(data);
    if (!frame) return data;
    if (frame.type === "e2ee_ready") {
      if (!this.peerOffered) return data;
      this.negotiated = true;
    }
    const capabilities = isRecord(frame.capabilities) ? frame.capabilities : {};
    return JSON.stringify({ ...frame, capabilities: { ...capabilities, [CAPABILITY]: true } });
  }

  /** Records the peer's capability from an incoming handshake frame. */
  incoming(data: unknown, isBinary: boolean): void {
    if (isBinary) return;
    const frame = readHandshake(data);
    if (!frame) return;
    if (frame.type === "e2ee_hello") {
      this.peerOffered = offersCapability(frame);
      return;
    }
    this.negotiated = this.offer && offersCapability(frame);
  }
}

/** Wraps the daemon's relay data socket in the direct carrier, in the socket's own shape. */
export function createDaemonDirectCarrier(
  socket: DirectCarrierSocket,
  options: DirectCarrierOptions,
): DaemonDirectCarrier {
  const core = new DirectCarrierCore(options.offer);
  return {
    get readyState() {
      return socket.readyState;
    },
    get bufferedAmount() {
      return socket.bufferedAmount;
    },
    get negotiated() {
      return core.negotiated;
    },
    send: (data, callback) => socket.send(core.outgoing(data), callback),
    close: (code, reason) => socket.close(code, reason),
    terminate: () => socket.terminate(),
    ping: () => socket.ping(),
    on: (event, listener) => {
      if (event !== "message") {
        socket.on(event, listener);
        return;
      }
      socket.on("message", (...args) => {
        core.incoming(args[0], args[1] === true);
        listener(...args);
      });
    },
    once: (event, listener) => socket.once(event, listener),
  };
}

/** Wraps a client transport factory so each relay transport it makes runs over the direct carrier. */
export function createDirectCarrierTransportFactory(options: {
  baseFactory: DirectCarrierBaseFactory;
  offer: boolean;
}): DirectCarrierTransportFactory {
  return (transportOptions) => {
    const base = options.baseFactory(transportOptions);
    const core = new DirectCarrierCore(options.offer);
    return {
      get negotiated() {
        return core.negotiated;
      },
      send: (data) => base.send(core.outgoing(data)),
      close: (code, reason) => base.close(code, reason),
      onMessage: (handler) =>
        base.onMessage((data, isBinary) => {
          core.incoming(data, isBinary);
          handler(data, isBinary);
        }),
      onOpen: (handler) => base.onOpen(handler),
      onClose: (handler) => base.onClose(handler),
      onError: (handler) => base.onError(handler),
    };
  };
}
