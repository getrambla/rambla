/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { theme } = vi.hoisted(() => ({
  theme: {
    iconSize: { sm: 14, md: 18, lg: 22 },
    colors: {
      accent: "#0a84ff",
      accentForeground: "#ffffff",
      foreground: "#ffffff",
      surface0: "#000000",
      border: "#555555",
    },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  useUnistyles: () => ({ theme }),
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return {
    X: createIcon("X"),
    ArrowUp: createIcon("ArrowUp"),
    RefreshCcw: createIcon("RefreshCcw"),
    Check: createIcon("Check"),
    Mic: createIcon("Mic"),
    Pencil: createIcon("Pencil"),
  };
});

vi.mock("./volume-meter", () => ({ VolumeMeter: () => null }));
vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { i18n } from "@/i18n/i18next";
import { DictationControls, DictationOverlay } from "./dictation-controls";

const noop = () => {};
const asyncNoop = async () => {};

describe("DictationOverlay retry control", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  const renderFailed = (onRetry: (() => void) | undefined) => {
    act(() => {
      root?.render(
        <DictationOverlay
          volume={0}
          duration={0}
          isRecording={false}
          isProcessing={false}
          status="failed"
          onCancel={noop}
          onAccept={asyncNoop}
          onAcceptAndSend={asyncNoop}
          onRetry={onRetry}
          onDiscard={noop}
        />,
      );
    });
    return container?.querySelector(`[aria-label="${i18n.t("message.dictation.retry")}"]`) ?? null;
  };

  it("offers no retry control when the failure has nothing to retry", () => {
    expect(renderFailed(undefined)).toBeNull();
  });

  it("offers the retry control when a retry is possible", () => {
    expect(renderFailed(vi.fn())).not.toBeNull();
  });
});

describe("DictationControls failure state", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount();
      });
    }
    root = null;
    container?.remove();
    container = null;
  });

  const renderFailed = (input: { onRetry?: () => void; errorText?: string }) => {
    act(() => {
      root?.render(
        <DictationControls
          volume={0}
          duration={0}
          isRecording={false}
          isProcessing={false}
          status="failed"
          errorText={input.errorText}
          onStart={noop}
          onCancel={noop}
          onAccept={asyncNoop}
          onAcceptAndSend={asyncNoop}
          onRetry={input.onRetry}
          onDiscard={noop}
        />,
      );
    });
    return container;
  };

  const retryControl = (node: HTMLElement | null) =>
    node?.querySelector(`[aria-label="${i18n.t("message.dictation.retry")}"]`) ?? null;

  it("offers no retry control when the failure has nothing to retry", () => {
    expect(retryControl(renderFailed({}))).toBeNull();
  });

  it("offers the retry control when a retry is possible", () => {
    expect(retryControl(renderFailed({ onRetry: vi.fn() }))).not.toBeNull();
  });

  it("says what failed", () => {
    const node = renderFailed({ onRetry: vi.fn(), errorText: "Microphone stopped" });
    expect(node?.textContent).toContain(
      i18n.t("message.dictation.failed", { error: "Microphone stopped" }),
    );
  });

  it("asks for a retry when the failure came with no reason", () => {
    const node = renderFailed({ onRetry: vi.fn() });
    expect(node?.textContent).toContain(i18n.t("message.dictation.failedRetry"));
  });
});
