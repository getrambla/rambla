export interface DictationInsertPlacement {
  /** Where the dictated words go: a caret collapses to start === end. */
  selection: { start: number; end: number };
}

export interface DictationInsertResult {
  value: string;
  /** The offset just past the inserted words, where the caret belongs. */
  caret: number;
}

/**
 * Splices dictated final text in at the caret (or over a selected range),
 * padding with spaces on whichever side touches non-whitespace text. An empty
 * field degenerates to a plain append. Only the old no-segment dictation path
 * calls this; the segment path places its own text.
 */
export function insertDictationAtSelection(
  text: string,
  value: string,
  placement: DictationInsertPlacement,
): DictationInsertResult {
  const start = Math.max(0, Math.min(placement.selection.start, value.length));
  const end = Math.max(start, Math.min(placement.selection.end, value.length));
  const padBefore = start > 0 && !/\s/.test(value[start - 1]) ? " " : "";
  const padAfter = end < value.length && !/\s/.test(value[end]) ? " " : "";
  const nextValue = `${value.slice(0, start)}${padBefore}${text}${padAfter}${value.slice(end)}`;
  return { value: nextValue, caret: start + padBefore.length + text.length };
}
