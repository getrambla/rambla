import type pino from "pino";
import { v4 as uuidv4 } from "uuid";
import {
  createDictationDebugChunkWriter,
  maybePersistDictationDebugAudio,
  type DictationDebugChunkWriter,
} from "../agent/dictation-debug.js";
import { isRamblaDictationDebugEnabled } from "../agent/recordings-debug.js";
import { Pcm16MonoResampler } from "../agent/pcm16-resampler.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";
import { toResolver, type Resolvable } from "../speech/provider-resolver.js";
import { parsePcmRateFromFormat, pcm16lePeakAbs } from "../speech/audio.js";

const PCM_CHANNELS = 1;
const PCM_BITS_PER_SAMPLE = 16;
const DEFAULT_DICTATION_FINAL_TIMEOUT_MS = 10000;
const DEFAULT_DICTATION_AUTO_COMMIT_SECONDS = 15;
const DICTATION_FINAL_TIMEOUT_MAX_MS = 5 * 60 * 1000;
const DICTATION_FINAL_TIMEOUT_PER_PENDING_SEGMENT_MS = 15 * 1000;
const DICTATION_FINAL_TIMEOUT_PER_PENDING_AUDIO_SECOND_MS = 1500;
const DICTATION_FINAL_TIMEOUT_PER_MISSING_SEQ_MS = 250;
// A speaker trails off at the end of a sentence and a fan never stops, so how
// loud a window is means nothing on its own; what counts is how far above the
// room it rises. Nothing here decides whether audio is kept — the engine is the
// one that can tell speech from noise, and it hears everything.
const DICTATION_SPEECH_PEAK_FLOOR = 60;
const DICTATION_SPEECH_FLOOR_MARGIN = 3;
// The room is measured over the recent past, not the whole recording. Noise
// suppression zeroes a pause outright, and one such moment kept forever would
// hold the floor at zero and hide every later gap in a room that has a level.
const DICTATION_NOISE_FLOOR_HISTORY_SECONDS = 4;
// A window boundary landing inside a word is heard whole by the window before it
// and by the window after it, so the word is transcribed twice. Wait for the
// speaker to pause, then cut there.
const DICTATION_GAP_SCAN_WINDOW_SECONDS = 0.02;
// Longer than the silent closure inside a stop consonant, so a cut here falls
// between words rather than inside one.
const DICTATION_GAP_MIN_SECONDS = 0.12;
// How long a commit may wait for that pause before cutting wherever it is.
const DICTATION_AUTO_COMMIT_MAX_EXTRA_SECONDS = 5;

function parseNonNegativeNumber(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function convertPCMToWavBuffer(
  pcmBuffer: Buffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
): Buffer {
  const headerSize = 44;
  const wavBuffer = Buffer.alloc(headerSize + pcmBuffer.length);
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;

  wavBuffer.write("RIFF", 0);
  wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
  wavBuffer.write("WAVE", 8);
  wavBuffer.write("fmt ", 12);
  wavBuffer.writeUInt32LE(16, 16);
  wavBuffer.writeUInt16LE(1, 20);
  wavBuffer.writeUInt16LE(channels, 22);
  wavBuffer.writeUInt32LE(sampleRate, 24);
  wavBuffer.writeUInt32LE(byteRate, 28);
  wavBuffer.writeUInt16LE(blockAlign, 32);
  wavBuffer.writeUInt16LE(bitsPerSample, 34);
  wavBuffer.write("data", 36);
  wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
  pcmBuffer.copy(wavBuffer, 44);

  return wavBuffer;
}

interface DictationStreamState {
  dictationId: string;
  sessionId: string;
  inputFormat: string;
  stt: StreamingTranscriptionSession;
  inputRate: number;
  outputRate: number;
  resampler: Pcm16MonoResampler | null;
  debugAudioChunks: Buffer[];
  debugRecordingPath: string | null;
  debugChunkWriter: DictationDebugChunkWriter | null;
  receivedChunks: Map<number, Buffer>;
  nextSeqToForward: number;
  ackSeq: number;
  autoCommitBytes: number;
  bytesSinceCommit: number;
  peakOverall: number;
  noiseFloorSamples: Array<{ quietest: number; seconds: number }>;
  committedSegmentIds: string[];
  transcriptsBySegmentId: Map<string, string>;
  finalTranscriptSegmentIds: Set<string>;
  inFlightCommitCount: number;
  awaitingFinalCommit: boolean;
  finishRequested: boolean;
  finishSealed: boolean;
  finalSeq: number | null;
  finalTimeout: ReturnType<typeof setTimeout> | null;
}

/** Seconds of PCM16 mono audio represented by a byte count at the given sample rate. */
function pcm16SecondsFromBytes(bytes: number, sampleRate: number): number {
  return bytes / Math.max(1, sampleRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8));
}

/** Quietest scan window in a buffer: what this stream sounds like with nobody speaking. */
function windowPeakMin(pcm16: Buffer, sampleRate: number): number {
  const scanBytes = Math.max(2, Math.round(sampleRate * DICTATION_GAP_SCAN_WINDOW_SECONDS) * 2);
  if (pcm16.length < scanBytes) {
    return pcm16lePeakAbs(pcm16);
  }
  let quietest = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset + scanBytes <= pcm16.length; offset += scanBytes) {
    quietest = Math.min(quietest, pcm16lePeakAbs(pcm16.subarray(offset, offset + scanBytes)));
  }
  return quietest;
}

/** Records a chunk's quietest window and forgets the ones that are no longer recent. */
function trackNoiseFloor(state: DictationStreamState, chunk: Buffer): void {
  state.noiseFloorSamples.push({
    quietest: windowPeakMin(chunk, state.outputRate),
    seconds: pcm16SecondsFromBytes(chunk.length, state.outputRate),
  });
  let retained = 0;
  for (let index = state.noiseFloorSamples.length - 1; index >= 0; index -= 1) {
    retained += state.noiseFloorSamples[index].seconds;
    if (retained >= DICTATION_NOISE_FLOOR_HISTORY_SECONDS) {
      state.noiseFloorSamples.splice(0, index);
      return;
    }
  }
}

/** The level the room is at now: the quietest window in the recent past. */
function noiseFloorOf(state: DictationStreamState): number {
  let quietest = Number.POSITIVE_INFINITY;
  for (const sample of state.noiseFloorSamples) {
    quietest = Math.min(quietest, sample.quietest);
  }
  return quietest;
}

/** Peak a window must reach to count as speech rather than as the room around the speaker. */
function speechPeakThreshold(noiseFloor: number): number {
  if (!Number.isFinite(noiseFloor)) {
    return DICTATION_SPEECH_PEAK_FLOOR;
  }
  return Math.max(DICTATION_SPEECH_PEAK_FLOOR, noiseFloor * DICTATION_SPEECH_FLOOR_MARGIN);
}

/** Byte offset inside the first pause at or after `fromByte`, or null when the audio never goes quiet. */
function findPauseOffset(
  pcm16: Buffer,
  fromByte: number,
  sampleRate: number,
  speechPeak: number,
): number | null {
  const scanBytes = Math.max(2, Math.round(sampleRate * DICTATION_GAP_SCAN_WINDOW_SECONDS) * 2);
  const minPauseBytes = Math.max(scanBytes, Math.round(sampleRate * DICTATION_GAP_MIN_SECONDS) * 2);
  const start = Math.max(0, fromByte - (fromByte % 2));
  let pauseStart: number | null = null;
  for (let offset = start; offset + scanBytes <= pcm16.length; offset += scanBytes) {
    const peak = pcm16lePeakAbs(pcm16.subarray(offset, offset + scanBytes));
    if (peak >= speechPeak) {
      pauseStart = null;
      continue;
    }
    pauseStart ??= offset;
    const pauseEnd = offset + scanBytes;
    if (pauseEnd - pauseStart >= minPauseBytes) {
      const middle = pauseStart + Math.floor((pauseEnd - pauseStart) / 2);
      return middle - (middle % 2);
    }
  }
  return null;
}

/** Seconds of audio forwarded to the provider for this stream so far. */
function receivedSeconds(state: DictationStreamState): number {
  const bytes = state.debugAudioChunks.reduce((total, chunk) => total + chunk.length, 0);
  return pcm16SecondsFromBytes(bytes, state.outputRate);
}

export type DictationStreamOutboundMessage =
  | { type: "dictation_stream_ack"; payload: { dictationId: string; ackSeq: number } }
  | {
      type: "dictation_stream_finish_accepted";
      payload: { dictationId: string; timeoutMs: number };
    }
  | { type: "dictation_stream_partial"; payload: { dictationId: string; text: string } }
  | {
      type: "dictation_stream_final";
      payload: { dictationId: string; text: string; debugRecordingPath?: string };
    }
  | {
      type: "dictation_stream_error";
      payload: {
        dictationId: string;
        error: string;
        retryable: boolean;
        debugRecordingPath?: string;
      };
    }
  | {
      type: "activity_log";
      payload: {
        id: string;
        timestamp: Date;
        type: "system";
        content: string;
        metadata: Record<string, unknown>;
      };
    };

export class DictationStreamManager {
  private readonly logger: pino.Logger;
  private readonly emit: (msg: DictationStreamOutboundMessage) => void;
  private readonly sessionId: string;
  private readonly resolveStt: () => SpeechToTextProvider | null;
  private readonly language: string;
  private readonly finalTimeoutMs: number;
  private readonly autoCommitSeconds: number;
  private readonly onIdle: (() => void) | undefined;
  private readonly streams = new Map<string, DictationStreamState>();

  constructor(params: {
    logger: pino.Logger;
    emit: (msg: DictationStreamOutboundMessage) => void;
    sessionId: string;
    stt: Resolvable<SpeechToTextProvider | null>;
    language?: string;
    finalTimeoutMs?: number;
    autoCommitSeconds?: number;
    onIdle?: () => void;
  }) {
    this.onIdle = params.onIdle;
    this.logger = params.logger.child({ component: "dictation-stream-manager" });
    this.emit = params.emit;
    this.sessionId = params.sessionId;
    this.resolveStt = toResolver(params.stt);
    this.language = params.language ?? "en";
    this.finalTimeoutMs = params.finalTimeoutMs ?? DEFAULT_DICTATION_FINAL_TIMEOUT_MS;
    this.autoCommitSeconds =
      params.autoCommitSeconds ??
      parseNonNegativeNumber(process.env.RAMBLA_DICTATION_AUTO_COMMIT_SECONDS) ??
      DEFAULT_DICTATION_AUTO_COMMIT_SECONDS;
  }

  get hasDemand(): boolean {
    return this.streams.size > 0;
  }

  public cleanupAll(): void {
    const failures: unknown[] = [];
    for (const dictationId of this.streams.keys()) {
      try {
        this.cleanupDictationStream(dictationId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "Dictation cleanup failed");
  }

  public async handleStart(dictationId: string, format: string): Promise<void> {
    this.cleanupDictationStream(dictationId);

    const sttProvider = this.resolveStt();
    if (!sttProvider) {
      this.failDictationStream(dictationId, "Dictation STT not configured", false);
      return;
    }

    const transcriptionPrompt =
      process.env.RAMBLA_DICTATION_TRANSCRIPTION_PROMPT ??
      "Transcribe only what the speaker says. Do not add words. Preserve punctuation and casing. If the audio is silence or non-speech noise, return an empty transcript.";

    let stt: ReturnType<SpeechToTextProvider["createSession"]>;
    try {
      stt = sttProvider.createSession({
        logger: this.logger.child({ dictationId }),
        language: this.language,
        prompt: transcriptionPrompt,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.failDictationStream(dictationId, message, false);
      return;
    }

    const inputRate = parsePcmRateFromFormat(format, 16000) ?? 16000;
    if (!Number.isFinite(inputRate) || inputRate <= 0) {
      this.failDictationStream(
        dictationId,
        `Invalid dictation input rate in format: ${format}`,
        false,
      );
      try {
        stt.close();
      } catch {
        // no-op
      }
      return;
    }

    const debugChunkWriter = createDictationDebugChunkWriter(
      { sessionId: this.sessionId, dictationId },
      this.logger,
    );

    const outputRate = stt.requiredSampleRate;
    const autoCommitBytes =
      this.autoCommitSeconds > 0
        ? Math.max(1, Math.round(this.autoCommitSeconds * outputRate * 2))
        : 0;

    this.streams.set(dictationId, {
      dictationId,
      sessionId: this.sessionId,
      inputFormat: format,
      stt,
      inputRate,
      outputRate,
      resampler:
        inputRate === outputRate
          ? null
          : new Pcm16MonoResampler({
              inputRate,
              outputRate,
            }),
      debugAudioChunks: [],
      debugRecordingPath: null,
      debugChunkWriter,
      receivedChunks: new Map(),
      nextSeqToForward: 0,
      ackSeq: -1,
      autoCommitBytes,
      bytesSinceCommit: 0,
      peakOverall: 0,
      noiseFloorSamples: [],
      committedSegmentIds: [],
      transcriptsBySegmentId: new Map(),
      finalTranscriptSegmentIds: new Set(),
      inFlightCommitCount: 0,
      awaitingFinalCommit: false,
      finishRequested: false,
      finishSealed: false,
      finalSeq: null,
      finalTimeout: null,
    });

    stt.on("committed", ({ segmentId }) => {
      const state = this.streams.get(dictationId);
      if (state?.stt !== stt) {
        return;
      }
      if (state.inFlightCommitCount > 0) {
        state.inFlightCommitCount -= 1;
      }
      state.committedSegmentIds.push(segmentId);

      if (state.finishRequested && state.awaitingFinalCommit) {
        state.awaitingFinalCommit = false;
      }

      this.maybeFinalizeDictationStream(dictationId);
    });

    stt.on("transcript", ({ segmentId, transcript, isFinal }) => {
      const state = this.streams.get(dictationId);
      if (state?.stt !== stt) {
        return;
      }
      state.transcriptsBySegmentId.set(segmentId, transcript);
      if (isFinal) {
        state.finalTranscriptSegmentIds.add(segmentId);
      }

      if (state.finishRequested && state.awaitingFinalCommit && isFinal) {
        state.awaitingFinalCommit = false;
      }

      const orderedIds = state.committedSegmentIds.includes(segmentId)
        ? state.committedSegmentIds
        : [...state.committedSegmentIds, segmentId];
      const partialText = orderedIds
        .map((id) => state.transcriptsBySegmentId.get(id) ?? "")
        .filter((text) => text.length > 0)
        .join(" ")
        .trim();
      this.emitDictationPartial(dictationId, partialText);

      this.maybeSealDictationStreamFinish(dictationId);
      this.maybeFinalizeDictationStream(dictationId);
    });

    stt.on("error", (err) => {
      const message = err instanceof Error ? err.message : String(err);
      const state = this.streams.get(dictationId);
      if (state?.stt !== stt) return;
      if (state.finishRequested && isBufferTooSmallError(message)) {
        if (state.inFlightCommitCount > 0) {
          state.inFlightCommitCount -= 1;
        }
        if (state.awaitingFinalCommit) {
          state.awaitingFinalCommit = false;
        }
        this.maybeFinalizeDictationStream(dictationId);
        return;
      }
      void this.failAndCleanupDictationStream(dictationId, message, true);
    });

    try {
      await stt.connect();
    } catch (error) {
      if (this.streams.get(dictationId)?.stt !== stt) return;
      const message = error instanceof Error ? error.message : String(error);
      this.failDictationStream(dictationId, message, true);
      this.cleanupDictationStream(dictationId);
      return;
    }
    if (this.streams.get(dictationId)?.stt !== stt) return;

    this.emitDictationAck(dictationId, -1);
  }

  public async handleChunk(params: {
    dictationId: string;
    seq: number;
    audioBase64: string;
    format: string;
  }): Promise<void> {
    const state = this.streams.get(params.dictationId);
    if (!state) {
      this.failDictationStream(params.dictationId, "Dictation stream not started", true);
      return;
    }

    if (params.format !== state.inputFormat) {
      void this.failAndCleanupDictationStream(
        params.dictationId,
        `Mismatched dictation stream format: ${params.format}`,
        false,
      );
      return;
    }

    if (params.seq < state.nextSeqToForward) {
      this.emitDictationAck(params.dictationId, state.ackSeq);
      return;
    }

    if (!state.receivedChunks.has(params.seq)) {
      state.receivedChunks.set(params.seq, Buffer.from(params.audioBase64, "base64"));
    }

    while (state.receivedChunks.has(state.nextSeqToForward)) {
      const seq = state.nextSeqToForward;
      const pcm16 = state.receivedChunks.get(seq)!;
      state.receivedChunks.delete(seq);

      const resampled = state.resampler ? state.resampler.processChunk(pcm16) : pcm16;
      if (resampled.length > 0) {
        trackNoiseFloor(state, resampled);
        const parts = this.splitChunkAtAutoCommitPause(state, resampled);
        for (let part = 0; part < parts.length; part += 1) {
          state.stt.appendPcm16(parts[part]);
          state.debugAudioChunks.push(parts[part]);
          state.bytesSinceCommit += parts[part].length;
          state.peakOverall = Math.max(state.peakOverall, pcm16lePeakAbs(parts[part]));
          try {
            this.maybeAutoCommitDictationSegment(state, part === 0 && parts.length > 1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            void this.failAndCleanupDictationStream(params.dictationId, message, true);
            return;
          }
        }

        if (state.debugChunkWriter) {
          void state.debugChunkWriter.writeChunk(seq, resampled).catch((err) => {
            this.logger.warn(
              { dictationId: params.dictationId, seq, err },
              "Failed to write debug chunk",
            );
          });
        }
      }

      state.nextSeqToForward += 1;
      state.ackSeq = state.nextSeqToForward - 1;
    }

    this.emitDictationAck(params.dictationId, state.ackSeq);
    this.maybeSealDictationStreamFinish(params.dictationId);
    this.maybeFinalizeDictationStream(params.dictationId);
  }

  public async handleFinish(dictationId: string, finalSeq: number): Promise<void> {
    const state = this.streams.get(dictationId);
    if (!state) {
      this.failDictationStream(dictationId, "Dictation stream not started", true);
      return;
    }

    state.finishRequested = true;
    state.finalSeq = finalSeq;

    if (
      finalSeq >= 0 &&
      state.ackSeq < 0 &&
      state.nextSeqToForward === 0 &&
      state.receivedChunks.size === 0
    ) {
      this.logger.debug(
        {
          dictationId,
          finalSeq,
          ackSeq: state.ackSeq,
          nextSeqToForward: state.nextSeqToForward,
          receivedChunks: state.receivedChunks.size,
          bytesSinceCommit: state.bytesSinceCommit,
        },
        "Dictation finish: no chunks received (failing fast)",
      );
      this.failDictationStream(
        dictationId,
        `Dictation finished (finalSeq=${finalSeq}) but no audio chunks were received`,
        true,
      );
      this.cleanupDictationStream(dictationId);
      return;
    }

    this.maybeSealDictationStreamFinish(dictationId);
    this.maybeFinalizeDictationStream(dictationId);

    const updatedState = this.streams.get(dictationId);
    if (!updatedState) {
      return;
    }

    const timeoutEstimate = this.estimateFinalizationTimeout(updatedState);
    if (updatedState.finalTimeout) {
      clearTimeout(updatedState.finalTimeout);
    }
    updatedState.finalTimeout = setTimeout(() => {
      void this.failAndCleanupDictationStream(
        dictationId,
        "Timed out waiting for final transcription",
        true,
      );
    }, timeoutEstimate.timeoutMs);

    this.emit({
      type: "dictation_stream_finish_accepted",
      payload: {
        dictationId,
        timeoutMs: timeoutEstimate.timeoutMs,
      },
    });

    this.logger.debug(
      {
        dictationId,
        finalSeq,
        ackSeq: updatedState.ackSeq,
        pendingSegments: timeoutEstimate.pendingSegments,
        pendingAudioSeconds: timeoutEstimate.pendingAudioSeconds,
        missingSeqCount: timeoutEstimate.missingSeqCount,
        timeoutMs: timeoutEstimate.timeoutMs,
      },
      "Accepted dictation finish request with adaptive timeout budget",
    );
  }

  public handleCancel(dictationId: string): void {
    this.cleanupDictationStream(dictationId);
  }

  private emitDictationAck(dictationId: string, ackSeq: number): void {
    this.emit({ type: "dictation_stream_ack", payload: { dictationId, ackSeq } });
  }

  private emitDictationPartial(dictationId: string, text: string): void {
    this.emit({ type: "dictation_stream_partial", payload: { dictationId, text } });
  }

  private async maybePersistDictationStreamAudio(dictationId: string): Promise<string | null> {
    if (!isRamblaDictationDebugEnabled()) {
      return null;
    }

    const state = this.streams.get(dictationId);
    if (!state) {
      return null;
    }
    if (state.debugRecordingPath) {
      return state.debugRecordingPath;
    }
    if (state.debugAudioChunks.length === 0) {
      return null;
    }

    const pcmBuffer = Buffer.concat(state.debugAudioChunks);
    const wavBuffer = convertPCMToWavBuffer(
      pcmBuffer,
      state.outputRate,
      PCM_CHANNELS,
      PCM_BITS_PER_SAMPLE,
    );
    const path = await maybePersistDictationDebugAudio(
      wavBuffer,
      { sessionId: state.sessionId, dictationId: state.dictationId, format: "audio/wav" },
      this.logger,
      state.debugChunkWriter?.folder,
    );
    state.debugRecordingPath = path;
    return path;
  }

  private failDictationStream(dictationId: string, error: string, retryable: boolean): void {
    this.emit({
      type: "dictation_stream_error",
      payload: { dictationId, error, retryable },
    });
  }

  private async failAndCleanupDictationStream(
    dictationId: string,
    error: string,
    retryable: boolean,
  ): Promise<void> {
    const state = this.streams.get(dictationId);
    const debugRecordingPath = await this.maybePersistDictationStreamAudio(dictationId);
    if (!state || this.streams.get(dictationId) !== state) return;
    this.logger.error(
      { dictationId, error, receivedSeconds: receivedSeconds(state) },
      "Dictation stream failed; audio discarded",
    );
    this.emit({
      type: "dictation_stream_error",
      payload: {
        dictationId,
        error,
        retryable,
        ...(debugRecordingPath ? { debugRecordingPath } : {}),
      },
    });
    if (debugRecordingPath) {
      this.emit({
        type: "activity_log",
        payload: {
          id: uuidv4(),
          timestamp: new Date(),
          type: "system",
          content: `Saved dictation audio: ${debugRecordingPath}`,
          metadata: { recordingPath: debugRecordingPath, dictationId },
        },
      });
    }
    this.cleanupDictationStream(dictationId);
  }

  private cleanupDictationStream(dictationId: string): void {
    const state = this.streams.get(dictationId) ?? null;
    if (!state) {
      return;
    }
    if (state.finalTimeout) {
      clearTimeout(state.finalTimeout);
    }
    this.streams.delete(dictationId);
    try {
      state.stt.close();
    } finally {
      if (this.streams.size === 0) this.onIdle?.();
    }
  }

  private estimateFinalizationTimeout(state: DictationStreamState): {
    timeoutMs: number;
    pendingSegments: number;
    pendingAudioSeconds: number;
    missingSeqCount: number;
  } {
    const bytesPerSecond = Math.max(1, state.outputRate * PCM_CHANNELS * (PCM_BITS_PER_SAMPLE / 8));
    const pendingCommittedSegments = state.committedSegmentIds.reduce((count, segmentId) => {
      return state.finalTranscriptSegmentIds.has(segmentId) ? count : count + 1;
    }, 0);
    const pendingSegments = pendingCommittedSegments + state.inFlightCommitCount;
    const pendingAudioSeconds = Math.ceil(Math.max(0, state.bytesSinceCommit) / bytesPerSecond);
    const missingSeqCount =
      state.finalSeq === null ? 0 : Math.max(0, state.finalSeq - state.ackSeq);

    const extraMs =
      pendingSegments * DICTATION_FINAL_TIMEOUT_PER_PENDING_SEGMENT_MS +
      pendingAudioSeconds * DICTATION_FINAL_TIMEOUT_PER_PENDING_AUDIO_SECOND_MS +
      missingSeqCount * DICTATION_FINAL_TIMEOUT_PER_MISSING_SEQ_MS;

    const timeoutMs = Math.max(
      this.finalTimeoutMs,
      Math.min(DICTATION_FINAL_TIMEOUT_MAX_MS, this.finalTimeoutMs + extraMs),
    );

    return {
      timeoutMs,
      pendingSegments,
      pendingAudioSeconds,
      missingSeqCount,
    };
  }

  /** Splits a chunk so a due auto-commit window ends on a pause instead of mid-word. */
  private splitChunkAtAutoCommitPause(state: DictationStreamState, chunk: Buffer): Buffer[] {
    if (state.finishRequested || state.autoCommitBytes <= 0) {
      return [chunk];
    }
    if (state.bytesSinceCommit + chunk.length < state.autoCommitBytes) {
      return [chunk];
    }
    const offset = findPauseOffset(
      chunk,
      Math.max(0, state.autoCommitBytes - state.bytesSinceCommit),
      state.outputRate,
      speechPeakThreshold(noiseFloorOf(state)),
    );
    if (offset === null || offset <= 0 || offset >= chunk.length) {
      return [chunk];
    }
    return [chunk.subarray(0, offset), chunk.subarray(offset)];
  }

  private maybeAutoCommitDictationSegment(state: DictationStreamState, atPause: boolean): void {
    if (state.finishRequested) {
      return;
    }
    if (state.autoCommitBytes <= 0 || state.bytesSinceCommit < state.autoCommitBytes) {
      return;
    }
    const maxExtraBytes = Math.round(
      DICTATION_AUTO_COMMIT_MAX_EXTRA_SECONDS * state.outputRate * PCM_CHANNELS * 2,
    );
    if (!atPause && state.bytesSinceCommit < state.autoCommitBytes + maxExtraBytes) {
      return;
    }

    this.requestDictationCommit(state);
  }

  private requestDictationCommit(state: DictationStreamState): void {
    state.bytesSinceCommit = 0;
    state.inFlightCommitCount += 1;
    try {
      state.stt.commit();
    } catch (error) {
      state.inFlightCommitCount -= 1;
      throw error;
    }
  }

  private maybeSealDictationStreamFinish(dictationId: string): void {
    const state = this.streams.get(dictationId);
    if (!state) {
      return;
    }
    if (!state.finishRequested || state.finalSeq === null) {
      return;
    }
    if (state.ackSeq < state.finalSeq) {
      return;
    }
    if (state.finishSealed) {
      return;
    }

    if (state.bytesSinceCommit > 0) {
      state.awaitingFinalCommit = true;
      try {
        this.requestDictationCommit(state);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void this.failAndCleanupDictationStream(dictationId, message, true);
        return;
      }
    } else {
      state.awaitingFinalCommit = false;
    }

    state.finishSealed = true;
  }

  private dropUncommittedNonFinalTranscripts(state: DictationStreamState): number {
    const committedSet = new Set(state.committedSegmentIds);
    let droppedCount = 0;
    for (const segmentId of state.transcriptsBySegmentId.keys()) {
      if (committedSet.has(segmentId)) {
        continue;
      }
      if (state.finalTranscriptSegmentIds.has(segmentId)) {
        continue;
      }
      state.transcriptsBySegmentId.delete(segmentId);
      droppedCount += 1;
    }
    return droppedCount;
  }

  /** Fails the stream instead of shipping empty text when the recording held audible speech. */
  private failEmptyTranscriptAfterSpeech(
    dictationId: string,
    state: DictationStreamState,
  ): boolean {
    // A room transcribes to nothing legitimately; speech does not, so an empty
    // result there is a lost recording and must reach the user as a failure.
    // Getting this wrong costs a spurious error, never audio.
    if (state.peakOverall < speechPeakThreshold(noiseFloorOf(state))) {
      return false;
    }
    void this.failAndCleanupDictationStream(
      dictationId,
      "Dictation received audible speech but produced no transcript",
      true,
    );
    return true;
  }

  private maybeFinalizeDictationStream(dictationId: string): void {
    const state = this.streams.get(dictationId);
    if (!state) {
      return;
    }

    if (!state.finishRequested || state.finalSeq === null) {
      return;
    }
    if (state.ackSeq < state.finalSeq) {
      return;
    }
    if (state.awaitingFinalCommit) {
      return;
    }
    if (state.inFlightCommitCount > 0) {
      return;
    }

    const droppedSegments = this.dropUncommittedNonFinalTranscripts(state);
    if (droppedSegments > 0) {
      this.logger.warn(
        { dictationId, droppedSegments },
        "Dropped abandoned non-final dictation transcript segments before finalization",
      );
    }

    const committedSet = new Set(state.committedSegmentIds);
    const orderedSegmentIds: string[] = [...state.committedSegmentIds];
    for (const segmentId of state.transcriptsBySegmentId.keys()) {
      if (!committedSet.has(segmentId)) {
        orderedSegmentIds.push(segmentId);
      }
    }

    if (orderedSegmentIds.length === 0) {
      if (this.failEmptyTranscriptAfterSpeech(dictationId, state)) {
        return;
      }
      this.logger.warn(
        { dictationId, receivedSeconds: receivedSeconds(state) },
        "Dictation finalized with an empty transcript",
      );
      void (async () => {
        const debugRecordingPath = await this.maybePersistDictationStreamAudio(dictationId);
        if (this.streams.get(dictationId) !== state) return;
        this.emit({
          type: "dictation_stream_final",
          payload: {
            dictationId,
            text: "",
            ...(debugRecordingPath ? { debugRecordingPath } : {}),
          },
        });
        if (debugRecordingPath) {
          this.emit({
            type: "activity_log",
            payload: {
              id: uuidv4(),
              timestamp: new Date(),
              type: "system",
              content: `Saved dictation audio: ${debugRecordingPath}`,
              metadata: { recordingPath: debugRecordingPath, dictationId },
            },
          });
        }
        this.cleanupDictationStream(dictationId);
      })();
      return;
    }

    const allTranscriptsReady = orderedSegmentIds.every((segmentId) =>
      state.finalTranscriptSegmentIds.has(segmentId),
    );
    if (!allTranscriptsReady) {
      return;
    }

    // A segment holding only room noise transcribes to nothing, and joining that
    // nothing would put a double space in the middle of the user's sentence.
    const orderedText = orderedSegmentIds
      .map((segmentId) => state.transcriptsBySegmentId.get(segmentId) ?? "")
      .filter((text) => text.length > 0)
      .join(" ")
      .trim();

    if (orderedText.length === 0) {
      if (this.failEmptyTranscriptAfterSpeech(dictationId, state)) {
        return;
      }
      this.logger.warn(
        { dictationId, receivedSeconds: receivedSeconds(state) },
        "Dictation finalized with an empty transcript",
      );
    }

    void (async () => {
      const debugRecordingPath = await this.maybePersistDictationStreamAudio(dictationId);
      if (this.streams.get(dictationId) !== state) return;
      this.emit({
        type: "dictation_stream_final",
        payload: {
          dictationId,
          text: orderedText,
          ...(debugRecordingPath ? { debugRecordingPath } : {}),
        },
      });
      if (debugRecordingPath) {
        this.emit({
          type: "activity_log",
          payload: {
            id: uuidv4(),
            timestamp: new Date(),
            type: "system",
            content: `Saved dictation audio: ${debugRecordingPath}`,
            metadata: { recordingPath: debugRecordingPath, dictationId },
          },
        });
      }
      this.cleanupDictationStream(dictationId);
    })();
  }
}

function isBufferTooSmallError(message: string): boolean {
  return /buffer too small/i.test(message);
}
