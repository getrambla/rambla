/** Caret or selected range in the composer field. */
export interface DictationSelection {
  start: number;
  end: number;
}

/**
 * One segment as the daemon reports it. Structural copy of the protocol's `DictationSegment`
 * so this module builds without the protocol package.
 */
export interface IncomingDictationSegment {
  id: string;
  index: number;
  text: string;
  isFinal: boolean;
}

export interface DictationTransactionSegment {
  id: string;
  index: number;
  /** What the field shows for this segment: the frozen prefix plus whatever the engine added after it. */
  text: string;
  /** The engine's most recent text for this id, unmerged. */
  engineText: string;
  /** Separator in front of this segment. It is one space until the user edits it. */
  gap: string;
  frozenPrefix: string | null;
  engineTextAtFreeze: string | null;
  isFinal: boolean;
}

export interface DictationTransactionState {
  anchor: number;
  segments: DictationTransactionSegment[];
}

interface FieldState {
  text: string;
  selection: DictationSelection;
  state: DictationTransactionState;
}

/** Starts a dictation transaction anchored where the caret is. */
export function beginDictation(selection: DictationSelection): DictationTransactionState {
  return { anchor: selection.end, segments: [] };
}

/** Merges one reported segment into the field text and returns the new text, caret and state. */
export function applySegment({
  text,
  selection,
  state,
  segment,
}: FieldState & { segment: IncomingDictationSegment }): FieldState {
  const existing = state.segments.find((entry) => entry.id === segment.id);
  if (existing?.isFinal) return { text, selection, state };

  const merged: DictationTransactionSegment = existing
    ? {
        ...existing,
        text: mergeText(existing, segment.text),
        engineText: segment.text,
        isFinal: segment.isFinal,
      }
    : {
        id: segment.id,
        index: segment.index,
        text: segment.text,
        engineText: segment.text,
        gap: " ",
        frozenPrefix: null,
        engineTextAtFreeze: null,
        isFinal: segment.isFinal,
      };

  const segments = existing
    ? state.segments.map((entry) => (entry.id === segment.id ? merged : entry))
    : [...state.segments, merged].sort((left, right) => left.index - right.index);

  return spliceRegion({ text, selection, state, segments });
}

/** Takes the whole region back out of the field so a retry or a reconnect can rebuild it. */
export function beginRestart({ text, selection, state }: FieldState): FieldState {
  return spliceRegion({ text, selection, state, segments: [] });
}

/**
 * Records the user's edit: freezes every segment the edit touched and shifts the anchor when the
 * edit landed before the region.
 */
export function applyUserEdit({
  previousText,
  nextText,
  state,
}: {
  previousText: string;
  nextText: string;
  state: DictationTransactionState;
}): DictationTransactionState {
  if (previousText === nextText) return state;

  const spanStart = commonPrefixLength(previousText, nextText);
  const suffixLength = commonSuffixLength(previousText, nextText, spanStart);
  const spanEnd = previousText.length - suffixLength;
  const inserted = nextText.slice(spanStart, nextText.length - suffixLength);
  // A span that starts outside the region and ends inside it moves the region to where it now begins,
  // and what the user typed there belongs in front of the region rather than to a segment.
  const straddlesStart = spanStart < state.anchor && spanEnd > state.anchor;
  let anchor = state.anchor;
  if (straddlesStart) anchor = spanStart + inserted.length;
  else if (spanEnd <= state.anchor) anchor += nextText.length - previousText.length;

  let insertedTaken = straddlesStart;

  const rewrite = (value: string, start: number, isInner: boolean): PieceEdit | null => {
    const overlaps = spanStart < start + value.length && spanEnd > start;
    // An insertion between two pieces belongs to the one starting there, so no piece drops it.
    const insertedAtStart = spanStart === spanEnd && spanStart === start && isInner;
    if (!overlaps && !insertedAtStart) return null;

    const localStart = clamp(spanStart - start, 0, value.length);
    const localEnd = clamp(spanEnd - start, 0, value.length);
    // What the user typed sits where it was typed, which is the first piece the span touched.
    const localInserted = insertedTaken ? "" : inserted;
    insertedTaken = true;
    return {
      localStart,
      localEnd,
      localInserted,
      value: value.slice(0, localStart) + localInserted + value.slice(localEnd),
    };
  };

  let cursor = state.anchor;
  let isFirstInRegion = true;

  let strandedId: string | null = null;

  const segments = state.segments.map((segment) => {
    if (segment.text.length === 0) return segment;

    const wasFirstInRegion = isFirstInRegion;
    let edited = segment;
    if (!isFirstInRegion) {
      const gapEdit = rewrite(segment.gap, cursor, true);
      cursor += segment.gap.length;
      if (gapEdit) edited = { ...edited, gap: gapEdit.value };
    }

    const textEdit = rewrite(segment.text, cursor, !isFirstInRegion);
    cursor += segment.text.length;
    isFirstInRegion = false;
    if (!textEdit) return edited;

    const frozen = freezeSegment(edited, textEdit);
    if (frozen.text.length > 0) return frozen;
    // The separator of a segment the user emptied is still in the field, so the segment keeps it.
    if (!wasFirstInRegion && frozen.gap.length > 0) return { ...frozen, text: frozen.gap, gap: "" };
    // The leading segment has no separator of its own; the one still in the field belongs to the next.
    if (wasFirstInRegion) strandedId = frozen.id;
    return frozen;
  });

  return { anchor, segments: takeStrandedGap(segments, strandedId) };
}

/** Hands the separator left behind in the field to the emptied segment that now sits in front of it. */
function takeStrandedGap(
  segments: DictationTransactionSegment[],
  emptiedId: string | null,
): DictationTransactionSegment[] {
  if (emptiedId === null) return segments;

  let passed = false;
  let donor: DictationTransactionSegment | undefined;
  for (const segment of segments) {
    if (segment.id === emptiedId) passed = true;
    else if (passed && segment.text.length > 0) {
      donor = segment;
      break;
    }
  }
  if (donor === undefined || donor.gap.length === 0) return segments;

  const { id: donorId, gap } = donor;
  return segments.map((segment) => {
    if (segment.id === emptiedId) return { ...segment, text: gap };
    if (segment.id === donorId) return { ...segment, gap: "" };
    return segment;
  });
}

interface PieceEdit {
  value: string;
  localStart: number;
  localEnd: number;
  localInserted: string;
}

/** Holds the text the user typed into a segment against every later message for that id. */
function freezeSegment(
  segment: DictationTransactionSegment,
  edit: PieceEdit,
): DictationTransactionSegment {
  const text = edit.value;
  const frozenLength = segment.frozenPrefix?.length ?? 0;
  if (segment.frozenPrefix !== null && edit.localEnd <= frozenLength) {
    // The engine boundary did not move, so only the frozen text shifts by what the user typed.
    const shifted = frozenLength + edit.localInserted.length - (edit.localEnd - edit.localStart);
    return { ...segment, text, frozenPrefix: text.slice(0, shifted) };
  }

  const consumed =
    segment.engineTextAtFreeze === null
      ? 0
      : commonPrefixLength(segment.engineText, segment.engineTextAtFreeze);
  return {
    ...segment,
    text,
    frozenPrefix: text.slice(0, edit.localStart + edit.localInserted.length),
    engineTextAtFreeze: segment.engineText.slice(0, consumed + edit.localEnd - frozenLength),
  };
}

/** A frozen segment keeps its frozen prefix and takes the incoming text beyond the engine's own prefix. */
function mergeText(segment: DictationTransactionSegment, incoming: string): string {
  if (segment.frozenPrefix === null || segment.engineTextAtFreeze === null) return incoming;
  return (
    segment.frozenPrefix + incoming.slice(commonPrefixLength(incoming, segment.engineTextAtFreeze))
  );
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length);
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const limit = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (length < limit && left[left.length - 1 - length] === right[right.length - 1 - length]) {
    length += 1;
  }
  return length;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Segment texts with the separator that precedes each one. Empty segments drop out with their
 * separator, matching the daemon's filter-then-join.
 */
function regionText(segments: DictationTransactionSegment[]): string {
  let region = "";
  for (const segment of segments) {
    if (segment.text.length === 0) continue;
    // Nothing separates the region from the text in front of it.
    region += region.length === 0 ? segment.text : segment.gap + segment.text;
  }
  return region;
}

function spliceRegion({
  text,
  selection,
  state,
  segments,
}: FieldState & { segments: DictationTransactionSegment[] }): FieldState {
  const previousRegion = regionText(state.segments);
  const nextRegion = regionText(segments);
  const regionEnd = state.anchor + previousRegion.length;
  const delta = nextRegion.length - previousRegion.length;

  return {
    text: text.slice(0, state.anchor) + nextRegion + text.slice(regionEnd),
    selection: {
      start: shiftCaret(selection.start, regionEnd, delta),
      end: shiftCaret(selection.end, regionEnd, delta),
    },
    state: { anchor: state.anchor, segments },
  };
}

function shiftCaret(caret: number, regionEnd: number, delta: number): number {
  return caret >= regionEnd ? caret + delta : caret;
}
