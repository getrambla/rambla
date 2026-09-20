/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DictationSegment } from "@getrambla/protocol/dictation-segment.rambla";
import { useDictationField } from "./use-dictation-field.rambla";

const segment = (id: string, index: number, text: string, isFinal = false): DictationSegment => ({
  id,
  index,
  text,
  isFinal,
});

/** A composer field the hook reads back after every write, the way the text-input ref behaves. */
function createField(initial = "") {
  let text = initial;
  let selection = { start: initial.length, end: initial.length };
  /** Set to drop the next write, the way Android drops one that races a keystroke. */
  let dropNextWrite = false;
  const writes: string[] = [];
  return {
    writes,
    get text() {
      return text;
    },
    get selection() {
      return selection;
    },
    dropNextWrite() {
      dropNextWrite = true;
    },
    caretTo(position: number) {
      selection = { start: position, end: position };
    },
    /** What the user typing at the caret does to the field. */
    type(inserted: string) {
      const previous = text;
      text = text.slice(0, selection.start) + inserted + text.slice(selection.end);
      selection = {
        start: selection.start + inserted.length,
        end: selection.start + inserted.length,
      };
      return previous;
    },
    getSnapshot: () => ({ text, selection }),
    writeText(next: string, nextSelection: { start: number; end: number }) {
      writes.push(next);
      if (dropNextWrite) {
        dropNextWrite = false;
        return;
      }
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

describe("useDictationField", () => {
  it("writes nothing when the daemon sends no segment", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("hello there", { requestId: "r1" });
    });

    expect(field.writes).toEqual([]);
    expect(field.text).toBe("draft ");
  });

  it("hands the final the append path's own arguments when no segment arrived", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("hello there", { requestId: "r1" });
    });

    expect(result.current.resolveFinal("hello there", "draft ")).toEqual({
      text: "hello there",
      value: "draft ",
    });
  });

  it("lands each partial's words in the field at the caret", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", { requestId: "r1", segment: segment("a", 0, "one") });
      result.current.onPartialTranscript("", {
        requestId: "r2",
        segment: segment("a", 0, "one two"),
      });
    });

    expect(field.text).toBe("draft one two");
  });

  it("keeps text the user types before the region while the words keep landing", () => {
    const field = createField("");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", { requestId: "r1", segment: segment("a", 0, "one") });
    });
    act(() => {
      field.caretTo(0);
      const previous = field.type("hey ");
      result.current.onUserEdit(previous, field.text);
    });
    act(() => {
      result.current.onPartialTranscript("", {
        requestId: "r2",
        segment: segment("a", 0, "one two"),
      });
    });

    expect(field.text).toBe("hey one two");
  });

  it("takes the region back out of the field when the recording restarts", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", { requestId: "r1", segment: segment("a", 0, "one") });
      result.current.beginRestart();
    });

    expect(field.text).toBe("draft ");
  });

  it("hands the final what the field already shows once segments landed", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", {
        requestId: "r1",
        segment: segment("a", 0, "one two", true),
      });
    });

    // The words are in the field already, so the append path has nothing to append them to.
    expect(result.current.resolveFinal("one two", "draft ")).toEqual({
      text: "draft one two",
      value: "",
    });
  });

  it("re-issues a dictation write the field dropped", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", { requestId: "r1", segment: segment("a", 0, "one") });
      field.dropNextWrite();
      result.current.onPartialTranscript("", {
        requestId: "r2",
        segment: segment("a", 0, "one two", true),
      });
    });
    expect(field.text).toBe("draft one");

    act(() => {
      result.current.resolveFinal("one two", "draft ");
    });

    expect(field.text).toBe("draft one two");
  });

  it("appends the final when a restart emptied the region and nothing landed after it", () => {
    const field = createField("draft ");
    const result = renderField(field);

    act(() => {
      result.current.beginDictation();
      result.current.onPartialTranscript("", { requestId: "r1", segment: segment("a", 0, "one") });
      result.current.beginRestart();
    });

    expect(result.current.resolveFinal("one two", "draft ")).toEqual({
      text: "one two",
      value: "draft ",
    });
  });
});
