// RAMBLA-FORK: feature: 2026-10-01-feat-webrtc-p2p-upgrade.md: daemon DataChannel peer, cutover, fallback, and reconnect over loopback ICE (criteria 1, 2, 4-7).
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import pino from "pino";
import { Writable } from "node:stream";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { DaemonClient, type WebSocketLike } from "@getrambla/client/internal/daemon-client";
import { createWebSocketTransportFactory } from "@getrambla/client/internal/daemon-client-websocket-transport";
import type { DaemonTransportFactory } from "@getrambla/client/internal/daemon-client-transport-types";
import {
  createDirectCarrierTransportFactory,
  type DirectCarrierTransport,
  type DirectPeerFactory,
} from "@getrambla/relay/e2ee";
import { buildRelayWebSocketUrl } from "@getrambla/protocol/daemon-endpoints";
import { parseConnectionOfferFromUrl } from "@getrambla/protocol/connection-offer";
import { generateLocalPairingOffer } from "./pairing-offer.js";
import { createTestRamblaDaemon, type TestRamblaDaemon } from "./test-utils/rambla-daemon.js";
import { loadNodeDirectPeerFactory } from "./direct-peer.rambla.js";

type Frame = string | Uint8Array | ArrayBuffer;

const nodeMajor = Number((process.versions.node ?? "0").split(".")[0] ?? "0");
const shouldRunRelayE2e = process.env.FORCE_RELAY_E2E === "1" || nodeMajor < 25;
const relayDir = fileURLToPath(new URL("../../../relay", import.meta.url));

function createCapturingLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString("utf8"));
      cb();
    },
  });
  return { logger: pino({ level: "debug" }, stream), lines };
}

/** Returns the parsed log records whose message is `msg`. */
function logRecords(lines: string[], msg: string): Array<Record<string, unknown>> {
  return lines
    .flatMap((chunk) => chunk.split("\n"))
    .filter((line) => line.includes(`"msg":"${msg}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(20);
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to acquire port")));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

/** Resolves once the local relay accepts a server WebSocket. */
async function waitForRelay(port: number, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const url = buildRelayWebSocketUrl({
      endpoint: `127.0.0.1:${port}`,
      useTls: false,
      serverId: `probe-${Math.random().toString(36).slice(2)}`,
      role: "server",
    });
    const opened = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url, { handshakeTimeout: 5000 });
      ws.once("open", () => {
        ws.close(1000, "probe");
        resolve(true);
      });
      ws.once("error", () => resolve(false));
    });
    if (opened) return;
    await sleep(250);
  }
  throw new Error(`Relay not ready on port ${port} within ${timeoutMs}ms`);
}

function patterned(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 31 + 11) & 0xff;
  return out;
}

function frameText(frame: Frame): string {
  if (typeof frame === "string") return frame;
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  return Buffer.from(bytes).toString("latin1");
}

interface BaseRecord {
  sent: number;
  received: number;
  closed: boolean;
}

interface DirectClient {
  client: DaemonClient;
  carriers: DirectCarrierTransport[];
  bases: BaseRecord[];
  peers: Array<{ closed: boolean; close: () => void }>;
  directFrames: Frame[];
  statuses: string[];
}

(shouldRunRelayE2e ? describe : describe.skip)("direct WebRTC link - daemon E2E", () => {
  let relayProcess: ChildProcess | null = null;
  let relayEndpoint = "";
  let createPeer: DirectPeerFactory;
  let daemon: TestRamblaDaemon | null = null;
  let direct: DirectClient | null = null;
  let relayOutput = "";
  const tempDirs: string[] = [];

  /** Returns whether the local relay logged one leg of a relay connection closing at cutover. */
  function relayLegClosedAtCutover(role: "server" | "client", connectionId: string): boolean {
    return relayOutput
      .split("\n")
      .some(
        (line) =>
          line.includes(`v2:${role}(${connectionId}) disconnected`) &&
          line.includes("(1000: Moved to direct link)"),
      );
  }

  beforeAll(async () => {
    const factory = await loadNodeDirectPeerFactory();
    if (!factory) throw new Error("node-datachannel did not load");
    createPeer = factory;
    const port = await getAvailablePort();
    relayEndpoint = `127.0.0.1:${port}`;
    relayProcess = spawn(
      "npx",
      [
        "wrangler",
        "dev",
        "--local",
        "--ip",
        "127.0.0.1",
        "--port",
        String(port),
        "--live-reload=false",
        "--show-interactive-dev-session=false",
      ],
      { cwd: relayDir, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] },
    );
    relayProcess.stdout?.on("data", (chunk: Buffer) => {
      relayOutput += chunk.toString("utf8");
    });
    relayProcess.stderr?.resume();
    await waitForRelay(port, 60_000);
  }, 90_000);

  afterEach(async () => {
    await direct?.client.close().catch(() => undefined);
    direct = null;
    await daemon?.close();
    daemon = null;
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  afterAll(() => {
    relayProcess?.kill("SIGTERM");
  });

  async function startDaemon(
    create: typeof createTestRamblaDaemon = createTestRamblaDaemon,
  ): Promise<{ daemon: TestRamblaDaemon; lines: string[] }> {
    const { logger, lines } = createCapturingLogger();
    daemon = await create({ listen: "127.0.0.1", logger, relayEnabled: true, relayEndpoint });
    return { daemon, lines };
  }

  /** Connects a real DaemonClient over the relay, through the relay package's client factory over a node-datachannel peer. */
  async function connectDirectClient(
    target: TestRamblaDaemon,
    options: { dropClientSignals?: boolean } = {},
  ): Promise<DirectClient> {
    const pairing = await generateLocalPairingOffer({
      ramblaHome: target.ramblaHome,
      relayEnabled: true,
      relayEndpoint,
      relayPublicEndpoint: relayEndpoint,
      includeQr: false,
    });
    const offer = parseConnectionOfferFromUrl(pairing.url ?? "");
    if (!offer) throw new Error("Pairing did not produce a relay offer");

    const record: DirectClient = {
      client: null as unknown as DaemonClient,
      carriers: [],
      bases: [],
      peers: [],
      directFrames: [],
      statuses: [],
    };
    const webSocketTransports = createWebSocketTransportFactory(
      (url, wsOptions) =>
        new WebSocket(url, wsOptions?.protocols, {
          headers: wsOptions?.headers,
        }) as unknown as WebSocketLike,
    );
    const recordingBase: DaemonTransportFactory = (transportOptions) => {
      const base = webSocketTransports(transportOptions);
      const counts: BaseRecord = { sent: 0, received: 0, closed: false };
      record.bases.push(counts);
      base.onMessage(() => {
        counts.received += 1;
      });
      base.onClose(() => {
        counts.closed = true;
      });
      return {
        ...base,
        send: (data) => {
          counts.sent += 1;
          base.send(data);
        },
      };
    };
    const recordingPeer: DirectPeerFactory = (config, events) => {
      const peer = createPeer(config, {
        ...events,
        signal: (signal) => {
          if (!options.dropClientSignals) events.signal(signal);
        },
        message: (data, isBinary) => {
          record.directFrames.push(data);
          events.message(data, isBinary);
        },
      });
      const tracked = {
        closed: false,
        close: () => {
          tracked.closed = true;
          peer.close();
        },
      };
      record.peers.push(tracked);
      return {
        signal: (signal) => peer.signal(signal),
        send: (data) => {
          record.directFrames.push(data);
          peer.send(data);
        },
        get bufferedAmount() {
          return peer.bufferedAmount;
        },
        close: tracked.close,
      };
    };
    const carrierFactory = createDirectCarrierTransportFactory({
      baseFactory: recordingBase,
      offer: true,
      direct: { createPeer: recordingPeer, relayEndpoint },
    });
    const client = new DaemonClient({
      url: buildRelayWebSocketUrl({
        endpoint: relayEndpoint,
        useTls: false,
        serverId: offer.serverId,
        role: "client",
      }),
      clientId: `clid_direct_${Math.random().toString(36).slice(2)}`,
      clientType: "cli",
      connectTimeoutMs: 30_000,
      e2ee: { enabled: true, daemonPublicKeyB64: offer.daemonPublicKeyB64 },
      reconnect: { enabled: true, baseDelayMs: 100, maxDelayMs: 500 },
      transportFactory: (transportOptions) => {
        const carrier = carrierFactory(transportOptions);
        record.carriers.push(carrier);
        return carrier;
      },
    });
    record.client = client;
    client.subscribeConnectionStatus((status) => record.statuses.push(status.status));
    direct = record;
    await client.connect();
    return record;
  }

  test("cuts over within 10 s, closes the relay leg on both ends, and carries numbered messages in order through the cutover", async () => {
    const { daemon: target, lines } = await startDaemon();
    const link = await connectDirectClient(target);
    const connectedAt = Date.now();

    const arrived: number[] = [];
    const pending: Array<Promise<void>> = [];
    let sent = 0;
    let sentAfterCutover = 0;
    while (sentAfterCutover < 50) {
      expect(Date.now() - connectedAt).toBeLessThan(10_000);
      const index = sent;
      sent += 1;
      pending.push(
        (async () => {
          await link.client.ping({ requestId: `seq-${index}`, timeoutMs: 20_000 });
          arrived.push(index);
        })(),
      );
      if (logRecords(lines, "relay_direct_cutover").length > 0) sentAfterCutover += 1;
      await sleep(10);
    }
    await Promise.all(pending);
    expect(arrived).toEqual(Array.from({ length: sent }, (_, index) => index));

    expect(logRecords(lines, "node_datachannel_loaded")).toHaveLength(1);
    const [cutover] = logRecords(lines, "relay_direct_cutover");
    expect(typeof cutover.connectionId).toBe("string");
    const connectionId = String(cutover.connectionId);
    await waitFor(
      () => relayLegClosedAtCutover("server", connectionId),
      5000,
      "the daemon's relay leg to close",
    );
    await waitFor(
      () => relayLegClosedAtCutover("client", connectionId),
      5000,
      "the client's relay leg to close",
    );

    const relayCounts = { ...link.bases[0] };
    const directBefore = link.directFrames.length;
    for (let index = 0; index < 20; index += 1) {
      await link.client.ping({ requestId: `after-${index}` });
    }
    expect({ ...link.bases[0] }).toEqual(relayCounts);
    expect(link.directFrames.length).toBeGreaterThanOrEqual(directBefore + 40);
    expect(link.statuses).not.toContain("disconnected");

    for (const frame of link.directFrames) {
      expect(frameText(frame)).not.toMatch(/seq-|after-|"type"/);
    }
  }, 60_000);

  test("a 5 MiB message arrives intact over the DataChannel", async () => {
    const { daemon: target, lines } = await startDaemon();
    const link = await connectDirectClient(target);
    await waitFor(
      () => logRecords(lines, "relay_direct_cutover").length > 0,
      10_000,
      "the cutover",
    );
    const connectionId = String(logRecords(lines, "relay_direct_cutover")[0].connectionId);
    await waitFor(
      () => relayLegClosedAtCutover("client", connectionId),
      5000,
      "the client's relay leg to close",
    );
    const dir = await mkdtemp(path.join(os.tmpdir(), "rambla-direct-peer-"));
    tempDirs.push(dir);
    const content = patterned(5 * 1024 * 1024);
    await writeFile(path.join(dir, "large.bin"), content);
    const relayCounts = { ...link.bases[0] };
    const directBefore = link.directFrames.length;

    const result = await link.client.readFile(dir, "large.bin");

    expect(result.bytes.byteLength).toBe(content.byteLength);
    expect(Buffer.from(result.bytes).equals(Buffer.from(content))).toBe(true);
    expect(link.directFrames.length - directBefore).toBeGreaterThan(80);
    expect({ ...link.bases[0] }).toEqual(relayCounts);
  }, 60_000);

  test("killing the DataChannel after cutover reconnects on relay and upgrades again, the chunker pairing with the new carrier", async () => {
    const { daemon: target, lines } = await startDaemon();
    const link = await connectDirectClient(target);
    await waitFor(
      () => logRecords(lines, "relay_direct_cutover").length === 1,
      10_000,
      "the first cutover",
    );

    link.peers[0].close();

    await waitFor(() => link.statuses.includes("disconnected"), 10_000, "the reconnect to start");
    await waitFor(
      () => logRecords(lines, "relay_direct_cutover").length === 2,
      20_000,
      "the second cutover",
    );
    expect(link.carriers.length).toBeGreaterThanOrEqual(2);
    expect(link.peers).toHaveLength(2);
    expect(link.carriers.at(-1)?.negotiated).toBe(true);
    expect(link.statuses.at(-1)).toBe("connected");
    await link.client.ping({ requestId: "after-reconnect" });
  }, 60_000);

  test("when the DataChannel never connects, the client gives up at 15 s and the connection works on relay with no error", async () => {
    const { daemon: target, lines } = await startDaemon();
    const link = await connectDirectClient(target, { dropClientSignals: true });

    await waitFor(() => link.peers[0]?.closed === true, 20_000, "the client to give up");
    await link.client.ping({ requestId: "on-relay" });

    expect(logRecords(lines, "relay_direct_cutover")).toHaveLength(0);
    expect(link.bases[0].closed).toBe(false);
    expect(link.statuses).not.toContain("disconnected");
    expect(link.client.lastError).toBeNull();
    expect(link.directFrames).toHaveLength(0);
  }, 60_000);

  test("a daemon that cannot load node-datachannel logs it, offers no capability, and works on relay", async () => {
    vi.resetModules();
    vi.doMock("node-datachannel", () => {
      throw new Error("simulated missing node-datachannel binary");
    });
    try {
      const harness = await import("./test-utils/rambla-daemon.js");
      const { daemon: target, lines } = await startDaemon(harness.createTestRamblaDaemon);
      const link = await connectDirectClient(target);

      await link.client.ping({ requestId: "on-relay" });

      expect(logRecords(lines, "node_datachannel_load_failed")).toHaveLength(1);
      expect(link.carriers[0].negotiated).toBe(false);
      expect(link.peers).toHaveLength(0);
      expect(link.bases[0].closed).toBe(false);
    } finally {
      vi.doUnmock("node-datachannel");
    }
  }, 60_000);
});
