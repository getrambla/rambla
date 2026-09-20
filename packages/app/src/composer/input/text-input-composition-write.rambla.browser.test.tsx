import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EditingTextInput } from "@/components/ui/text-input/text-input.web";
import type { EditingTextInputHandle } from "@/components/ui/text-input";

interface MountedInput {
  root: Root;
  container: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  inputRef: React.MutableRefObject<EditingTextInputHandle | null>;
}

const mountedInputs: MountedInput[] = [];

function ignoreTextChange(): void {}

function mountInput(): MountedInput {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const inputRef =
    React.createRef<EditingTextInputHandle>() as React.MutableRefObject<EditingTextInputHandle | null>;

  act(() => {
    root.render(
      <EditingTextInput
        ref={inputRef}
        initialValue=""
        multiline={true}
        onChangeText={ignoreTextChange}
        testID="composer-input"
      />,
    );
  });

  const textarea = container.querySelector("textarea");
  if (!textarea) {
    throw new Error("Text input did not render a textarea");
  }

  const mounted = { root, container, textarea, inputRef };
  mountedInputs.push(mounted);
  return mounted;
}

function startComposition(textarea: HTMLTextAreaElement, text: string): void {
  textarea.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!valueSetter) {
    throw new Error("HTML textarea value setter is unavailable");
  }
  valueSetter.call(textarea, text);
  textarea.dispatchEvent(new InputEvent("input", { bubbles: true, data: text }));
}

afterEach(() => {
  for (const mounted of mountedInputs.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("EditingTextInput writes during an IME composition", () => {
  it("skips a write that asked to be skipped", () => {
    const mounted = mountInput();

    act(() => {
      startComposition(mounted.textarea, "한");
      mounted.inputRef.current?.replaceText("dictated", undefined, {
        skipWhileComposing: true,
      });
    });

    expect(mounted.textarea.value).toBe("한");
  });

  it("takes a write that did not ask to be skipped", () => {
    const mounted = mountInput();

    act(() => {
      startComposition(mounted.textarea, "한");
      mounted.inputRef.current?.replaceText("sent");
    });

    expect(mounted.textarea.value).toBe("sent");
  });
});
