import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import {
  createCaptureLogger,
  type CreateCaptureLoggerResult,
} from "../../test-utils/capture-logger.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24000;

class FakeRealtimeSession extends EventEmitter implements StreamingTranscriptionSession {
  clearCalls = 0;
  closed = false;
  requiredSampleRate = SAMPLE_RATE;

  async connect(): Promise<void> {}

  appendPcm16(): void {}

  commit(): void {}

  clear(): void {
    this.clearCalls += 1;
  }

  close(): void {
    this.closed = true;
  }

  emitCommitted(segmentId: string): void {
    this.emit("committed", { segmentId, previousSegmentId: null });
  }

  emitTranscript(segmentId: string, transcript: string, isFinal: boolean): void {
    this.emit("transcript", { segmentId, transcript, isFinal });
  }

  emitError(message: string): void {
    this.emit("error", new Error(message));
  }
}

class FakeSttProvider implements SpeechToTextProvider {
  public readonly id = "fake";
  constructor(private readonly session: FakeRealtimeSession) {}
  createSession(): StreamingTranscriptionSession {
    return this.session;
  }
}

const buildPcmBase64 = (
  sampleValue: number,
  sampleCount: number,
  trailingSilenceSamples = 0,
): string => {
  const samples = new Int16Array(sampleCount + trailingSilenceSamples);
  samples.fill(sampleValue, 0, sampleCount);
  return Buffer.from(samples.buffer).toString("base64");
};

const secondsFor = (sampleCount: number): number => sampleCount / SAMPLE_RATE;

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

function findWarnings(capture: CreateCaptureLoggerResult, message: string) {
  return capture.calls.filter((call) => call.level.label === "warn" && call.message === message);
}

describe("dictation.rambla: discarded audio is logged above debug level", () => {
  const previousDebug = process.env.RAMBLA_DICTATION_DEBUG;

  beforeEach(() => {
    process.env.RAMBLA_DICTATION_DEBUG = "false";
  });

  afterEach(() => {
    process.env.RAMBLA_DICTATION_DEBUG = previousDebug;
  });

  function createManager(params: {
    capture: CreateCaptureLoggerResult;
    session: FakeRealtimeSession;
    autoCommitSeconds?: number;
  }): DictationStreamManager {
    return new DictationStreamManager({
      logger: params.capture.logger,
      emit: () => {},
      sessionId: "s1",
      stt: new FakeSttProvider(params.session),
      ...(params.autoCommitSeconds === undefined
        ? {}
        : { autoCommitSeconds: params.autoCommitSeconds }),
    });
  }

  it("warns when abandoned non-final transcript segments are dropped", async () => {
    const capture = createCaptureLogger();
    const session = new FakeRealtimeSession();
    const manager = createManager({ capture, session, autoCommitSeconds: 1 });

    await manager.handleStart("d-dropped", FORMAT);
    await manager.handleChunk({
      dictationId: "d-dropped",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24000, 7200),
      format: FORMAT,
    });

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello", true);
    session.emitTranscript("seg-dangling", "hel", false);

    await manager.handleFinish("d-dropped", 0);
    session.emitCommitted("seg-tail");
    session.emitTranscript("seg-tail", "", true);
    await tick();

    const warnings = findWarnings(
      capture,
      "Dropped abandoned non-final dictation transcript segments before finalization",
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.details.dictationId).toBe("d-dropped");
    expect(warnings[0]?.details.droppedSegments).toBe(1);
  });

  it("warns when finalization emits an empty transcript after audio arrived", async () => {
    const capture = createCaptureLogger();
    const session = new FakeRealtimeSession();
    const manager = createManager({ capture, session });

    await manager.handleStart("d-empty", FORMAT);
    await manager.handleChunk({
      dictationId: "d-empty",
      seq: 0,
      audioBase64: buildPcmBase64(0, 2400),
      format: FORMAT,
    });
    await manager.handleFinish("d-empty", 0);
    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "", true);
    await tick();

    const warnings = findWarnings(capture, "Dictation finalized with an empty transcript");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.details.dictationId).toBe("d-empty");
    expect(warnings[0]?.details.receivedSeconds).toBeCloseTo(secondsFor(2400), 5);
  });

  it("logs an error with the received duration when the stream fails and is cleaned up", async () => {
    const capture = createCaptureLogger();
    const session = new FakeRealtimeSession();
    const manager = createManager({ capture, session });

    await manager.handleStart("d-failed", FORMAT);
    await manager.handleChunk({
      dictationId: "d-failed",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2400),
      format: FORMAT,
    });

    session.emitError("provider exploded");
    await tick();

    const errors = capture.calls.filter(
      (call) =>
        call.level.label === "error" && call.message === "Dictation stream failed; audio discarded",
    );
    expect(errors).toHaveLength(1);
    expect(errors[0]?.details.dictationId).toBe("d-failed");
    expect(errors[0]?.details.error).toBe("provider exploded");
    expect(errors[0]?.details.receivedSeconds).toBeCloseTo(secondsFor(2400), 5);
  });
});
