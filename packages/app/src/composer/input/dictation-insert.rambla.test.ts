import { describe, expect, it } from "vitest";
import { insertDictationAtSelection } from "./dictation-insert.rambla";

describe("insertDictationAtSelection", () => {
  it("pads both sides when the caret sits mid-text between words", () => {
    expect(
      insertDictationAtSelection("DICT", "hello world", { selection: { start: 5, end: 5 } }),
    ).toEqual({ value: "hello DICT world", caret: 10 });
  });

  it("pads both sides when the caret sits mid-word", () => {
    expect(
      insertDictationAtSelection("DICT", "hello", { selection: { start: 2, end: 2 } }),
    ).toEqual({ value: "he DICT llo", caret: 7 });
  });

  it("adds no padding when the caret sits on existing whitespace", () => {
    expect(
      insertDictationAtSelection("DICT", "hello  world", { selection: { start: 6, end: 6 } }),
    ).toEqual({ value: "hello DICT world", caret: 10 });
  });

  it("pads only after the words at a trailing caret", () => {
    expect(
      insertDictationAtSelection("DICT", "hello", { selection: { start: 5, end: 5 } }),
    ).toEqual({ value: "hello DICT", caret: 10 });
  });

  it("pads only before the words at a leading caret", () => {
    expect(
      insertDictationAtSelection("DICT", "hello", { selection: { start: 0, end: 0 } }),
    ).toEqual({ value: "DICT hello", caret: 4 });
  });

  it("degenerates to a plain append on an empty field", () => {
    expect(insertDictationAtSelection("DICT", "", { selection: { start: 0, end: 0 } })).toEqual({
      value: "DICT",
      caret: 4,
    });
  });

  it("replaces a selected range instead of splicing into it", () => {
    expect(
      insertDictationAtSelection("DICT", "hello old world", {
        selection: { start: 6, end: 9 },
      }),
    ).toEqual({ value: "hello DICT world", caret: 10 });
  });

  it("replaces a range that starts on the field's leading edge with no leading pad", () => {
    expect(
      insertDictationAtSelection("DICT", "old world", { selection: { start: 0, end: 4 } }),
    ).toEqual({ value: "DICT world", caret: 4 });
  });

  it("clamps a selection that runs past the end of the value", () => {
    expect(
      insertDictationAtSelection("DICT", "hello", { selection: { start: 3, end: 99 } }),
    ).toEqual({ value: "hel DICT", caret: 8 });
  });
});
