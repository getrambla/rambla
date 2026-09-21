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

describe("DictationRecordingControls failure text", () => {
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
    const rendered = render({ status: "recording", errorText: "microphone busy" });
    expect(rendered?.textContent).not.toContain("microphone busy");
  });
});
