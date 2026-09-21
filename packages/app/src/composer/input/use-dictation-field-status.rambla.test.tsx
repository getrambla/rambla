/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DictationStatus } from "@/hooks/use-dictation";
import { useDictationField } from "./use-dictation-field.rambla";

/** A composer field the hook reads back after every write, the way the text-input ref behaves. */
function createField(initial: string) {
  let text = initial;
  let selection = { start: initial.length, end: initial.length };
  const writes: string[] = [];
  return {
    writes,
    get text() {
      return text;
    },
    getSnapshot: () => ({ text, selection }),
    writeText(next: string, nextSelection: { start: number; end: number }) {
      writes.push(next);
      text = next;
      selection = nextSelection;
    },
  };
}

function renderField(field: ReturnType<typeof createField>) {
  return renderHook(() =>
    useDictationField({ getSnapshot: field.getSnapshot, writeText: field.writeText }),
  ).result;
}

/** Speaks one segment into a freshly started recording. */
function dictate(
  result: { current: ReturnType<typeof useDictationField> },
  text: string,
  isFinal = false,
) {
  act(() => {
    result.current.startDictation();
    result.current.onPartialTranscript("", {
      requestId: "r1",
      segment: { id: "a", index: 0, text, isFinal },
    });
  });
}

function settle(
  result: { current: ReturnType<typeof useDictationField> },
  status: DictationStatus,
) {
  act(() => {
    result.current.onDictationStatus(status);
  });
}

describe("useDictationField dictation status", () => {
  it("keeps the pending text in the field when the recording stops (rule 5)", () => {
    const field = createField("draft ");
    const result = renderField(field);
    dictate(result, "half a thought");
    expect(field.text).toBe("draft half a thought");

    const writesBefore = field.writes.length;
    settle(result, "idle");

    expect(field.text).toBe("draft half a thought");
    expect(field.writes).toHaveLength(writesBefore);
  });

  it("deletes nothing when the user cancels or discards (rule 7)", () => {
    const field = createField("draft ");
    const result = renderField(field);
    dictate(result, "hello");
    expect(field.text).toBe("draft hello");

    // Cancel and discard both land the recording on idle without a final.
    settle(result, "idle");

    expect(field.text).toBe("draft hello");
  });

  it("drops the transaction on idle, so the next final appends instead of claiming the field", () => {
    const field = createField("draft ");
    const result = renderField(field);
    dictate(result, "hello");

    settle(result, "idle");

    expect(result.current.resolveFinal("hello", "draft ")).toEqual({
      text: "hello",
      value: "draft ",
    });
  });

  it("keeps the transaction when the recording fails, so a retry can rebuild the region", () => {
    const field = createField("draft ");
    const result = renderField(field);
    dictate(result, "hello");

    settle(result, "failed");

    expect(result.current.resolveFinal("hello", "draft ")).toEqual({
      text: "draft hello",
      value: "",
    });
  });
});
