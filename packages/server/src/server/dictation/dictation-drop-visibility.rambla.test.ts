import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import pino from "pino";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24000;

class FakeRealtimeSession extends EventEmitter implements StreamingTranscriptionSession {
  closed = false;
  requiredSampleRate = SAMPLE_RATE;

  async connect(): Promise<void> {}

  appendPcm16(): void {}

  commit(): void {}

  clear(): void {}

  close(): void {
    this.closed = true;
  }

  emitCommitted(segmentId: string): void {
    this.emit("committed", { segmentId, previousSegmentId: null });
  }

  emitTranscript(segmentId: string, transcript: string, isFinal: boolean): void {
    this.emit("transcript", { segmentId, transcript, isFinal });
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

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

/** Drives a dictation to finish with one abandoned non-final segment holding `danglingText`. */
async function finalizeWithDanglingSegment(
  dictationId: string,
  danglingText: string,
): Promise<{ text?: string; droppedTranscript?: string } | undefined> {
  const session = new FakeRealtimeSession();
  const emitted: Array<{ type: string; payload: unknown }> = [];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (msg) => emitted.push(msg),
    sessionId: "s1",
    stt: new FakeSttProvider(session),
    autoCommitSeconds: 1,
  });

  await manager.handleStart(dictationId, FORMAT);
  await manager.handleChunk({
    dictationId,
    seq: 0,
    audioBase64: buildPcmBase64(2000, 24000, 7200),
    format: FORMAT,
  });

  session.emitCommitted("seg-1");
  session.emitTranscript("seg-1", "hello", true);
  // The provider produced words for a segment it then abandoned: never committed, never final.
  session.emitTranscript("seg-dangling", danglingText, false);

  await manager.handleFinish(dictationId, 0);
  session.emitCommitted("seg-tail");
  session.emitTranscript("seg-tail", "", true);
  await tick();

  const final = emitted.find((msg) => msg.type === "dictation_stream_final");
  return final?.payload as { text?: string; droppedTranscript?: string } | undefined;
}

describe("dictation.rambla: a dropped segment is never silent", () => {
  const previousDebug = process.env.RAMBLA_DICTATION_DEBUG;

  beforeEach(() => {
    // Debug recording turns the final emit into a file write, which this test does not wait for.
    process.env.RAMBLA_DICTATION_DEBUG = "false";
  });

  afterEach(() => {
    process.env.RAMBLA_DICTATION_DEBUG = previousDebug;
  });

  it("reports the words it dropped when they are missing from the final text", async () => {
    const payload = await finalizeWithDanglingSegment("d-lost", "about the kittens");

    expect(payload?.text).toBe("hello");
    // Dropping these words with only a daemon.log line leaves a blind user holding half a
    // sentence with no way to know the rest existed.
    expect(payload?.droppedTranscript).toBe("about the kittens");
  });

  it("stays quiet when the dropped partial is already part of the final text", async () => {
    const payload = await finalizeWithDanglingSegment("d-duplicate", "hell");

    expect(payload?.text).toBe("hello");
    // A stale partial of audio that was committed under another segment id lost nothing,
    // and warning about it would train the user to ignore the warning that matters.
    expect(payload?.droppedTranscript).toBeUndefined();
  });
});
