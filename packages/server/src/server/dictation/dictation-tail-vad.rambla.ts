import type pino from "pino";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";

import type { TranscriptEvent } from "./dictation-segment-partial.rambla.js";

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: checks the submit tail with Silero and drops it when it holds no speech.
export interface DictationTailState {
  stt: StreamingTranscriptionSession;
  bytesSinceCommit: number;
  inFlightCommitCount: number;
  debugAudioChunks: Buffer[];
  committedSegmentIds: string[];
  transcriptsBySegmentId: Map<string, string>;
  finalTranscriptSegmentIds: Set<string>;
}

interface TailCheckParams {
  dictationId: string;
  state: DictationTailState;
  logger: pino.Logger;
  isActive: () => boolean;
  reseal: () => void;
  finalize: () => void;
  emitPartial: (text: string, event: TranscriptEvent) => void;
}

type ClipCheck = (pcm16le: Buffer) => Promise<boolean>;

const tailChecks = new WeakMap<DictationTailState, "running" | "kept">();

function clipCheckOf(stt: StreamingTranscriptionSession): ClipCheck | null {
  const candidate = (stt as Partial<Record<"clipHasSpeech", unknown>>).clipHasSpeech;
  return typeof candidate === "function" ? (candidate.bind(stt) as ClipCheck) : null;
}

function tailAudio(state: DictationTailState): Buffer {
  const chunks: Buffer[] = [];
  let remaining = state.bytesSinceCommit;
  for (let i = state.debugAudioChunks.length - 1; i >= 0 && remaining > 0; i -= 1) {
    const chunk = state.debugAudioChunks[i]!;
    chunks.push(remaining < chunk.length ? chunk.subarray(chunk.length - remaining) : chunk);
    remaining -= chunk.length;
  }
  return Buffer.concat(chunks.toReversed());
}

function committedText(state: DictationTailState): string {
  return state.committedSegmentIds
    .map((id) => state.transcriptsBySegmentId.get(id) ?? "")
    .filter((text) => text.length > 0)
    .join(" ")
    .trim();
}

function dropTail(params: TailCheckParams): void {
  const { state } = params;
  state.stt.clear();
  state.bytesSinceCommit = 0;
  for (const segmentId of state.transcriptsBySegmentId.keys()) {
    if (
      state.committedSegmentIds.includes(segmentId) ||
      state.finalTranscriptSegmentIds.has(segmentId)
    ) {
      continue;
    }
    state.transcriptsBySegmentId.delete(segmentId);
    params.emitPartial(committedText(state), {
      segmentId,
      transcript: "",
      isFinal: true,
      index: state.committedSegmentIds.length + state.inFlightCommitCount,
    });
  }
}

async function checkTail(params: TailCheckParams, clipHasSpeech: ClipCheck): Promise<void> {
  const { dictationId, state, logger } = params;
  let hasSpeech = true;
  try {
    hasSpeech = await clipHasSpeech(tailAudio(state));
  } catch (error) {
    logger.warn({ dictationId, err: error }, "Dictation tail clip check failed; committing it");
  }
  state.inFlightCommitCount -= 1;
  tailChecks.set(state, "kept");
  if (!hasSpeech && params.isActive()) {
    try {
      dropTail(params);
      tailChecks.delete(state);
      logger.info({ dictationId }, "Dictation tail has no speech; dropped it");
    } catch (error) {
      logger.warn({ dictationId, err: error }, "Dictation tail clear failed; committing it");
    }
  }
  params.reseal();
  params.finalize();
}

export function holdDictationTailForCheck(params: TailCheckParams): boolean {
  const { state } = params;
  const running = tailChecks.get(state);
  if (running) {
    return running === "running";
  }
  const clipHasSpeech = clipCheckOf(state.stt);
  if (!clipHasSpeech || state.bytesSinceCommit === 0) {
    return false;
  }
  tailChecks.set(state, "running");
  state.inFlightCommitCount += 1;
  void checkTail(params, clipHasSpeech);
  return true;
}
