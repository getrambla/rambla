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
      foregroundMuted: "#aaaaaa",
      surface0: "#000000",
      surface1: "#111111",
      surface2: "#222222",
      border: "#555555",
      statusDotDanger: "#f12e2f",
      destructiveForeground: "#ff6b6b",
    },
    spacing: { 1: 4, 2: 8, 3: 12, 4: 16 },
    borderRadius: { full: 9999, lg: 8 },
    fontSize: { sm: 12, base: 14 },
    fontWeight: { semibold: "600" },
  },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  useUnistyles: () => ({ theme }),
  withUnistyles: (Component: unknown) => Component,
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => {
    const Icon = () => React.createElement("span", { "data-icon": name });
    Icon.displayName = name;
    return Icon;
  };
  return {
    X: createIcon("X"),
    ArrowUp: createIcon("ArrowUp"),
    RefreshCcw: createIcon("RefreshCcw"),
    Check: createIcon("Check"),
    Mic: createIcon("Mic"),
    Pencil: createIcon("Pencil"),
  };
});

vi.mock("@/components/dictation-controls", () => ({
  DictationControls: () => React.createElement("div", { "data-testid": "controls" }),
}));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { i18n } from "@/i18n/i18next";
import {
  DictationRecordingControls,
  type DictationRecordingControlsProps,
} from "./dictation-recording-controls.rambla";

const noop = () => {};
const asyncNoop = async () => {};

function baseProps(): DictationRecordingControlsProps {
  return {
    show: true,
    volume: 0,
    duration: 0,
    isRecording: false,
    isProcessing: false,
    status: "failed",
    canRetry: true,
    onStart: noop,
    onCancel: noop,
    onAccept: asyncNoop,
    onAcceptAndSend: asyncNoop,
    onRetry: noop,
    onDiscard: noop,
  };
}

describe("DictationRecordingControls strip", () => {
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

  const render = (props: Partial<ReturnType<typeof baseProps>> = {}) => {
    act(() => {
      root?.render(<DictationRecordingControls {...baseProps()} {...props} />);
    });
    return container;
  };

  const renderRecording = (props: Partial<ReturnType<typeof baseProps>> = {}) =>
    render({ status: "recording", isRecording: true, ...props });

  it("shows the failure reason when the dictation fails", () => {
    const rendered = render({ errorText: "microphone busy" });
    expect(rendered?.textContent).toContain(
      i18n.t("message.dictation.failed", { error: "microphone busy" }),
    );
  });

  it("shows the retry hint when the failure carries no reason", () => {
    const rendered = render();
    expect(rendered?.textContent).toContain(i18n.t("message.dictation.failedRetry"));
  });

  it("shows no failure text outside the failed state", () => {
    const rendered = renderRecording({ errorText: "microphone busy" });
    expect(rendered?.textContent).not.toContain("microphone busy");
  });

  it("renders the strip row in flow with no absolute positioning", () => {
    const rendered = renderRecording();
    const strip = rendered?.querySelector('[data-testid="dictation-recording-strip"]');
    expect(strip).not.toBeNull();
    expect(strip?.getAttribute("class")).not.toContain("position-absolute");
    expect((strip as HTMLElement | null)?.style?.position).not.toBe("absolute");
  });

  it("renders every recording action", () => {
    const rendered = renderRecording();
    expect(rendered?.textContent).toContain("00:00");
    for (const label of [
      i18n.t("message.dictation.cancel"),
      i18n.t("message.dictation.insert"),
      i18n.t("message.dictation.insertAndSend"),
    ]) {
      expect(rendered?.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
  });

  it("keeps the timer visible in the processing state with actions disabled", () => {
    const rendered = render({ status: "recording", isProcessing: true });
    expect(rendered?.textContent).toContain("00:00");
    const cancelButton = rendered?.querySelector(
      `[aria-label="${i18n.t("message.dictation.cancel")}"]`,
    );
    expect(cancelButton?.hasAttribute("disabled")).toBe(true);
  });

  it("offers retry and discard in the failed state instead of accept", () => {
    const rendered = render();
    expect(
      rendered?.querySelector(`[aria-label="${i18n.t("message.dictation.retry")}"]`),
    ).not.toBeNull();
    expect(
      rendered?.querySelector(`[aria-label="${i18n.t("message.dictation.insert")}"]`),
    ).toBeNull();
  });

  it("renders nothing while dictation is inactive", () => {
    const rendered = render({ show: false });
    expect(rendered?.textContent).toBe("");
  });
});
