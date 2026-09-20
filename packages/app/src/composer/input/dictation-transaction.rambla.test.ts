import { describe, expect, it } from "vitest";
import { applySegment, applyUserEdit, beginDictation, beginRestart } from "./dictation-transaction";

describe("dictation transaction", () => {
  it("anchors the region at the caret when dictation begins", () => {
    expect(beginDictation({ start: 4, end: 7 })).toEqual({ anchor: 7, segments: [] });
  });

  it("shifts the region for typing before it and keeps typing after it", () => {
    const started = beginDictation({ start: 3, end: 3 });
    const first = applySegment({
      text: "Hi ",
      selection: { start: 3, end: 3 },
      state: started,
      segment: { id: "a", index: 0, text: "one", isFinal: false },
    });
    expect(first.text).toBe("Hi one");
    expect(first.selection).toEqual({ start: 6, end: 6 });

    const afterTypingBefore = applyUserEdit({
      previousText: "Hi one",
      nextText: "Oh Hi one",
      state: first.state,
    });
    expect(afterTypingBefore.anchor).toBe(6);
    expect(afterTypingBefore.segments[0]?.frozenPrefix).toBe(null);

    const second = applySegment({
      text: "Oh Hi one",
      selection: { start: 9, end: 9 },
      state: afterTypingBefore,
      segment: { id: "a", index: 0, text: "one two", isFinal: false },
    });
    expect(second.text).toBe("Oh Hi one two");

    const afterTypingAfter = applyUserEdit({
      previousText: "Oh Hi one two",
      nextText: "Oh Hi one two ok",
      state: second.state,
    });
    expect(afterTypingAfter.anchor).toBe(6);
    expect(afterTypingAfter.segments[0]?.frozenPrefix).toBe(null);

    const third = applySegment({
      text: "Oh Hi one two ok",
      selection: { start: 16, end: 16 },
      state: afterTypingAfter,
      segment: { id: "a", index: 0, text: "one two three", isFinal: false },
    });
    expect(third.text).toBe("Oh Hi one two three ok");
  });

  it("freezes a segment up to the end of an edit inside it", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const dictated = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hello world", isFinal: false },
    });
    const edited = applyUserEdit({
      previousText: "hello world",
      nextText: "hello brave world",
      state: dictated.state,
    });
    expect(edited.segments[0]?.frozenPrefix).toBe("hello brave ");
    expect(edited.segments[0]?.text).toBe("hello brave world");

    const rewritten = applySegment({
      text: "hello brave world",
      selection: { start: 17, end: 17 },
      state: edited,
      segment: { id: "a", index: 0, text: "changed entirely", isFinal: false },
    });
    expect(rewritten.text).toBe("hello brave changed entirely");
  });

  it("re-anchors nothing when the caret moves without an edit", () => {
    const started = beginDictation({ start: 5, end: 5 });
    const dictated = applySegment({
      text: "Notes",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hi", isFinal: false },
    });
    expect(dictated.text).toBe("Noteshi");
    expect(dictated.selection).toEqual({ start: 0, end: 0 });
    expect(dictated.state.anchor).toBe(5);
  });

  it("keeps pending text as-is when the stream stops before a final", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const pending = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "half a thought", isFinal: false },
    });
    expect(pending.text).toBe("half a thought");
    expect(beginDictation(pending.selection).anchor).toBe(14);
  });

  it("leaves the text alone for an empty final segment", () => {
    const started = beginDictation({ start: 6, end: 6 });
    const applied = applySegment({
      text: "Draft.",
      selection: { start: 6, end: 6 },
      state: started,
      segment: { id: "a", index: 0, text: "", isFinal: true },
    });
    expect(applied.text).toBe("Draft.");
    expect(applied.selection).toEqual({ start: 6, end: 6 });
  });

  it("deletes nothing when dictation is cancelled", () => {
    const started = beginDictation({ start: 5, end: 5 });
    const dictated = applySegment({
      text: "Note ",
      selection: { start: 5, end: 5 },
      state: started,
      segment: { id: "a", index: 0, text: "one", isFinal: false },
    });
    expect(dictated.text).toBe("Note one");
    // Cancel is the caller dropping the transaction; only beginRestart takes text out.
    expect(beginDictation(dictated.selection)).toEqual({ anchor: 8, segments: [] });
  });

  it("clears the whole region on a restart, frozen segments included", () => {
    const started = beginDictation({ start: 3, end: 3 });
    const first = applySegment({
      text: "Hi ",
      selection: { start: 3, end: 3 },
      state: started,
      segment: { id: "a", index: 0, text: "one", isFinal: false },
    });
    const edited = applyUserEdit({
      previousText: "Hi one",
      nextText: "Hi ONE",
      state: first.state,
    });
    const second = applySegment({
      text: "Hi ONE",
      selection: { start: 6, end: 6 },
      state: edited,
      segment: { id: "b", index: 1, text: "two", isFinal: false },
    });
    expect(second.text).toBe("Hi ONE two");

    const restarted = beginRestart({
      text: second.text,
      selection: second.selection,
      state: second.state,
    });
    expect(restarted.text).toBe("Hi ");
    expect(restarted.selection).toEqual({ start: 3, end: 3 });
    expect(restarted.state).toEqual({ anchor: 3, segments: [] });
  });

  it("never rewrites a segment already marked final", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const settled = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "done.", isFinal: true },
    });
    const late = applySegment({
      text: settled.text,
      selection: settled.selection,
      state: settled.state,
      segment: { id: "a", index: 0, text: "different", isFinal: false },
    });
    expect(late.text).toBe("done.");
    expect(late.state).toEqual(settled.state);
  });

  it("holds the whole transcript in the text once the final segment lands", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const partial = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hello", isFinal: false },
    });
    const finalized = applySegment({
      text: partial.text,
      selection: partial.selection,
      state: partial.state,
      segment: { id: "a", index: 0, text: "hello there", isFinal: true },
    });
    const closing = applySegment({
      text: finalized.text,
      selection: finalized.selection,
      state: finalized.state,
      segment: { id: "b", index: 1, text: "friend", isFinal: true },
    });
    expect(closing.text).toBe("hello there friend");
  });

  it("orders segments by the daemon's index, not by arrival", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const late = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "b", index: 1, text: "second", isFinal: false },
    });
    const early = applySegment({
      text: late.text,
      selection: late.selection,
      state: late.state,
      segment: { id: "a", index: 0, text: "first", isFinal: false },
    });
    expect(early.text).toBe("first second");
  });

  it("inserts an unseen segment id into the region", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const first = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "one", isFinal: false },
    });
    const second = applySegment({
      text: first.text,
      selection: first.selection,
      state: first.state,
      segment: { id: "b", index: 1, text: "two", isFinal: false },
    });
    expect(second.text).toBe("one two");
    expect(second.state.segments.map((segment) => segment.id)).toEqual(["a", "b"]);
  });

  it("takes the whole incoming text for an unfrozen segment", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const first = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "he", isFinal: false },
    });
    const second = applySegment({
      text: first.text,
      selection: first.selection,
      state: first.state,
      segment: { id: "a", index: 0, text: "hello world", isFinal: false },
    });
    expect(second.text).toBe("hello world");
    expect(second.state.segments).toHaveLength(1);
  });

  it("appends past the longest common prefix for a frozen segment", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const first = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hello world", isFinal: false },
    });
    const second = applySegment({
      text: first.text,
      selection: first.selection,
      state: first.state,
      segment: { id: "b", index: 1, text: "next", isFinal: false },
    });
    expect(second.text).toBe("hello world next");

    const edited = applyUserEdit({
      previousText: "hello world next",
      nextText: "hello WORLD next",
      state: second.state,
    });
    expect(edited.segments[0]?.frozenPrefix).toBe("hello WORLD");
    expect(edited.segments[1]?.frozenPrefix).toBe(null);

    const grown = applySegment({
      text: "hello WORLD next",
      selection: { start: 11, end: 11 },
      state: edited,
      segment: { id: "a", index: 0, text: "hello world again", isFinal: false },
    });
    expect(grown.text).toBe("hello WORLD again next");
  });

  it("ignores a late message for an id already marked final", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const settled = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "first", isFinal: true },
    });
    const next = applySegment({
      text: settled.text,
      selection: settled.selection,
      state: settled.state,
      segment: { id: "b", index: 1, text: "second", isFinal: false },
    });
    expect(next.text).toBe("first second");

    const late = applySegment({
      text: next.text,
      selection: next.selection,
      state: next.state,
      segment: { id: "a", index: 0, text: "first revised", isFinal: true },
    });
    expect(late.text).toBe("first second");
    expect(late.selection).toEqual(next.selection);
    expect(late.state).toEqual(next.state);
  });

  it("lands a segment that arrives out of order in index order", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const late = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "b", index: 1, text: "second", isFinal: false },
    });
    const early = applySegment({
      text: late.text,
      selection: late.selection,
      state: late.state,
      segment: { id: "a", index: 0, text: "first", isFinal: false },
    });
    expect(early.state.segments.map((segment) => segment.index)).toEqual([0, 1]);
    expect(early.state.segments.map((segment) => segment.text)).toEqual(["first", "second"]);
  });

  it("sorts correctly when the indexes have gaps", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const five = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "c", index: 5, text: "five", isFinal: false },
    });
    const zero = applySegment({
      text: five.text,
      selection: five.selection,
      state: five.state,
      segment: { id: "a", index: 0, text: "zero", isFinal: false },
    });
    const two = applySegment({
      text: zero.text,
      selection: zero.selection,
      state: zero.state,
      segment: { id: "b", index: 2, text: "two", isFinal: false },
    });
    expect(two.state.segments.map((segment) => segment.index)).toEqual([0, 2, 5]);
    expect(two.text).toBe("zero two five");
  });

  it("lands new words after a mid-segment edit and keeps the edited words", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const dictated = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hello world", isFinal: false },
    });
    const edited = applyUserEdit({
      previousText: "hello world",
      nextText: "hello brave world",
      state: dictated.state,
    });
    const grown = applySegment({
      text: "hello brave world",
      selection: { start: 12, end: 12 },
      state: edited,
      segment: { id: "a", index: 0, text: "hello world today", isFinal: false },
    });
    expect(grown.text).toBe("hello brave world today");
  });

  it("loses no word when the engine re-words across the user's edit", () => {
    const started = beginDictation({ start: 0, end: 0 });
    const dictated = applySegment({
      text: "",
      selection: { start: 0, end: 0 },
      state: started,
      segment: { id: "a", index: 0, text: "hello world", isFinal: false },
    });
    const edited = applyUserEdit({
      previousText: "hello world",
      nextText: "hello brave world",
      state: dictated.state,
    });
    const reworded = applySegment({
      text: "hello brave world",
      selection: { start: 12, end: 12 },
      state: edited,
      segment: { id: "a", index: 0, text: "hello wonderful world today", isFinal: false },
    });
    expect(reworded.text).toBe("hello brave wonderful world today");
  });

  it("leaves the text outside the region byte-identical after a merge", () => {
    const started = beginDictation({ start: 4, end: 4 });
    const first = applySegment({
      text: "AAA  BBB",
      selection: { start: 8, end: 8 },
      state: started,
      segment: { id: "a", index: 0, text: "one", isFinal: false },
    });
    expect(first.text).toBe("AAA one BBB");
    const second = applySegment({
      text: first.text,
      selection: first.selection,
      state: first.state,
      segment: { id: "a", index: 0, text: "one two", isFinal: false },
    });
    expect(second.text).toBe("AAA one two BBB");
    expect(second.text.slice(0, 4)).toBe("AAA ");
    expect(second.text.slice(-4)).toBe(" BBB");
  });

  it("produces identical text and state when the same segment is applied twice", () => {
    const started = beginDictation({ start: 2, end: 2 });
    const once = applySegment({
      text: "ok",
      selection: { start: 2, end: 2 },
      state: started,
      segment: { id: "a", index: 0, text: "hello", isFinal: false },
    });
    const twice = applySegment({
      text: once.text,
      selection: once.selection,
      state: once.state,
      segment: { id: "a", index: 0, text: "hello", isFinal: false },
    });
    expect(twice.text).toBe(once.text);
    expect(twice.selection).toEqual(once.selection);
    expect(twice.state).toEqual(once.state);
  });
});
