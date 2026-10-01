/**
 * @vitest-environment jsdom
 */
// RAMBLA-FORK: fix: 2026-09-30-fix-sidebar-shortcut-hover-wrap.md: covers the one-line label, hover fade, and spoken shortcut.
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { shortcutEnv } = vi.hoisted(() => ({ shortcutEnv: { available: true } }));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => new Proxy({}, { get: () => ({}) }) },
  withUnistyles:
    (Component: React.ComponentType<Record<string, unknown>>) =>
    ({ uniProps: _uniProps, ...rest }: { uniProps?: unknown } & Record<string, unknown>) =>
      React.createElement(Component, rest),
}));

vi.mock("@/keyboard/availability", () => ({
  useKeyboardShortcutsAvailable: () => shortcutEnv.available,
}));

vi.mock("@/utils/shortcut-platform", () => ({ getShortcutOs: () => "non-mac" }));

// The workspace row module's own row pulls in the whole app; only its trailing slot and overlay are under test.
vi.mock("lucide-react-native", () => {
  const StubIcon = () => null;
  return { CircleAlert: StubIcon, Folder: StubIcon, FolderGit2: StubIcon, Monitor: StubIcon };
});
vi.mock("@/components/sidebar/project-leading-visual", () => ({
  ProjectStatusIndicator: () => null,
}));
vi.mock("@/components/sidebar/workspace-meta-row", () => ({ WorkspaceMetaRow: () => null }));
vi.mock("@/components/workspace-hover-card", () => ({ WorkspaceHoverCard: () => null }));
vi.mock("@/components/sidebar/workspace-trailing", () => ({
  hasSidebarWorkspaceTrailing: () => false,
}));
vi.mock("@/hooks/use-settings", () => ({ useAppSettings: () => ({ settings: {} }) }));
vi.mock("@/components/status-ring", () => ({ StatusRing: () => null }));
vi.mock("@/components/sidebar/sidebar-workspace-title", () => ({
  resolveSidebarWorkspacePrimaryLabel: () => "",
}));
vi.mock("@/workspace-labels", () => ({ useWorkspaceLabelDefinitions: () => [] }));
// The repo-root Vitest config has no react-native-svg stub, and the real package is Flow source.
vi.mock("react-native-svg", () => {
  const StubSvg = () => null;
  return { default: StubSvg, Defs: StubSvg, LinearGradient: StubSvg, Rect: StubSvg, Stop: StubSvg };
});

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { RamblaSidebarHeaderRow } from "./sidebar-header-row.rambla";

const TestIcon = () => React.createElement("span", { "data-icon": "plus" });
const noop = () => {};
const NEW_WORKSPACE_KEYS = [["mod", "alt", "n"]];
const BADGE_TEXT = "Ctrl+Alt+N";
const SCRIM_SELECTOR = '[data-testid="sidebar-workspace-trailing-scrim"]';

describe("RamblaSidebarHeaderRow", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;

  beforeEach(() => {
    shortcutEnv.available = true;
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

  const render = (props: {
    label: string;
    shortcutKeys?: string[][] | null;
    accessibilityLabel?: string;
  }) => {
    act(() => {
      root?.render(
        <RamblaSidebarHeaderRow
          icon={TestIcon as never}
          onPress={noop}
          testID="row"
          variant="compact"
          {...props}
        />,
      );
    });
  };

  const row = (): HTMLElement => {
    const element = container?.querySelector<HTMLElement>('[data-testid="row"]');
    if (!element) throw new Error("row not rendered");
    return element;
  };

  const labelElement = (label: string): HTMLElement => {
    const element = Array.from(row().querySelectorAll<HTMLElement>("*")).find(
      (el) => el.children.length === 0 && el.textContent === label,
    );
    if (!element) throw new Error(`label ${label} not rendered`);
    return element;
  };

  const pointer = (type: "enter" | "leave") => {
    const usesPointerEvents = typeof window.PointerEvent === "function";
    const eventType = `${usesPointerEvents ? "pointer" : "mouse"}${type}`;
    act(() => {
      const event = new MouseEvent(eventType, { bubbles: false });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      row().dispatchEvent(event);
    });
  };

  const badgeShown = () => row().textContent?.includes(BADGE_TEXT) ?? false;
  const scrimShown = () => row().querySelector(SCRIM_SELECTOR) !== null;

  it("limits the label to one line with an ellipsis", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    const style = window.getComputedStyle(labelElement("New workspace"));
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it("mounts nothing after the label when the row is not hovered", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(labelElement("New workspace").nextElementSibling).toBeNull();
  });

  it("shows the badge and scrim only while hovered", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(badgeShown()).toBe(false);
    expect(scrimShown()).toBe(false);

    pointer("enter");
    expect(badgeShown()).toBe(true);
    expect(scrimShown()).toBe(true);

    pointer("leave");
    expect(badgeShown()).toBe(false);
    expect(scrimShown()).toBe(false);
    expect(labelElement("New workspace").nextElementSibling).toBeNull();
  });

  it("speaks the label and badge text whether or not the row is hovered", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(row().getAttribute("aria-label")).toBe(`New workspace, ${BADGE_TEXT}`);
    pointer("enter");
    expect(row().getAttribute("aria-label")).toBe(`New workspace, ${BADGE_TEXT}`);
    pointer("leave");
    expect(row().getAttribute("aria-label")).toBe(`New workspace, ${BADGE_TEXT}`);
  });

  it("speaks exactly the label when the row has no shortcut", () => {
    render({ label: "History" });
    expect(row().getAttribute("aria-label")).toBe("History");
  });

  it("speaks exactly the label when shortcuts are unavailable", () => {
    shortcutEnv.available = false;
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(row().getAttribute("aria-label")).toBe("New workspace");
  });

  it("lets the caller's accessibilityLabel win", () => {
    render({
      label: "New workspace",
      shortcutKeys: NEW_WORKSPACE_KEYS,
      accessibilityLabel: "Create a workspace",
    });
    expect(row().getAttribute("aria-label")).toBe("Create a workspace");
  });
});
