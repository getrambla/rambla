/**
 * Pure merge of live dictation segments into the composer's text.
 *
 * The dictated region lives at `anchor` and is rebuilt from segment state on every message, so
 * every write is idempotent and a dropped write is repaired by the next one.
 */

export interface DictationSelection {
  start: number;
  end: number;
}

/** One segment as the daemon reports it; structurally the protocol's segment payload. */
export interface DictationSegmentReport {
  id: string;
  index: number;
  text: string;
  isFinal: boolean;
}

export interface DictationSegmentState {
  id: string;
  index: number;
  /** What sits in the field for this segment: the frozen prefix plus the engine's tail. */
  text: string;
  /** Text the user edited and the engine may no longer rewrite, or null while unfrozen. */
  frozenPrefix: string | null;
  /** Engine text the frozen prefix consumed, so a later message appends only past it. */
  engineTextAtFreeze: string | null;
  /** Last text the engine sent for this id, untouched by user edits. */
  engineText: string;
  isFinal: boolean;
}

export interface DictationTransactionState {
  anchor: number;
  segments: DictationSegmentState[];
}

export interface DictationTextResult {
  text: string;
  selection: DictationSelection;
  state: DictationTransactionState;
}

/** Starts a transaction anchored where the caret sits (rule 1). */
export function beginDictation(selection: DictationSelection): DictationTransactionState {
  return { anchor: selection.end, segments: [] };
}

/** Merges one reported segment into the text, leaving everything outside the region alone. */
export function applySegment({
  text,
  selection,
  state,
  segment,
}: {
  text: string;
  selection: DictationSelection;
  state: DictationTransactionState;
  segment: DictationSegmentReport;
}): DictationTextResult {
  const existing = state.segments.find((candidate) => candidate.id === segment.id);
  if (existing?.isFinal) {
    return { text, selection, state };
  }

  const merged = existing ? mergeIntoSegment(existing, segment) : createSegment(segment);
  const segments = existing
    ? state.segments.map((candidate) => (candidate.id === segment.id ? merged : candidate))
    : insertByIndex(state.segments, merged);

  const written = writeRegion({
    text,
    selection,
    anchor: state.anchor,
    previousRegion: renderRegion(state.segments),
    nextRegion: renderRegion(segments),
  });
  return { ...written, state: { anchor: state.anchor, segments } };
}

/** Records the user's edit: freezes every segment it touched and shifts the anchor. */
export function applyUserEdit({
  previousText,
  nextText,
  state,
}: {
  previousText: string;
  nextText: string;
  state: DictationTransactionState;
}): DictationTransactionState {
  const span = locateEditSpan(previousText, nextText);
  const inserted = nextText.slice(span.start, span.insertedEnd);
  const delta = nextText.length - previousText.length;
  const anchor = span.removedEnd <= state.anchor ? state.anchor + delta : state.anchor;
  const ranges = segmentRanges(state);

  const segments = state.segments.map((segment) => {
    const range = ranges.get(segment.id);
    if (!range || span.start >= range.end || span.removedEnd <= range.start) {
      return segment;
    }
    const localStart = Math.max(span.start, range.start) - range.start;
    const localEnd = Math.min(span.removedEnd, range.end) - range.start;
    const insertedHere = span.start >= range.start ? inserted : "";
    const frozenPrefix = segment.text.slice(0, localStart) + insertedHere;
    return {
      ...segment,
      text: frozenPrefix + segment.text.slice(localEnd),
      frozenPrefix,
      engineTextAtFreeze: segment.engineText.slice(0, consumedEngineLength(segment, localEnd)),
    };
  });

  return { anchor, segments };
}

/** Splices the whole region out and drops every segment, frozen included (rule 8). */
export function beginRestart({
  text,
  selection,
  state,
}: {
  text: string;
  selection: DictationSelection;
  state: DictationTransactionState;
}): DictationTextResult {
  const written = writeRegion({
    text,
    selection,
    anchor: state.anchor,
    previousRegion: renderRegion(state.segments),
    nextRegion: "",
  });
  return { ...written, state: { anchor: state.anchor, segments: [] } };
}

/** Joins the non-empty segment texts the way the daemon glues its transcript. */
function renderRegion(segments: DictationSegmentState[]): string {
  return segments
    .map((segment) => segment.text)
    .filter((text) => text.length > 0)
    .join(" ");
}

/** Replaces the old region with the new one and shifts carets at or after the region end. */
function writeRegion({
  text,
  selection,
  anchor,
  previousRegion,
  nextRegion,
}: {
  text: string;
  selection: DictationSelection;
  anchor: number;
  previousRegion: string;
  nextRegion: string;
}): { text: string; selection: DictationSelection } {
  const regionEnd = anchor + previousRegion.length;
  const delta = nextRegion.length - previousRegion.length;
  const shift = (caret: number) => (caret >= regionEnd ? caret + delta : caret);
  return {
    text: text.slice(0, anchor) + nextRegion + text.slice(regionEnd),
    selection: { start: shift(selection.start), end: shift(selection.end) },
  };
}

function createSegment(segment: DictationSegmentReport): DictationSegmentState {
  return {
    id: segment.id,
    index: segment.index,
    text: segment.text,
    frozenPrefix: null,
    engineTextAtFreeze: null,
    engineText: segment.text,
    isFinal: segment.isFinal,
  };
}

/** An unfrozen id takes the incoming text whole; a frozen one appends past the shared prefix. */
function mergeIntoSegment(
  existing: DictationSegmentState,
  segment: DictationSegmentReport,
): DictationSegmentState {
  const frozenPrefix = existing.frozenPrefix;
  const text =
    frozenPrefix === null
      ? segment.text
      : frozenPrefix +
        segment.text.slice(commonPrefixLength(segment.text, existing.engineTextAtFreeze ?? ""));
  return { ...existing, text, engineText: segment.text, isFinal: segment.isFinal };
}

/** Keeps the list in the daemon's order; indexes have gaps, so a position is never an index. */
function insertByIndex(
  segments: DictationSegmentState[],
  segment: DictationSegmentState,
): DictationSegmentState[] {
  const at = segments.findIndex((candidate) => candidate.index > segment.index);
  if (at < 0) {
    return [...segments, segment];
  }
  return [...segments.slice(0, at), segment, ...segments.slice(at)];
}

/** Where each non-empty segment sits in the text, separators included. */
function segmentRanges(
  state: DictationTransactionState,
): Map<string, { start: number; end: number }> {
  const ranges = new Map<string, { start: number; end: number }>();
  let offset = state.anchor;
  for (const segment of state.segments) {
    if (segment.text.length === 0) {
      continue;
    }
    if (ranges.size > 0) {
      offset += 1;
    }
    ranges.set(segment.id, { start: offset, end: offset + segment.text.length });
    offset += segment.text.length;
  }
  return ranges;
}

/** How much of the engine's text the frozen prefix consumed, in engine coordinates. */
function consumedEngineLength(segment: DictationSegmentState, localEnd: number): number {
  if (segment.frozenPrefix === null) {
    return localEnd;
  }
  const consumed = commonPrefixLength(segment.engineText, segment.engineTextAtFreeze ?? "");
  if (localEnd <= segment.frozenPrefix.length) {
    return consumed;
  }
  return consumed + (localEnd - segment.frozenPrefix.length);
}

/** The span the user changed, found by common prefix and suffix. */
function locateEditSpan(
  previousText: string,
  nextText: string,
): { start: number; removedEnd: number; insertedEnd: number } {
  const maxPrefix = Math.min(previousText.length, nextText.length);
  let start = 0;
  while (start < maxPrefix && previousText[start] === nextText[start]) {
    start += 1;
  }
  let suffix = 0;
  const maxSuffix = Math.min(previousText.length - start, nextText.length - start);
  while (
    suffix < maxSuffix &&
    previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start,
    removedEnd: previousText.length - suffix,
    insertedEnd: nextText.length - suffix,
  };
}

/** Characters two strings share from the start — never a startsWith check. */
function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let shared = 0;
  while (shared < max && a[shared] === b[shared]) {
    shared += 1;
  }
  return shared;
}
