/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDictationField } from "./use-dictation-field.rambla";

function renderField(options: {
  isDictating?: () => boolean;
  acceptAndSend?: () => void;
  startDictation?: () => Promise<void>;
}) {
  return renderHook(() =>
    useDictationField({
      getSnapshot: () => ({ text: "", selection: { start: 0, end: 0 } }),
      writeText: () => {},
      ...options,
    }),
  ).result;
}

describe("useDictationField send press", () => {
  it("takes the press while recording and confirms the dictation", () => {
    const acceptAndSend = vi.fn();
    const result = renderField({ isDictating: () => true, acceptAndSend });

    expect(result.current.takeSendPress()).toBe(true);
    expect(acceptAndSend).toHaveBeenCalledTimes(1);
  });

  it("leaves the press to the composer when nothing is recording", () => {
    const acceptAndSend = vi.fn();
    const result = renderField({ isDictating: () => false, acceptAndSend });

    expect(result.current.takeSendPress()).toBe(false);
    expect(acceptAndSend).not.toHaveBeenCalled();
  });

  it("leaves the press alone when the composer wires no recording state", () => {
    const result = renderField({});

    expect(result.current.takeSendPress()).toBe(false);
  });
});

describe("useDictationField start", () => {
  it("anchors the region at the caret before the recording starts", async () => {
    let text = "draft ";
    const started: string[] = [];
    const result = renderHook(() =>
      useDictationField({
        getSnapshot: () => ({ text, selection: { start: text.length, end: text.length } }),
        writeText: (next) => {
          text = next;
        },
        startDictation: async () => {
          started.push(text);
        },
      }),
    ).result;

    await act(async () => {
      await result.current.startDictation();
    });
    act(() => {
      result.current.onPartialTranscript("", {
        requestId: "r1",
        segment: { id: "a", index: 0, text: "one", isFinal: false },
      });
    });

    expect(started).toEqual(["draft "]);
    expect(text).toBe("draft one");
  });

  it("asks the composer to start the recording", async () => {
    const started: string[] = [];
    const result = renderField({ startDictation: async () => void started.push("started") });

    await act(async () => {
      await result.current.startDictation();
    });

    expect(started).toEqual(["started"]);
  });
});
