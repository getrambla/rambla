// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: verifies both OS notification paths respect the preference.
/** @vitest-environment jsdom */
import React from "react";
import { act, render } from "@testing-library/react";
// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: mounts the session provider for the notification gate tests.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider } from "@/contexts/session-context";
// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: supplies the toast API the session provider requires.
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { sendOsNotification } from "@/utils/os-notifications";
import { APP_SETTINGS_KEY, DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings";
import type { DaemonClient } from "@getrambla/client/internal/daemon-client";

// The repo's tsconfig picks the classic JSX transform, so rendered modules need a global React.
vi.stubGlobal("React", React);

vi.mock("@/utils/os-notifications", () => ({
  sendOsNotification: vi.fn(async () => true),
}));

// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: stands in for the host runtime store the provider wires up.
vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeIsConnected: () => false,
  getHostRuntimeStore: () => ({
    applyAgentTurnLiveness: () => {},
    createViewedTimelineOwner: () => ({
      setActive: () => {},
      setConnected: () => {},
      replaceOpenTabAgentIds: () => {},
      enqueueStreamEvent: () => {},
      dispose: () => {},
    }),
    fetchAgentTimeline: async () => {
      throw new Error("not needed");
    },
  }),
}));

const storage = new Map<string, string>();

const toastApi = {
  show: vi.fn(() => {}),
  copied: vi.fn(() => {}),
  error: vi.fn(() => {}),
};

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
    removeItem: vi.fn(async (key: string) => {
      storage.delete(key);
    }),
  },
}));

type FireFn = () => void;

async function createHarness(preference: boolean): Promise<{
  fireAgentAttention: FireFn;
  fireTerminalAttention: FireFn;
}> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  storage.set(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_CLIENT_SETTINGS, notificationsEnabled: preference }),
  );

  let fireAgentAttention: FireFn = () => {};
  let fireTerminalAttention: FireFn = () => {};
  let attentionCount = 0;
  const handlers: Array<(message: unknown) => void> = [];

  const makeClient = () =>
    ({
      getLastServerInfoMessage: () => null,
      isConnected: true,
      sendHeartbeat: () => {},
      subscribeConnectionStatus: () => () => {},
      observeEvents: () => ({
        subscribe: ({ update }: { update: (message: unknown) => void }) => {
          handlers.push(update);
          return () => {};
        },
        release: async () => {},
      }),
      observeTimeline: () => ({
        subscribe: () => () => {},
        release: async () => {},
      }),
      on: () => () => {},
    }) as unknown as DaemonClient;
  const client = makeClient();
  const dispatch = (message: unknown) => {
    for (const handler of handlers) {
      handler(message);
    }
  };

  render(
    <QueryClientProvider client={queryClient}>
      <ToastApiProvider api={toastApi}>
        <SessionProvider serverId="server-1" client={client}>
          <div>mounted</div>
        </SessionProvider>
      </ToastApiProvider>
    </QueryClientProvider>,
  );

  // The settings query resolves from the seeded storage asynchronously; let it
  // land before driving the attention events.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  fireAgentAttention = () => {
    attentionCount += 1;
    dispatch({
      type: "agent_attention_required",
      payload: {
        agentId: "agent-1",
        reason: "finished",
        timestamp: new Date(Date.now() + attentionCount).toISOString(),
        shouldNotify: true,
        notification: {
          title: "Agent finished",
          body: "The run completed.",
          data: { serverId: "server-1", workspaceId: "workspace-1", agentId: "agent-1" },
        },
      },
    });
  };
  fireTerminalAttention = () => {
    dispatch({
      type: "terminal_attention_required",
      payload: {
        shouldNotify: true,
        title: "Terminal needs attention",
        body: "A terminal is waiting.",
        terminalId: "terminal-1",
        cwd: "/tmp",
      },
    });
  };

  return { fireAgentAttention, fireTerminalAttention };
}

describe("OS notification gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.clear();
  });

  it("fires agent and terminal notifications when the preference is on", async () => {
    const { fireAgentAttention, fireTerminalAttention } = await createHarness(true);

    fireAgentAttention();
    fireTerminalAttention();

    expect(sendOsNotification).toHaveBeenCalledTimes(2);
  });

  it("suppresses agent and terminal notifications when the preference is off", async () => {
    const { fireAgentAttention, fireTerminalAttention } = await createHarness(false);

    fireAgentAttention();
    fireTerminalAttention();

    expect(sendOsNotification).not.toHaveBeenCalled();
  });
});
