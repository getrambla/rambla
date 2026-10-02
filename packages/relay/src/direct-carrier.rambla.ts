// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: direct carrier under E2EE, negotiated on the e2ee_hello / e2ee_ready capabilities.
/// <reference lib="dom" />

type Frame = string | Uint8Array | ArrayBuffer;
type Listener = (...args: unknown[]) => void;

export type DirectPeerSignal =
  | { type: "description"; sdp: string; sdpType: string }
  | { type: "candidate"; candidate: string; mid: string };

export type DirectCarrierControl =
  | { type: "signal"; signal: DirectPeerSignal }
  | { type: "cutover" };

export interface DirectPeerConfig {
  iceServers: string[];
  initiator: boolean;
}

export interface DirectPeerEvents {
  signal: (signal: DirectPeerSignal) => void;
  open: () => void;
  message: (data: string | ArrayBuffer, isBinary: boolean) => void;
  close: () => void;
}

export interface DirectPeer {
  signal: (signal: DirectPeerSignal) => void;
  send: (data: Frame) => void;
  readonly bufferedAmount: number;
  close: () => void;
}

export type DirectPeerFactory = (config: DirectPeerConfig, events: DirectPeerEvents) => DirectPeer;

export interface DirectCarrierOptions {
  offer: boolean;
  direct?: {
    createPeer: DirectPeerFactory;
    relayEndpoint: string;
    onCutover?: () => void;
  };
}

export interface DirectCarrierLink {
  readonly negotiated: boolean;
  bindControl: (
    send: (message: DirectCarrierControl) => void,
  ) => (message: DirectCarrierControl) => void;
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

export type DaemonDirectCarrier = DirectCarrierSocket & DirectCarrierLink;

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

export type DirectCarrierTransport = DirectCarrierBaseTransport & DirectCarrierLink;

export type DirectCarrierTransportFactory = (
  options: DirectCarrierTransportOptions,
) => DirectCarrierTransport;

const CAPABILITY = "directCarrier";
const OPEN_BRACE = 0x7b;
const ICE_TIMEOUT_MS = 15_000;
const STUN_PORT = 3478;
const CUTOVER_CLOSE_REASON = "Moved to direct link";

/** Returns the STUN URL at the relay host of a `host:port` relay endpoint. */
export function directCarrierStunUrl(relayEndpoint: string): string {
  const host = relayEndpoint.startsWith("[")
    ? relayEndpoint.slice(0, relayEndpoint.indexOf("]") + 1)
    : relayEndpoint.split(":")[0];
  return `stun:${host}:${STUN_PORT}`;
}

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

interface DirectCarrierHooks {
  deliver: (data: unknown, isBinary: boolean) => void;
  closeRelay: () => void;
  closeConnection: (code: number, reason: string) => void;
}

/** Negotiation, signaling, and cutover state shared by the daemon and client carriers. */
class DirectCarrierCore {
  negotiated = false;
  ended = false;
  private peerOffered = false;
  private peer: DirectPeer | null = null;
  private peerGeneration = 0;
  private started = false;
  private iceTimer: ReturnType<typeof setTimeout> | null = null;
  private sendControl: ((message: DirectCarrierControl) => void) | null = null;
  private sentCutover = false;
  private receivedCutover = false;
  private readonly directQueue: Array<[string | ArrayBuffer, boolean]> = [];

  constructor(
    private readonly options: DirectCarrierOptions,
    private readonly initiator: boolean,
    private readonly hooks: DirectCarrierHooks,
  ) {}

  /** True once this end sends over the DataChannel, which alone then decides when the connection ends. */
  get onDirect(): boolean {
    return this.sentCutover;
  }

  /** Returns the DataChannel's buffered amount. */
  get directBufferedAmount(): number {
    return this.peer?.bufferedAmount ?? 0;
  }

  /** Connects the chunker's control sender and returns the receiver for control messages. */
  bindControl(
    send: (message: DirectCarrierControl) => void,
  ): (message: DirectCarrierControl) => void {
    this.sendControl = send;
    return (message) => this.receiveControl(message);
  }

  /** Starts the initiator's peer once the carrier has negotiated. */
  startIfReady(): void {
    if (this.initiator && this.negotiated) this.openPeer();
  }

  /** Sends a frame over the DataChannel after cutover; returns false while frames go over relay. */
  sendDirect(data: Frame): boolean {
    if (!this.sentCutover) return false;
    if (!this.ended) this.peer?.send(data);
    return true;
  }

  /** Handles the relay leg closing; returns whether the close reaches the E2EE channel. */
  relayClosed(): boolean {
    if (this.sentCutover || this.ended) return false;
    this.stopPeer();
    return true;
  }

  /** Closes the connection on whichever leg carries it. */
  close(code: number | undefined, reason: string | undefined, closeRelay: () => void): void {
    if (this.sentCutover) {
      this.end(code ?? 1000, reason ?? "");
      return;
    }
    this.stopPeer();
    closeRelay();
  }

  /** Ends a connection that has moved, on either end, to the DataChannel. */
  end(code: number, reason: string): void {
    if (this.ended) return;
    this.ended = true;
    this.stopPeer();
    this.hooks.closeRelay();
    this.hooks.closeConnection(code, reason);
  }

  /** Creates this end's peer, once, when signaling can run. */
  private openPeer(): void {
    const direct = this.options.direct;
    if (this.started || !direct || !this.sendControl) return;
    this.started = true;
    const generation = ++this.peerGeneration;
    const live = () => generation === this.peerGeneration;
    this.iceTimer = setTimeout(() => this.dropPeer(), ICE_TIMEOUT_MS);
    this.peer = direct.createPeer(
      { iceServers: [directCarrierStunUrl(direct.relayEndpoint)], initiator: this.initiator },
      {
        signal: (signal) => {
          if (live()) this.sendControl?.({ type: "signal", signal });
        },
        open: () => {
          if (live()) this.cutover();
        },
        message: (data, isBinary) => {
          if (live()) this.receiveDirect(data, isBinary);
        },
        close: () => {
          if (live()) this.dropPeer();
        },
      },
    );
  }

  /** Falls back to relay before cutover; once either end has cut over, losing the peer ends the connection. */
  private dropPeer(): void {
    if (this.sentCutover || this.receivedCutover) {
      this.end(1006, "Direct link closed");
      return;
    }
    this.stopPeer();
  }

  /** Closes the peer for good and ignores anything it emits afterwards. */
  private stopPeer(): void {
    this.started = true;
    this.peerGeneration += 1;
    if (this.iceTimer) clearTimeout(this.iceTimer);
    this.iceTimer = null;
    this.peer?.close();
    this.peer = null;
  }

  /** Marks the end of this side's relay frames, then sends everything else over the DataChannel. */
  private cutover(): void {
    if (this.sentCutover || this.ended) return;
    if (this.iceTimer) clearTimeout(this.iceTimer);
    this.iceTimer = null;
    this.sendControl?.({ type: "cutover" });
    this.sentCutover = true;
    this.options.direct?.onCutover?.();
    this.finishIfDone();
  }

  /** Handles a control message the chunker received on the relay leg. */
  private receiveControl(message: DirectCarrierControl): void {
    if (message.type === "signal") {
      if (!this.initiator && this.negotiated) this.openPeer();
      this.peer?.signal(message.signal);
      return;
    }
    this.receivedCutover = true;
    for (const [data, isBinary] of this.directQueue.splice(0)) this.hooks.deliver(data, isBinary);
    this.finishIfDone();
  }

  /** Delivers a DataChannel frame, holding it until the other end's relay frames have all arrived. */
  private receiveDirect(data: string | ArrayBuffer, isBinary: boolean): void {
    if (this.receivedCutover) {
      this.hooks.deliver(data, isBinary);
      return;
    }
    this.directQueue.push([data, isBinary]);
  }

  /** Closes the relay leg once both directions have moved to the DataChannel. */
  private finishIfDone(): void {
    if (this.sentCutover && this.receivedCutover) this.hooks.closeRelay();
  }

  /** Returns the frame to send, adding the capability to an outgoing handshake frame when offered. */
  outgoing(data: Frame): Frame {
    if (!this.options.offer || typeof data !== "string") return data;
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
    this.negotiated = this.options.offer && offersCapability(frame);
  }
}

/** Wraps the daemon's relay data socket in the direct carrier, in the socket's own shape. */
export function createDaemonDirectCarrier(
  socket: DirectCarrierSocket,
  options: DirectCarrierOptions,
): DaemonDirectCarrier {
  const listeners = new Map<string, Listener[]>();
  const listen = (event: string, listener: Listener) =>
    listeners.set(event, [...(listeners.get(event) ?? []), listener]);
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  const core = new DirectCarrierCore(options, false, {
    deliver: (data, isBinary) => emit("message", data, isBinary),
    closeRelay: () => socket.close(1000, CUTOVER_CLOSE_REASON),
    closeConnection: (code, reason) => emit("close", code, reason),
  });
  socket.on("message", (...args) => {
    core.incoming(args[0], args[1] === true);
    emit("message", ...args);
  });
  socket.on("close", (...args) => {
    if (core.relayClosed()) emit("close", ...args);
  });
  socket.on("error", (...args) => {
    if (!core.onDirect) emit("error", ...args);
  });
  return {
    get readyState() {
      if (!core.onDirect) return socket.readyState;
      return core.ended ? 3 : 1;
    },
    get bufferedAmount() {
      return core.onDirect ? core.directBufferedAmount : socket.bufferedAmount;
    },
    get negotiated() {
      return core.negotiated;
    },
    bindControl: (send) => core.bindControl(send),
    send: (data, callback) => {
      if (core.sendDirect(data)) {
        callback?.();
        return;
      }
      socket.send(core.outgoing(data), callback);
    },
    close: (code, reason) => core.close(code, reason, () => socket.close(code, reason)),
    terminate: () => {
      if (core.onDirect) core.end(1006, "Terminated");
      else socket.terminate();
    },
    ping: () => {
      if (!core.onDirect) socket.ping();
    },
    on: (event, listener) => {
      if (event === "message" || event === "close" || event === "error") listen(event, listener);
      else socket.on(event, listener);
    },
    once: (event, listener) => {
      const once: Listener = (...args) => {
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((candidate) => candidate !== once),
        );
        listener(...args);
      };
      listen(event, once);
    },
  };
}

// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: records each client carrier transport for the chunker to pair with.
let createdTransport: DirectCarrierTransport | null = null;

/** Returns and forgets the carrier transport made since the last call. */
export function takeCreatedDirectCarrierTransport(): DirectCarrierTransport | null {
  const transport = createdTransport;
  createdTransport = null;
  return transport;
}

/** Wraps a client transport factory so each relay transport it makes runs over the direct carrier. */
export function createDirectCarrierTransportFactory(
  options: DirectCarrierOptions & { baseFactory: DirectCarrierBaseFactory },
): DirectCarrierTransportFactory {
  return (transportOptions) => {
    const base = options.baseFactory(transportOptions);
    const messageHandlers = new Set<(data: unknown, isBinary: boolean) => void>();
    const closeHandlers = new Set<(event?: unknown) => void>();
    const errorHandlers = new Set<(event?: unknown) => void>();
    const core = new DirectCarrierCore(options, true, {
      deliver: (data, isBinary) => {
        for (const handler of messageHandlers) handler(data, isBinary);
      },
      closeRelay: () => base.close(1000, CUTOVER_CLOSE_REASON),
      closeConnection: (code, reason) => {
        for (const handler of closeHandlers) handler({ code, reason });
      },
    });
    base.onMessage((data, isBinary) => {
      core.incoming(data, isBinary);
      for (const handler of messageHandlers) handler(data, isBinary);
      core.startIfReady();
    });
    base.onClose((event) => {
      if (!core.relayClosed()) return;
      for (const handler of closeHandlers) handler(event);
    });
    base.onError((event) => {
      if (core.onDirect) return;
      for (const handler of errorHandlers) handler(event);
    });
    const transport: DirectCarrierTransport = {
      get negotiated() {
        return core.negotiated;
      },
      bindControl: (send) => core.bindControl(send),
      send: (data) => {
        if (!core.sendDirect(data)) base.send(core.outgoing(data));
      },
      close: (code, reason) => core.close(code, reason, () => base.close(code, reason)),
      onMessage: (handler) => {
        messageHandlers.add(handler);
        return () => messageHandlers.delete(handler);
      },
      onOpen: (handler) => base.onOpen(handler),
      onClose: (handler) => {
        closeHandlers.add(handler);
        return () => closeHandlers.delete(handler);
      },
      onError: (handler) => {
        errorHandlers.add(handler);
        return () => errorHandlers.delete(handler);
      },
    };
    createdTransport = transport;
    return transport;
  };
}
