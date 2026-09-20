import type { DictationSegment } from "@getrambla/protocol/dictation-segment.rambla";
import type { DictationStreamOutboundMessage } from "./dictation-stream-manager.js";

/**
 * Sends the one segment that just reported to a client that asked for segments, and today's
 * glued transcript to everyone else. A capable client glues the text itself, so the glued
 * copy would only resend words it already placed.
 */
export function emitDictationPartial(params: {
  emit: (message: DictationStreamOutboundMessage) => void;
  dictationId: string;
  gluedText: string;
  segment: DictationSegment | null;
  clientSupportsSegments: boolean;
}): void {
  if (params.clientSupportsSegments && params.segment) {
    params.emit({
      type: "dictation_stream_partial",
      payload: { dictationId: params.dictationId, text: "", segment: params.segment },
    });
    return;
  }
  params.emit({
    type: "dictation_stream_partial",
    payload: { dictationId: params.dictationId, text: params.gluedText },
  });
}
