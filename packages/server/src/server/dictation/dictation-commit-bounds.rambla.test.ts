import pino from "pino";
import { describe, expect, it } from "vitest";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import { SherpaParakeetRealtimeTranscriptionSession } from "../speech/providers/local/sherpa/sherpa-parakeet-realtime-session.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24_000;

class CountingParakeetStream {
  samples = new Float32Array(0);

  accept(samples: Float32Array): void {
    const merged = new Float32Array(this.samples.length + samples.length);
    merged.set(this.samples);
    merged.set(samples, this.samples.length);
    this.samples = merged;
  }

  free(): void {}
}

/** Reports the exact sample count it decoded, so a segment's audio bounds are visible in its text. */
class CountingParakeetEngine {
  readonly sampleRate = SAMPLE_RATE;
  readonly recognizer = {
    decode: (_stream: CountingParakeetStream) => {},
    getResult: (stream: CountingParakeetStream) => `s${stream.samples.length}`,
  };

  createStream(): CountingParakeetStream {
    return new CountingParakeetStream();
  }

  acceptWaveform(stream: CountingParakeetStream, _sampleRate: number, samples: Float32Array): void {
    stream.accept(samples);
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

describe("dictation.rambla: an auto-commit bounds the audio it commits", () => {
  it("commits only the audio before the pause, not the rest of the chunk", async () => {
    const engine = new CountingParakeetEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({ engine });
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: (message) => emitted.push(message),
      sessionId: "commit-bounds",
      stt: { id: "counting-parakeet", createSession: () => session },
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-bounds", FORMAT);
    // One second of speech fills the window, then a 200 ms pause, then more
    // speech. The commit must cover the speech before the pause and nothing
    // after it, even though the whole chunk is appended in the same tick.
    await manager.handleChunk({
      dictationId: "d-bounds",
      seq: 0,
      audioBase64: buildPcmBase64([
        { value: 2000, samples: 24_000 },
        { value: 0, samples: 4_800 },
        { value: 2000, samples: 12_000 },
      ]),
      format: FORMAT,
    });

    await manager.handleFinish("d-bounds", 0);
    await tick();
    await tick();

    const final = emitted.find((message) => message.type === "dictation_stream_final");
    expect((final?.payload as { text?: string } | undefined)?.text).toBe("s25440 s15360");
  });
});
