/**
 * @vitest-environment jsdom
 */
// RAMBLA-FORK: fix: 2026-09-30-fix-sidebar-shortcut-hover-wrap.md: covers the one-line label, hover fade, and spoken shortcut.
// RAMBLA-FORK: fix: 2026-10-09-merge-upstream-v0-11-1.md: tests upstream's rewritten row across variants, trailing node, and null icon.
import React, { act, type ReactNode } from "react";
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

vi.stubGlobal("React", React);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

import { SidebarHeaderRow, type SidebarRowIcon } from "./sidebar-header-row";

const TestIcon = () => React.createElement("span", { "data-icon": "plus" });
const noop = () => {};
const NEW_WORKSPACE_KEYS = [["mod", "alt", "n"]];
const BADGE_TEXT = "Ctrl+Alt+N";
const LONG_LABEL = "A workspace label long enough to overflow any sidebar width it is given";

describe("SidebarHeaderRow", () => {
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
    variant?: "header" | "compact" | "inline";
    icon?: SidebarRowIcon | null;
    trailing?: ReactNode;
  }) => {
    act(() => {
      root?.render(
        <SidebarHeaderRow
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

  // Upstream's row tracks hover on the plain View that wraps the button and its right slot.
  const hoverTarget = (): HTMLElement => {
    const element = row().parentElement;
    if (!element) throw new Error("hover target not rendered");
    return element;
  };

  const labelElement = (label: string): HTMLElement => {
    const element = Array.from(row().querySelectorAll<HTMLElement>("*")).find(
      (el) => el.children.length === 0 && el.textContent === label,
    );
    if (!element) throw new Error(`label ${label} not rendered`);
    return element;
  };

  // React builds onPointerEnter/onPointerLeave from pointerover/pointerout crossing the element's edge.
  const pointer = (type: "enter" | "leave") => {
    act(() => {
      const event = new MouseEvent(type === "enter" ? "pointerover" : "pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      });
      Object.defineProperty(event, "pointerType", { value: "mouse" });
      hoverTarget().dispatchEvent(event);
    });
  };

  const badgeShown = () => hoverTarget().textContent?.includes(BADGE_TEXT) ?? false;

  const expectOneLine = (label: string) => {
    const style = window.getComputedStyle(labelElement(label));
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
  };

  it("limits the label to one line with an ellipsis", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    const style = window.getComputedStyle(labelElement("New workspace"));
    expect(style.whiteSpace).toBe("nowrap");
    expect(style.textOverflow).toBe("ellipsis");
  });

  it.each(["header", "compact", "inline"] as const)(
    "truncates a long label to one line in the %s variant",
    (variant) => {
      render({ label: LONG_LABEL, shortcutKeys: NEW_WORKSPACE_KEYS, variant });
      expectOneLine(LONG_LABEL);
      pointer("enter");
      expectOneLine(LONG_LABEL);
    },
  );

  it("truncates a long label to one line beside a trailing node", () => {
    render({
      label: LONG_LABEL,
      trailing: React.createElement("span", null, "trailing"),
    });
    expectOneLine(LONG_LABEL);
    expect(hoverTarget().textContent).toContain("trailing");
  });

  it("truncates a long label to one line with a null icon", () => {
    render({ label: LONG_LABEL, icon: null });
    expectOneLine(LONG_LABEL);
  });

  it("mounts nothing after the label when the row is not hovered", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(labelElement("New workspace").nextElementSibling).toBeNull();
  });

  it("shows the shortcut only while hovered", () => {
    render({ label: "New workspace", shortcutKeys: NEW_WORKSPACE_KEYS });
    expect(badgeShown()).toBe(false);
    pointer("enter");
    expect(badgeShown()).toBe(true);
    pointer("leave");
    expect(badgeShown()).toBe(false);
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
