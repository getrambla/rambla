import { describe, expect, it } from "vitest";
import {
  applySegment,
  applyUserEdit,
  beginDictation,
  beginRestart,
} from "./dictation-transaction.rambla";

function partial(id: string, index: number, text: string) {
  return { id, index, text, isFinal: false };
}

function final(id: string, index: number, text: string) {
  return { id, index, text, isFinal: true };
}

const caret = (position: number) => ({ start: position, end: position });

describe("beginDictation", () => {
  it("anchors the region at the caret (rule 1)", () => {
    expect(beginDictation(caret(2))).toEqual({ anchor: 2, segments: [] });
  });

  it("anchors at the end of a selected range (rule 1)", () => {
    expect(beginDictation({ start: 2, end: 7 })).toEqual({ anchor: 7, segments: [] });
  });
});

describe("applySegment", () => {
  it("inserts an unseen segment at the anchor and moves the caret with it", () => {
    const result = applySegment({
      text: "Note: tail",
      selection: caret(5),
      state: beginDictation(caret(5)),
      segment: partial("a", 0, "hello"),
    });

    expect(result.text).toBe("Note:hello tail");
    expect(result.selection).toEqual(caret(10));
  });

  it("takes the incoming text whole for an unfrozen segment", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("a", 0, "hello there") });

    expect(second.text).toBe("hello there");
    expect(second.state.segments).toEqual([
      {
        id: "a",
        index: 0,
        text: "hello there",
        engineText: "hello there",
        gap: " ",
        frozenPrefix: null,
        engineTextAtFreeze: null,
        isFinal: false,
      },
    ]);
  });

  it("places a segment that arrives out of order in index order (rule 11)", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("b", 1, "world"),
    });
    const second = applySegment({ ...first, segment: partial("a", 0, "hello") });

    expect(second.text).toBe("hello world");
  });

  it("sorts correctly when the indexes have gaps", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("c", 4, "again") });
    const third = applySegment({ ...second, segment: partial("b", 2, "world") });

    expect(third.text).toBe("hello world again");
    expect(third.state.segments.map((segment) => segment.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves an empty segment out of the region", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "") });

    expect(second.text).toBe("hello");
  });

  it("produces identical text and state when the same segment is applied twice", () => {
    const once = applySegment({
      text: "keep ",
      selection: caret(5),
      state: beginDictation(caret(5)),
      segment: partial("a", 0, "hello"),
    });
    const twice = applySegment({ ...once, segment: partial("a", 0, "hello") });

    expect(twice.text).toBe(once.text);
    expect(twice.selection).toEqual(once.selection);
    expect(twice.state).toEqual(once.state);
  });

  it("leaves the text outside the region byte-identical after a merge", () => {
    const state = beginDictation(caret(6));
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state,
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("a", 0, "hello there") });

    expect(second.text.slice(0, 6)).toBe("before");
    expect(second.text.slice(-5)).toBe("after");
    expect(second.text).toBe("beforehello there after");
  });

  it("leaves a caret before the region untouched", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({
      ...first,
      selection: caret(3),
      segment: partial("a", 0, "hello there"),
    });

    expect(second.selection).toEqual(caret(3));
  });
});

describe("applyUserEdit", () => {
  function dictate(text: string) {
    return applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, text),
    });
  }

  it("shifts the region when the user types before it and swallows nothing (rule 2)", () => {
    const dictated = applySegment({
      text: "AB",
      selection: caret(1),
      state: beginDictation(caret(1)),
      segment: partial("a", 0, "hello"),
    });
    expect(dictated.text).toBe("AhelloB");

    const edited = applyUserEdit({
      previousText: "AhelloB",
      nextText: "AXhelloB",
      state: dictated.state,
    });
    expect(edited.anchor).toBe(2);

    const next = applySegment({
      text: "AXhelloB",
      selection: caret(2),
      state: edited,
      segment: partial("a", 0, "hello there"),
    });
    expect(next.text).toBe("AXhello thereB");
  });

  it("keeps the anchor and the typed text when the user types after the region (rule 2)", () => {
    const dictated = applySegment({
      text: "AB",
      selection: caret(1),
      state: beginDictation(caret(1)),
      segment: partial("a", 0, "hello"),
    });

    const edited = applyUserEdit({
      previousText: "AhelloB",
      nextText: "AhelloYB",
      state: dictated.state,
    });
    expect(edited.anchor).toBe(1);

    const next = applySegment({
      text: "AhelloYB",
      selection: caret(7),
      state: edited,
      segment: partial("a", 0, "hello there"),
    });
    expect(next.text).toBe("Ahello thereYB");
  });

  it("freezes a segment up to the end of the edit and appends later words (rule 3)", () => {
    const dictated = dictate("meet at noon");
    const edited = applyUserEdit({
      previousText: "meet at noon",
      nextText: "meet at one",
      state: dictated.state,
    });

    expect(edited.segments[0]).toMatchObject({
      text: "meet at one",
      frozenPrefix: "meet at one",
      engineTextAtFreeze: "meet at noon",
    });

    const next = applySegment({
      text: "meet at one",
      selection: caret(11),
      state: edited,
      segment: partial("a", 0, "meet at noon tomorrow"),
    });
    expect(next.text).toBe("meet at one tomorrow");
  });

  it("never lets a later message rewrite the frozen text (rule 3)", () => {
    const dictated = dictate("meet at noon");
    const edited = applyUserEdit({
      previousText: "meet at noon",
      nextText: "meet at one",
      state: dictated.state,
    });

    const first = applySegment({
      text: "meet at one",
      selection: caret(11),
      state: edited,
      segment: partial("a", 0, "meet at noon tomorrow"),
    });
    const second = applySegment({
      ...first,
      segment: partial("a", 0, "meet at noon tomorrow at ten"),
    });

    expect(second.text).toBe("meet at one tomorrow at ten");
  });

  it("keeps the engine words after a mid-segment edit and leaves the edited word alone", () => {
    const dictated = dictate("call me at noon today");
    const edited = applyUserEdit({
      previousText: "call me at noon today",
      nextText: "Call me at noon today",
      state: dictated.state,
    });
    expect(edited.segments[0]).toMatchObject({ frozenPrefix: "C", engineTextAtFreeze: "c" });

    const next = applySegment({
      text: "Call me at noon today",
      selection: caret(21),
      state: edited,
      segment: partial("a", 0, "call me at noon today please"),
    });
    expect(next.text).toBe("Call me at noon today please");
  });

  it("loses no engine word when the engine re-words across the user's edit", () => {
    const dictated = dictate("call me at noon today");
    const edited = applyUserEdit({
      previousText: "call me at noon today",
      nextText: "Call me at noon today",
      state: dictated.state,
    });

    const next = applySegment({
      text: "Call me at noon today",
      selection: caret(21),
      state: edited,
      segment: partial("a", 0, "call me at nine today please"),
    });
    expect(next.text).toBe("Call me at nine today please");
  });

  it("keeps the deletion when the user removes the space between two segments (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "world") });
    expect(second.text).toBe("beforehello world after");

    const edited = applyUserEdit({
      previousText: "beforehello world after",
      nextText: "beforehelloworld after",
      state: second.state,
    });
    const next = applySegment({
      text: "beforehelloworld after",
      selection: caret(16),
      state: edited,
      segment: partial("b", 1, "world today"),
    });

    expect(next.text).toBe("beforehelloworld today after");
    expect(next.text.slice(0, 6)).toBe("before");
    expect(next.text.slice(-6)).toBe(" after");
  });

  it("keeps the surrounding text when a deleted span straddles the region start (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    expect(first.text).toBe("beforehello after");

    const edited = applyUserEdit({
      previousText: "beforehello after",
      nextText: "befollo after",
      state: first.state,
    });
    const next = applySegment({
      text: "befollo after",
      selection: caret(7),
      state: edited,
      segment: partial("a", 0, "hello there"),
    });

    expect(next.text).toBe("befollo there after");
    expect(next.text.slice(0, 4)).toBe("befo");
    expect(next.text.slice(-6)).toBe(" after");
  });

  it("keeps what the user typed over a span straddling the region start (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });

    const edited = applyUserEdit({
      previousText: "beforehello after",
      nextText: "befoXllo after",
      state: first.state,
    });
    const next = applySegment({
      text: "befoXllo after",
      selection: caret(8),
      state: edited,
      segment: partial("a", 0, "hello there"),
    });

    expect(next.text).toBe("befoXllo there after");
    expect(next.text.slice(0, 5)).toBe("befoX");
    expect(next.text.slice(-6)).toBe(" after");
  });

  it("keeps the surrounding text when a deleted span straddles the region end (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });

    const edited = applyUserEdit({
      previousText: "beforehello after",
      nextText: "beforehelfter",
      state: first.state,
    });
    const next = applySegment({
      text: "beforehelfter",
      selection: caret(9),
      state: edited,
      segment: partial("a", 0, "hello there"),
    });

    expect(next.text).toBe("beforehel therefter");
    expect(next.text.slice(0, 6)).toBe("before");
    expect(next.text.slice(-4)).toBe("fter");
  });

  it("leaves no doubled separator when the user empties a segment", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "world") });
    expect(second.text).toBe("hello world");

    const edited = applyUserEdit({
      previousText: "hello world",
      nextText: "hello ",
      state: second.state,
    });
    const next = applySegment({
      text: "hello ",
      selection: caret(6),
      state: edited,
      segment: partial("b", 1, "world today"),
    });

    expect(next.text).toBe("hello today");
  });

  it("leaves no stranded separator when the user empties the first segment", () => {
    const first = applySegment({
      text: "",
      selection: caret(0),
      state: beginDictation(caret(0)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "world") });

    const edited = applyUserEdit({
      previousText: "hello world",
      nextText: " world",
      state: second.state,
    });
    const next = applySegment({
      text: " world",
      selection: caret(6),
      state: edited,
      segment: partial("b", 1, "world today"),
    });

    expect(next.text).toBe(" world today");
  });

  it("keeps a character typed exactly on a segment boundary (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "world") });

    const edited = applyUserEdit({
      previousText: "beforehello world after",
      nextText: "beforehelloX world after",
      state: second.state,
    });
    const next = applySegment({
      text: "beforehelloX world after",
      selection: caret(18),
      state: edited,
      segment: partial("b", 1, "world today"),
    });

    expect(next.text).toBe("beforehelloX world today after");
    expect(next.text.slice(0, 6)).toBe("before");
    expect(next.text.slice(-6)).toBe(" after");
  });

  it("keeps the deletion when the user removes a span across a segment boundary (rule 2)", () => {
    const first = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    const second = applySegment({ ...first, segment: partial("b", 1, "world") });

    const edited = applyUserEdit({
      previousText: "beforehello world after",
      nextText: "beforehelld after",
      state: second.state,
    });
    const next = applySegment({
      text: "beforehelld after",
      selection: caret(11),
      state: edited,
      segment: partial("b", 1, "world today"),
    });

    expect(next.text).toBe("beforehelld today after");
    expect(next.text.slice(0, 6)).toBe("before");
    expect(next.text.slice(-6)).toBe(" after");
  });

  it("re-anchors nothing when the caret moves without an edit (rule 4)", () => {
    const dictated = applySegment({
      text: "AB",
      selection: caret(1),
      state: beginDictation(caret(1)),
      segment: partial("a", 0, "hello"),
    });

    const next = applySegment({
      text: dictated.text,
      selection: caret(0),
      state: dictated.state,
      segment: partial("a", 0, "hello there"),
    });

    expect(next.state.anchor).toBe(1);
    expect(next.text).toBe("Ahello thereB");
  });
});

describe("finals and restart", () => {
  const started = { text: "typed ", selection: caret(6), state: beginDictation(caret(6)) };

  it("never rewrites a segment that was marked final (rule 9)", () => {
    const finished = applySegment({ ...started, segment: final("a", 0, "hello") });
    const late = applySegment({ ...finished, segment: partial("a", 0, "hello there") });

    expect(late.text).toBe("typed hello");
  });

  it("ignores a late message for an id already marked final", () => {
    const finished = applySegment({ ...started, segment: final("a", 0, "hello") });
    const late = applySegment({ ...finished, segment: final("a", 0, "") });

    expect(late.text).toBe(finished.text);
    expect(late.selection).toEqual(finished.selection);
    expect(late.state).toBe(finished.state);
  });

  it("leaves the text alone when a final carries no words (rule 6)", () => {
    const dictated = applySegment({ ...started, segment: partial("a", 0, "hello") });
    const empty = applySegment({ ...dictated, segment: final("b", 1, "") });

    expect(empty.text).toBe("typed hello");
    expect(empty.selection).toEqual(dictated.selection);
  });

  it("leaves a stopped recording's words alone when the next one starts (rule 5)", () => {
    const pending = applySegment({ ...started, segment: partial("a", 0, "half a thought") });
    expect(pending.text).toBe("typed half a thought");

    // Stopping drops the transaction. The next recording anchors at the caret and adds to the
    // field; nothing in the module reaches back into what the stopped one left behind.
    const next = applySegment({
      text: pending.text,
      selection: caret(pending.text.length),
      state: beginDictation(caret(pending.text.length)),
      segment: partial("b", 0, "and more"),
    });

    expect(next.text).toBe("typed half a thoughtand more");
  });

  it("takes text back out of the field only on a restart, never on a cancel (rule 7)", () => {
    const dictated = applySegment({ ...started, segment: partial("a", 0, "hello") });
    expect(dictated.text).toBe("typed hello");

    // A restart splices the region out. Cancel and discard drop the transaction instead, and a
    // transaction that no longer holds the segment cannot remove its words.
    const restarted = beginRestart({
      text: dictated.text,
      selection: dictated.selection,
      state: dictated.state,
    });
    const afterCancel = applySegment({
      text: dictated.text,
      selection: caret(dictated.text.length),
      state: beginDictation(caret(dictated.text.length)),
      segment: final("a", 0, ""),
    });

    expect(restarted.text).toBe("typed ");
    expect(afterCancel.text).toBe("typed hello");
  });

  it("replaces a segment's words in place when its final corrects them", () => {
    const pending = applySegment({ ...started, segment: partial("a", 0, "hello wor") });
    const finished = applySegment({ ...pending, segment: final("a", 0, "hello world") });

    expect(finished.text).toBe("typed hello world");
    expect(finished.selection).toEqual(caret(17));
  });

  it("splices out the whole region, frozen segments included, on a restart (rule 8)", () => {
    const dictated = applySegment({
      text: "before after",
      selection: caret(6),
      state: beginDictation(caret(6)),
      segment: partial("a", 0, "hello"),
    });
    const edited = applyUserEdit({
      previousText: "beforehello after",
      nextText: "beforeHello after",
      state: dictated.state,
    });
    const second = applySegment({
      text: "beforeHello after",
      selection: caret(11),
      state: edited,
      segment: partial("b", 1, "world"),
    });
    expect(second.text).toBe("beforeHello world after");

    const restarted = beginRestart(second);

    expect(restarted.text).toBe("before after");
    expect(restarted.selection).toEqual(caret(6));
    expect(restarted.state).toEqual({ anchor: 6, segments: [] });
  });
});
