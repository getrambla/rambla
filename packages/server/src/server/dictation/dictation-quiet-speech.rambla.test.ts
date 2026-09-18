import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24_000;

/** Reports the sample count of every committed segment, so discarded audio is visible in the text. */
class CountingSession extends EventEmitter implements StreamingTranscriptionSession {
  readonly requiredSampleRate = SAMPLE_RATE;
  clearCalls = 0;
  closed = false;
  private buffer = Buffer.alloc(0);
  private nextSegment = 1;

  constructor(private readonly transcribe: (samples: number) => string = (s) => `s${s}`) {
    super();
  }

  async connect(): Promise<void> {}

  appendPcm16(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  commit(): void {
    const samples = this.buffer.length / 2;
    this.buffer = Buffer.alloc(0);
    const segmentId = `seg-${this.nextSegment}`;
    this.nextSegment += 1;
    this.emit("committed", { segmentId, previousSegmentId: null });
    this.emit("transcript", { segmentId, transcript: this.transcribe(samples), isFinal: true });
  }

  clear(): void {
    this.clearCalls += 1;
    this.buffer = Buffer.alloc(0);
  }

  close(): void {
    this.closed = true;
  }
}

/**
 * Runs of a constant sample value. That is a DC level, not audio — it makes no
 * sound at any amplitude — and it is only ever fed to a fake session here. It
 * stands in for loudness because the keep, cut and report decisions under test
 * read a peak and nothing else. Anything about what an engine hears needs real
 * audio: see `dictation-room-noise.rambla.e2e.test.ts`.
 */
function buildPcmBase64(runs: Array<{ value: number; samples: number }>): string {
  const total = runs.reduce((sum, run) => sum + run.samples, 0);
  const samples = new Int16Array(total);
  let offset = 0;
  for (const run of runs) {
    samples.fill(run.value, offset, offset + run.samples);
    offset += run.samples;
  }
  return Buffer.from(samples.buffer).toString("base64");
}

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

interface Scenario {
  session: CountingSession;
  finalText: string | undefined;
  errorText: string | undefined;
}

async function runDictation(params: {
  dictationId: string;
  chunks: string[];
  transcribe?: (samples: number) => string;
  autoCommitSeconds?: number;
}): Promise<Scenario> {
  const session = new CountingSession(params.transcribe);
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message),
    sessionId: "quiet-speech",
    stt: { id: "counting", createSession: () => session },
    autoCommitSeconds: params.autoCommitSeconds ?? 1,
  });

  await manager.handleStart(params.dictationId, FORMAT);
  for (let seq = 0; seq < params.chunks.length; seq += 1) {
    await manager.handleChunk({
      dictationId: params.dictationId,
      seq,
      audioBase64: params.chunks[seq],
      format: FORMAT,
    });
  }
  await manager.handleFinish(params.dictationId, params.chunks.length - 1);
  await tick();
  await tick();

  const final = emitted.find((message) => message.type === "dictation_stream_final");
  const error = emitted.find((message) => message.type === "dictation_stream_error");
  return {
    session,
    finalText: (final?.payload as { text?: string } | undefined)?.text,
    errorText: (error?.payload as { error?: string } | undefined)?.error,
  };
}

describe("dictation.rambla: audio is never discarded for being quiet", () => {
  it("transcribes a trailing tail that is barely above digital silence", async () => {
    // A speaker trailing off at the end of a sentence, recorded at low gain: a
    // peak of 5 is under every threshold the daemon ever used, and it is still
    // the user's words.
    const { session, finalText } = await runDictation({
      dictationId: "d-quiet-tail",
      chunks: [
        buildPcmBase64([
          { value: 2000, samples: 24_000 },
          { value: 0, samples: 7_200 },
        ]),
        buildPcmBase64([{ value: 5, samples: 2_400 }]),
      ],
    });

    expect(session.clearCalls).toBe(0);
    // 5760 silent samples left after the pause cut plus the 2400 quiet ones.
    expect(finalText).toBe("s25440 s8160");
  });

  it("transcribes a quiet window in the middle of a dictation", async () => {
    const { session, finalText } = await runDictation({
      dictationId: "d-quiet-window",
      chunks: [buildPcmBase64([{ value: 5, samples: 24_000 }])],
    });

    expect(session.clearCalls).toBe(0);
    expect(finalText).toBe("s24000");
  });

  it("finds the pause between words when a steady room noise never dips to zero", async () => {
    // A fan holds the room at 500, above the old fixed threshold, so the old
    // pause scan saw one unbroken sound and cut at the byte count instead.
    const { session, finalText } = await runDictation({
      dictationId: "d-noisy-room",
      chunks: [
        buildPcmBase64([
          { value: 6000, samples: 24_000 },
          { value: 500, samples: 4_800 },
          { value: 6000, samples: 12_000 },
        ]),
      ],
    });

    expect(session.clearCalls).toBe(0);
    expect(finalText).toBe("s25440 s15360");
  });

  it("still finds pauses after one near-silent window, in a room that is not near-silent", async () => {
    // Noise suppression zeroes a pause early in the recording. The room it then
    // settles at is what the next cut has to be judged against; the momentary
    // zero is over and must stop counting.
    const room = buildPcmBase64([{ value: 500, samples: 24_000 }]);
    const { finalText } = await runDictation({
      dictationId: "d-dropout-then-room",
      autoCommitSeconds: 6,
      chunks: [
        buildPcmBase64([
          { value: 0, samples: 480 },
          { value: 500, samples: 23_520 },
        ]),
        room,
        room,
        room,
        room,
        buildPcmBase64([
          { value: 6000, samples: 24_000 },
          { value: 500, samples: 4_800 },
          { value: 6000, samples: 12_000 },
        ]),
      ],
    });

    expect(finalText).toBe("s145440 s15360");
  });

  it("reports no failure when the engine returns nothing for a room-level recording", async () => {
    // Whether a real room makes the engine invent words is not answerable with a
    // DC level and a fake session; `dictation-room-noise.rambla.e2e.test.ts`
    // answers it with real noise. This pins only the reporting rule: an empty
    // result from audio that never rose above the room is not an error.
    const { session, finalText, errorText } = await runDictation({
      dictationId: "d-room-only",
      chunks: [buildPcmBase64([{ value: 500, samples: 48_000 }])],
      transcribe: () => "",
    });

    expect(session.clearCalls).toBe(0);
    expect(errorText).toBeUndefined();
    expect(finalText).toBe("");
  });
});
