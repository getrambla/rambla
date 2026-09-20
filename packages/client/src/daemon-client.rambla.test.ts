import { afterEach, expect, test, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "./daemon-client";

/** 15 s waiting for the finish to be taken plus 10 s for the text, inside the 30 s a person waits. */
const SILENT_DAEMON_FAILURE_MS = 25_000;

/** Minimal logger the client is happy with. */
function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** In-memory transport that answers the handshake and lets a test push session frames. */
function createMockTransport() {
  const sent: Array<string | Uint8Array | ArrayBuffer> = [];

  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};

  const transport: DaemonTransport = {
    send: (data) => {
      sent.push(data);
      if (typeof data !== "string") {
        return;
      }
      const frame = JSON.parse(data) as { type?: string };
      if (frame.type === "ping") {
        onMessage(JSON.stringify({ type: "pong" }));
      }
    },
    close: () => {},
    onMessage: (handler) => {
      onMessage = (data) => handler(data, typeof data !== "string");
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: () => () => {},
    onError: () => () => {},
  };

  return {
    transport,
    sent,
    triggerOpen: () => {
      onOpen();
      sent.length = 0;
      onMessage(
        JSON.stringify({
          type: "session",
          message: {
            type: "status",
            payload: {
              status: "server_info",
              serverId: "srv_rambla_test",
              hostname: null,
              version: null,
              features: { ownedSubscriptions: true },
            },
          },
        }),
      );
    },
    triggerMessage: (data: unknown) => onMessage(data),
  };
}

/** Wraps a session message in the envelope the transport delivers. */
function wrapSessionMessage(message: unknown): string {
  return JSON.stringify({ type: "session", message });
}

const clients: DaemonClient[] = [];

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients.length = 0;
  vi.useRealTimers();
});

/** A connected client whose timers the test drives. */
async function connectClient() {
  vi.useFakeTimers({
    toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "performance"],
  });
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_unit_test",
    logger: createMockLogger(),
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen();
  await connectPromise;
  return { client, mock };
}

test("gives up on a silent daemon inside the 30 second dictation ceiling", async () => {
  const { client } = await connectClient();

  const finishPromise = client.finishDictationStream("dict-silent", 0);
  let settled = false;
  const outcome = finishPromise.then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  // The daemon never takes the finish and never sends a final.
  await vi.advanceTimersByTimeAsync(SILENT_DAEMON_FAILURE_MS - 1);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await expect(outcome).resolves.toBeInstanceOf(Error);
});

test("honors a daemon deadline that asks for longer than the fallback", async () => {
  const { client, mock } = await connectClient();

  const finishPromise = client.finishDictationStream("dict-greedy", 0);
  let settled = false;
  const outcome = finishPromise.then(
    () => {
      settled = true;
      return null;
    },
    (error: unknown) => {
      settled = true;
      return error;
    },
  );

  const statedDeadlineMs = 5 * 60 * 1000;
  mock.triggerMessage(
    wrapSessionMessage({
      type: "dictation_stream_finish_accepted",
      payload: { dictationId: "dict-greedy", timeoutMs: statedDeadlineMs },
    }),
  );

  // The daemon measured the work; its stated deadline plus grace is what the client waits.
  await vi.advanceTimersByTimeAsync(statedDeadlineMs + 5_000 - 1);
  expect(settled).toBe(false);

  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
  await expect(outcome).resolves.toBeInstanceOf(Error);
});
