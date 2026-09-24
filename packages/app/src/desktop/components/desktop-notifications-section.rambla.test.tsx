// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: verifies the OS notifications switch, gating, and refresh placement.
/** @vitest-environment jsdom */
import "@/test/window-local-storage";
import React from "react";
// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: renders the notifications section for the toggle tests.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopNotificationsSection } from "@/desktop/components/desktop-notifications-section";
// RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: supplies the toast API the desktop settings hooks require.
import { ToastApiProvider } from "@/contexts/toast-api-context";
import { APP_SETTINGS_KEY, DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings";

// The repo's tsconfig picks the classic JSX transform, so rendered modules need a global React.
vi.stubGlobal("React", React);

// The unit stub theme has no real colors, and Reanimated rejects undefined ones.
// Returning a plain style object also keeps its mapper from touching unmounted nodes.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-native-reanimated")>();
  return {
    ...original,
    useAnimatedStyle: () => ({}),
  };
});

vi.mock("react-native-unistyles", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-native-unistyles")>();
  return {
    ...original,
    withUnistyles: <T,>(Component: T, mapper?: (theme: unknown) => Record<string, unknown>) => {
      const Render = (props: Record<string, unknown>) =>
        React.createElement(Component as React.ComponentType, {
          ...(mapper ? mapper(original.useUnistyles().theme) : {}),
          ...props,
        });
      return Render as T;
    },
  };
});

// The section renders nothing off Electron, so the desktop host must exist.
vi.mock("@/desktop/host", () => ({
  getDesktopHost: () => ({
    notification: {
      isSupported: async () => true,
      getPermissionLevel: async () => "granted",
      requestPermission: async () => "granted",
    },
  }),
  isElectronRuntime: () => true,
  isElectronRuntimeMac: () => false,
}));

vi.mock("@/desktop/electron/invoke", () => ({
  invokeDesktopCommand: vi.fn(async () => {
    throw new Error("no desktop IPC in tests");
  }),
}));

const storage = new Map<string, string>();

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

function seedStorage(preference: boolean) {
  storage.set(
    APP_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_CLIENT_SETTINGS, notificationsEnabled: preference }),
  );
}

const toastApi = {
  show: vi.fn(() => {}),
  copied: vi.fn(() => {}),
  error: vi.fn(() => {}),
};

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ToastApiProvider api={toastApi}>
          <DesktopNotificationsSection />
        </ToastApiProvider>
      </QueryClientProvider>,
    ),
  };
}

async function findSwitch() {
  return waitFor(() => {
    const control = screen.getByTestId("desktop-os-notifications-switch");
    expect(control).not.toBeNull();
    return control;
  });
}

describe("DesktopNotificationsSection OS notifications switch", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    storage.clear();
  });

  it("reflects the on preference in the switch and writes off on toggle", async () => {
    seedStorage(true);
    renderSection();

    const control = await findSwitch();
    expect(control.getAttribute("aria-checked")).toBe("true");
    // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: the refresh button is gone on the on path.
    expect(screen.queryByText("Refresh")).toBeNull();

    fireEvent.click(control);
    await waitFor(() => {
      const persisted = storage.get(APP_SETTINGS_KEY);
      expect(persisted).toBeDefined();
      expect(JSON.parse(persisted!).notificationsEnabled).toBe(false);
    });
  });

  it("hides the card and alerts when the preference is off, keeping heading and switch", async () => {
    seedStorage(false);
    renderSection();

    const control = await findSwitch();
    expect(control.getAttribute("aria-checked")).toBe("false");
    // RAMBLA-FORK: feature: 2026-09-22-feat-os-notification-toggle.md: the heading stays on the off path.
    expect(screen.getByText("Notifications")).toBeDefined();
    expect(screen.queryByTestId("desktop-notifications-play-sound-switch")).toBeNull();
    expect(screen.queryByTestId("desktop-notifications-test-success")).toBeNull();
    expect(screen.queryByTestId("desktop-notifications-test-error")).toBeNull();
  });
});
