import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JSDOM } from "jsdom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantFileLinkResolverProvider,
  type AssistantFileLinkResolverConfig,
} from "./provider";
import { AssistantMarkdownLink } from "./link";

vi.mock("@/constants/platform", () => ({
  isWeb: true,
  isNative: false,
}));

vi.mock("@/constants/layout", () => ({
  useIsCompactFormFactor: () => false,
}));

vi.mock("@gorhom/portal", () => ({
  Portal: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@gorhom/bottom-sheet", () => ({
  useBottomSheetModalInternal: () => null,
}));

vi.mock("react-native-reanimated", () => ({
  default: {
    View: "div",
  },
  FadeIn: { duration: () => ({}) },
  FadeOut: { duration: () => ({}) },
}));

vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: (styles: unknown) => styles,
  },
}));

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key }),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: null, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock("./use-file-link", async (importOriginal) => {
  const original = await importOriginal<typeof import("./use-file-link")>();
  return {
    ...original,
    useFileLink: () => ({
      target: { path: "/tmp/workspace/src/foo.ts", lineStart: 3 },
      onHoverIn: () => {},
      onPress: () => {},
      open: () => {},
    }),
  };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", dom.window);
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("HTMLElement", dom.window.HTMLElement);
  vi.stubGlobal("Node", dom.window.Node);
  vi.stubGlobal("navigator", dom.window.navigator);
  vi.stubGlobal("getComputedStyle", dom.window.getComputedStyle);

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
  container = null;
  vi.unstubAllGlobals();
});

const config: AssistantFileLinkResolverConfig = {
  client: null,
  workspaceRoot: "/tmp/workspace",
};

const source = {
  href: "src/foo.ts",
  text: "foo.ts",
  sourceType: "inline-code",
} as const;
const style = {};

function renderLink(): void {
  act(() => {
    root?.render(
      <AssistantFileLinkResolverProvider {...config}>
        <AssistantMarkdownLink source={source} style={style}>
          foo.ts
        </AssistantMarkdownLink>
      </AssistantFileLinkResolverProvider>,
    );
  });
}

function triggerWrapper(): Element | null | undefined {
  return container?.firstElementChild;
}

function tooltipText(): string | null {
  return (container?.ownerDocument.body.textContent?.includes("src/foo.ts:3") ?? null)
    ? "src/foo.ts:3"
    : null;
}

async function hoverUntilOpen(): Promise<void> {
  const wrapper = triggerWrapper();
  expect(wrapper).not.toBeNull();
  act(() => {
    wrapper?.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 450));
  });
}

describe("AssistantMarkdownLink hover tooltip", () => {
  it("opens the path tooltip after the hover delay and closes on hover out", async () => {
    renderLink();
    expect(tooltipText()).toBeNull();

    await hoverUntilOpen();
    expect(tooltipText()).toBe("src/foo.ts:3");

    const wrapper = triggerWrapper();
    act(() => {
      wrapper?.dispatchEvent(new window.MouseEvent("mouseout", { bubbles: true }));
    });
    expect(tooltipText()).toBeNull();
  });

  it("closes the path tooltip when the mouse is released on the link", async () => {
    renderLink();

    await hoverUntilOpen();
    expect(tooltipText()).toBe("src/foo.ts:3");

    const wrapper = triggerWrapper();
    act(() => {
      wrapper?.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
    });
    expect(tooltipText()).toBeNull();
  });
});
