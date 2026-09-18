import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24_000;

/** A session that snapshots its buffer on commit and holds the decode open until the test releases it. */
class HeldOpenSession extends EventEmitter implements StreamingTranscriptionSession {
  readonly requiredSampleRate = SAMPLE_RATE;
  clearCalls = 0;
  closed = false;
  readonly committedBytes: number[] = [];
  private buffer = Buffer.alloc(0);
  private readonly held: Array<{ segmentId: string; bytes: number }> = [];
  private nextSegment = 1;

  constructor(private readonly transcribe: (bytes: number) => string) {
    super();
  }

  async connect(): Promise<void> {}

  appendPcm16(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
  }

  commit(): void {
    const bytes = this.buffer.length;
    this.buffer = Buffer.alloc(0);
    this.committedBytes.push(bytes);
    this.held.push({ segmentId: `seg-${this.nextSegment}`, bytes });
    this.nextSegment += 1;
  }

  clear(): void {
    this.clearCalls += 1;
    this.buffer = Buffer.alloc(0);
  }

  close(): void {
    this.closed = true;
  }

  get inFlightCommits(): number {
    return this.held.length;
  }

  /** Completes the oldest held-open decode. */
  release(): void {
    const next = this.held.shift();
    if (!next) {
      throw new Error("no commit is in flight");
    }
    this.emit("committed", { segmentId: next.segmentId, previousSegmentId: null });
    this.emit("transcript", {
      segmentId: next.segmentId,
      transcript: this.transcribe(next.bytes),
      isFinal: true,
    });
  }
}

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

interface FinishScenario {
  emitted: Array<{ type: string; payload: unknown }>;
  session: HeldOpenSession;
}

/** One second of speech that auto-commits at its trailing pause, then a short spoken tail, then finish. */
async function finishWithCommitInFlight(params: {
  dictationId: string;
  transcribe: (bytes: number) => string;
}): Promise<FinishScenario> {
  const session = new HeldOpenSession(params.transcribe);
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message),
    sessionId: "finish-tail",
    stt: { id: "held-open", createSession: () => session },
    autoCommitSeconds: 1,
  });

  await manager.handleStart(params.dictationId, FORMAT);
  await manager.handleChunk({
    dictationId: params.dictationId,
    seq: 0,
    audioBase64: buildPcmBase64([
      { value: 2000, samples: 24_000 },
      { value: 0, samples: 7_200 },
    ]),
    format: FORMAT,
  });
  expect(session.inFlightCommits).toBe(1);

  await manager.handleChunk({
    dictationId: params.dictationId,
    seq: 1,
    audioBase64: buildPcmBase64([{ value: 2000, samples: 2_400 }]),
    format: FORMAT,
  });
  await manager.handleFinish(params.dictationId, 1);

  return { emitted, session };
}

describe("dictation.rambla: finishing while a commit is in flight", () => {
  it("never reports an empty transcript as success after audible speech", async () => {
    const { emitted, session } = await finishWithCommitInFlight({
      dictationId: "d-empty-after-speech",
      transcribe: () => "",
    });

    session.release();
    await tick();
    session.release();
    await tick();
    await tick();

    const final = emitted.find((message) => message.type === "dictation_stream_final");
    expect((final?.payload as { text?: string } | undefined)?.text).not.toBe("");
    expect(emitted.find((message) => message.type === "dictation_stream_error")).toBeDefined();
  });

  it("commits the tail rather than clearing it while an earlier commit is still open", async () => {
    const { emitted, session } = await finishWithCommitInFlight({
      dictationId: "d-tail-during-open-commit",
      transcribe: (bytes) => `s${bytes}`,
    });

    expect(session.clearCalls).toBe(0);
    // 2400 samples of speech plus the 5760 silent samples left after the pause cut.
    expect(session.committedBytes).toEqual([50_880, 16_320]);

    session.release();
    await tick();
    session.release();
    await tick();
    await tick();

    const final = emitted.find((message) => message.type === "dictation_stream_final");
    expect((final?.payload as { text?: string } | undefined)?.text).toBe("s50880 s16320");
  });
});
