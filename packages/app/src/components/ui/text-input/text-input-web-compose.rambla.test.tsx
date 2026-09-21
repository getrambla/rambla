// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditingTextInput } from "./text-input.web";
import type { EditingTextInputHandle } from "./types";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (root && container) {
    act(() => {
      root?.unmount();
    });
    container.remove();
  }
  root = null;
  container = null;
});

function mount(initialValue = ""): React.RefObject<EditingTextInputHandle | null> {
  const ref = React.createRef<EditingTextInputHandle>();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<EditingTextInput ref={ref} initialValue={initialValue} multiline={true} />);
  });
  return ref;
}

function textarea(): HTMLTextAreaElement {
  const element = container?.querySelector("textarea");
  if (!element) throw new Error("The web text input did not render a textarea");
  return element;
}

function dispatchComposition(type: "compositionstart" | "compositionend"): void {
  act(() => {
    textarea().dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });
}

describe("EditingTextInput web replaceText during composition", () => {
  it("returns early while composing and writes once composition ends", () => {
    const ref = mount("");
    const field = textarea();

    dispatchComposition("compositionstart");
    field.value = "halberd";
    act(() => {
      ref.current?.replaceText("daemon text", { start: 0, end: 0 });
    });
    expect(field.value, "A dictation write landed mid-composition and cut the IME candidate").toBe(
      "halberd",
    );

    dispatchComposition("compositionend");
    act(() => {
      ref.current?.replaceText("daemon text", { start: 0, end: 0 });
    });
    expect(field.value).toBe("daemon text");
  });
});
