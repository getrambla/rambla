import { useMemo, useRef } from "react";
import type { DictationSegment } from "@getrambla/protocol/dictation-segment.rambla";
import {
  applySegment,
  applyUserEdit,
  beginDictation as beginTransaction,
  beginRestart as restartTransaction,
  type DictationSelection,
  type DictationTransactionState,
} from "./dictation-transaction.rambla";

export interface DictationFieldSnapshot {
  text: string;
  selection: DictationSelection;
}

export interface UseDictationFieldOptions {
  /** Reads the field the user sees, so a write and the next read cannot disagree. */
  getSnapshot: () => DictationFieldSnapshot;
  writeText: (text: string, selection: DictationSelection) => void;
}

export interface UseDictationFieldResult {
  /** Anchors a new recording at the caret. */
  beginDictation: () => void;
  /** Drops the region a retry or a reconnect is about to re-transcribe. */
  beginRestart: () => void;
  onPartialTranscript: (
    text: string,
    meta: { requestId: string; segment?: DictationSegment },
  ) => void;
  onUserEdit: (previousText: string, nextText: string) => void;
  /** The text and base the final's append path should use, once the words are in the field. */
  resolveFinal: (text: string, value: string) => { text: string; value: string };
}

/** Owns the dictation transaction and every write the composer field takes from it. */
export function useDictationField(options: UseDictationFieldOptions): UseDictationFieldResult {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const stateRef = useRef<DictationTransactionState | null>(null);
  const sawSegmentRef = useRef(false);
  const lastWriteRef = useRef<{
    before: string;
    after: string;
    selection: DictationSelection;
  } | null>(null);

  return useMemo(() => {
    const write = (before: string, after: string, selection: DictationSelection) => {
      if (after === before) return;
      lastWriteRef.current = { before, after, selection };
      optionsRef.current.writeText(after, selection);
    };

    const beginDictation = () => {
      stateRef.current = beginTransaction(optionsRef.current.getSnapshot().selection);
      sawSegmentRef.current = false;
      lastWriteRef.current = null;
    };

    return {
      beginDictation,
      beginRestart: () => {
        const state = stateRef.current;
        if (!state) return;
        const snapshot = optionsRef.current.getSnapshot();
        const next = restartTransaction({ ...snapshot, state });
        stateRef.current = next.state;
        // The region left the field, so a final with nothing after it appends as it always did.
        sawSegmentRef.current = false;
        lastWriteRef.current = null;
        write(snapshot.text, next.text, next.selection);
      },
      onPartialTranscript: (_text, meta) => {
        if (!meta.segment) return;
        if (!stateRef.current) beginDictation();
        const snapshot = optionsRef.current.getSnapshot();
        const next = applySegment({
          ...snapshot,
          state: stateRef.current!,
          segment: meta.segment,
        });
        stateRef.current = next.state;
        sawSegmentRef.current = true;
        write(snapshot.text, next.text, next.selection);
      },
      onUserEdit: (previousText, nextText) => {
        const state = stateRef.current;
        if (!state) return;
        stateRef.current = applyUserEdit({ previousText, nextText, state });
      },
      resolveFinal: (text, value) => {
        if (!sawSegmentRef.current) return { text, value };
        // The last partial's write has no successor to repair it, so re-issue it if the
        // field still shows what it held before.
        const dropped = lastWriteRef.current;
        if (dropped && optionsRef.current.getSnapshot().text === dropped.before) {
          optionsRef.current.writeText(dropped.after, dropped.selection);
        }
        return { text: optionsRef.current.getSnapshot().text, value: "" };
      },
    };
  }, []);
}
