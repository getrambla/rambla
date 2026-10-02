/**
 * @vitest-environment jsdom
 */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { within } from "@testing-library/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentPermissionResponse } from "@getrambla/protocol/agent-types";
import type { PendingPermission } from "@/types/shared";

const { platformState, stubTheme, recordedStyles } = vi.hoisted(() => {
  const spacing = (n: number) => n * 4;
  return {
    platformState: { isWeb: true },
    stubTheme: {
      colors: {
        accent: "#0a84ff",
        accentForeground: "#ffffff",
        foreground: "#ffffff",
        foregroundMuted: "#9a9a9a",
        foregroundExtraMuted: "#6a6a6a",
        surface1: "#101010",
        surface2: "#1a1a1a",
        border: "#333333",
        borderAccent: "#444444",
      },
      spacing: { 1: spacing(1), 2: spacing(2), 3: spacing(3) },
      fontSize: { base: 14 },
      fontWeight: { normal: "400" },
      borderRadius: { base: 4, md: 6 },
      borderWidth: { 1: 1 },
    },
    recordedStyles: { current: null as Record<string, Record<string, unknown>> | null },
  };
});

vi.mock("@/constants/platform", () => ({
  get isWeb() {
    return platformState.isWeb;
  },
  isNative: !platformState.isWeb,
  isDev: false,
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (make: (theme: typeof stubTheme) => Record<string, Record<string, unknown>>) => {
      const styles = make(stubTheme);
      recordedStyles.current = styles;
      return styles;
    },
  },
  useUnistyles: () => ({ theme: stubTheme }),
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("lucide-react-native", () => {
  const createIcon = (name: string) => () => React.createElement("span", { "data-icon": name });
  return { Check: createIcon("Check"), X: createIcon("X") };
});

vi.mock("@/components/ui/loading-spinner", () => ({ LoadingSpinner: () => null }));
vi.mock("@/components/ui/text-input", () => ({ EditingTextInput: () => null }));

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { QuestionFormCard } from "./question-form-card";
import { i18n as testI18n } from "@/i18n/i18next";

// Load translations so controls expose their real accessible names.
void testI18n;

function buildPermission(): PendingPermission {
  return {
    key: "perm-1",
    agentId: "agent-1",
    request: {
      id: "perm-1",
      provider: "claude",
      name: "AskUserQuestion",
      kind: "question",
      input: {
        questions: [
          {
            question: "Which provider?",
            header: "Provider",
            options: [
              { label: "Claude Code", description: "Anthropic's agent" },
              { label: "Codex" },
            ],
            multiSelect: false,
          },
        ],
      },
    },
  };
}

interface Mounted {
  root: Root;
  container: HTMLElement;
}

const mounted: Mounted[] = [];

function mountCard() {
  const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <QuestionFormCard
        permission={buildPermission()}
        onRespond={onRespond}
        isResponding={false}
      />,
    ),
  );
  mounted.push({ root, container });
  return within(container);
}

beforeEach(() => {
  platformState.isWeb = true;
});

afterEach(() => {
  for (const entry of mounted.splice(0)) {
    act(() => entry.root.unmount());
    entry.container.remove();
  }
});

async function importCardWithPlatform(isWeb: boolean) {
  platformState.isWeb = isWeb;
  vi.resetModules();
  return import("./question-form-card");
}

describe("QuestionFormCard text selection on web", () => {
  it("renders the question text, option labels, and descriptions selectable on web", () => {
    const view = mountCard();

    const question = view.getByText("Which provider?");
    expect((question as HTMLElement).style.userSelect).toBe("text");

    const label = view.getByText("Claude Code");
    expect((label as HTMLElement).style.userSelect).toBe("text");

    const description = view.getByText("Anthropic's agent");
    expect((description as HTMLElement).style.userSelect).toBe("text");
  });

  it("still toggles an answer when an option row is clicked on web", () => {
    const view = mountCard();

    const radio = view.getByRole("radio", { name: "Claude Code" });
    act(() => radio.click());

    expect(radio.getAttribute("aria-checked")).toBe("true");
  });

  it("adds no cursor property to the changed styles", () => {
    mountCard();

    const styles = recordedStyles.current;
    expect(styles).not.toBeNull();
    for (const key of ["questionText", "optionLabel", "optionDescription"]) {
      expect(styles?.[key]).toBeDefined();
      expect(styles?.[key]).not.toHaveProperty("cursor");
    }
  });

  it("emits no selection styles off-web", async () => {
    const { QuestionFormCard: NativeCard } = await importCardWithPlatform(false);

    const onRespond = vi.fn<(response: AgentPermissionResponse) => void>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <NativeCard permission={buildPermission()} onRespond={onRespond} isResponding={false} />,
      ),
    );
    mounted.push({ root, container });
    const view = within(container);

    expect((view.getByText("Which provider?") as HTMLElement).style.userSelect).toBe("");
    expect((view.getByText("Claude Code") as HTMLElement).style.userSelect).toBe("");
    expect((view.getByText("Anthropic's agent") as HTMLElement).style.userSelect).toBe("");
  });
});
