import type { DictationSegment } from "@getrambla/protocol/dictation-segment.rambla";

/** What a transcript event reports; `index` is absent when the provider does not number segments. */
export interface TranscriptEvent {
  segmentId: string;
  transcript: string;
  isFinal: boolean;
  index?: number;
}

/** Named here so the manager's union member stays the one line upstream wrote. */
export interface DictationStreamPartialMessage {
  type: "dictation_stream_partial";
  payload: { dictationId: string; text: string; segment?: DictationSegment };
}

/**
 * The one segment that just reported, for a client that asked for segments; today's glued
 * transcript for everyone else. A capable client glues the text itself, so the glued copy
 * would only resend words it already placed.
 */
export function toPartialMessage(params: {
  dictationId: string;
  text: string;
  event: TranscriptEvent | undefined;
  segments: boolean;
}): DictationStreamPartialMessage {
  const { dictationId, text, event, segments } = params;
  if (segments && event?.index !== undefined) {
    const segment = {
      id: event.segmentId,
      index: event.index,
      text: event.transcript,
      isFinal: event.isFinal,
    };
    return { type: "dictation_stream_partial", payload: { dictationId, text: "", segment } };
  }
  return { type: "dictation_stream_partial", payload: { dictationId, text } };
}
