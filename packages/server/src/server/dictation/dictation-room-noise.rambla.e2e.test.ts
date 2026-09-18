import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import { expect, test } from "vitest";

import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "./dictation-stream-manager.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
} from "../speech/providers/local/worker-client.js";
import { chunkPcm16, parsePcm16MonoWav, writeFixtureWav } from "../test-utils/dictation-e2e.js";
import { pcm16lePeakAbs } from "../speech/audio.js";

const SAMPLE_RATE = 16_000;
const NOISE_SECONDS = 8;
const NOISE_PEAK = 600;
const RECORDED_TONE_SECONDS = 6;

const modelsDir =
  process.env.RAMBLA_LOCAL_MODELS_DIR ?? path.join(homedir(), ".rambla", "models", "local-speech");

function hasSherpaParakeetModels(dir: string): boolean {
  return (
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx")) &&
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "tokens.txt"))
  );
}

const noiseTest = hasSherpaParakeetModels(modelsDir) ? test : test.skip;

/** Steady low-level hiss, lowpassed so it sounds like a room rather than static. */
function buildRoomNoise(seconds: number, peak: number): Buffer {
  const total = Math.round(seconds * SAMPLE_RATE);
  const samples = new Int16Array(total);
  let seed = 0x2f6e2b1;
  let previous = 0;
  for (let i = 0; i < total; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const white = (seed / 0x7fffffff) * 2 - 1;
    previous = previous * 0.85 + white * 0.15;
    samples[i] = Math.round(previous * peak * 6);
  }
  return Buffer.from(samples.buffer);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The quietest second of the checked-in microphone recording, repeated: real room tone, no speech. */
function loadRecordedRoomTone(seconds: number): Buffer {
  const wavPath = fileURLToPath(
    new URL("../../../../app/e2e/support/fixtures/recording.wav", import.meta.url),
  );
  const { sampleRate, pcm16 } = parsePcm16MonoWav(readFileSync(wavPath));
  if (sampleRate !== SAMPLE_RATE) {
    throw new Error(`Fixture rate ${sampleRate} != ${SAMPLE_RATE}`);
  }
  const windowBytes = SAMPLE_RATE * 2;
  let quietestOffset = 0;
  let quietestPeak = Number.POSITIVE_INFINITY;
  for (let offset = 0; offset + windowBytes <= pcm16.length; offset += windowBytes / 10) {
    const peak = pcm16lePeakAbs(pcm16.subarray(offset, offset + windowBytes));
    if (peak < quietestPeak) {
      quietestPeak = peak;
      quietestOffset = offset - (offset % 2);
    }
  }
  const tone = pcm16.subarray(quietestOffset, quietestOffset + windowBytes);
  return Buffer.concat(Array.from({ length: seconds }, () => tone));
}

async function transcribeThroughRealEngine(params: {
  name: string;
  pcm16: Buffer;
}): Promise<DictationStreamOutboundMessage> {
  const logger = pino({ level: "warn" });
  const seconds = params.pcm16.length / (SAMPLE_RATE * 2);
  console.log(
    `[${params.name}] ${seconds.toFixed(1)}s, peak ${pcm16lePeakAbs(params.pcm16)}: ` +
      writeFixtureWav(params.name, params.pcm16, SAMPLE_RATE),
  );

  const workerClient = new LocalSpeechWorkerClient({
    logger,
    config: {
      modelsDir,
      voiceSttModel: "parakeet-tdt-0.6b-v2-int8",
      dictationSttModel: "parakeet-tdt-0.6b-v2-int8",
      voiceTtsModel: "kokoro-en-v0_19",
    },
  });

  let settle!: (message: DictationStreamOutboundMessage) => void;
  const settled = new Promise<DictationStreamOutboundMessage>((resolve) => {
    settle = resolve;
  });

  const format = `audio/pcm;rate=${SAMPLE_RATE};bits=16`;
  const manager = new DictationStreamManager({
    logger,
    emit: (message) => {
      if (message.type === "dictation_stream_final" || message.type === "dictation_stream_error") {
        settle(message);
      }
    },
    sessionId: `${params.name}-session`,
    stt: new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt"),
  });

  try {
    await manager.handleStart(params.name, format);
    const chunks = chunkPcm16(params.pcm16, SAMPLE_RATE * 2);
    for (let seq = 0; seq < chunks.length; seq += 1) {
      await manager.handleChunk({
        dictationId: params.name,
        seq,
        audioBase64: chunks[seq].toString("base64"),
        format,
      });
      await sleep(200);
    }
    await manager.handleFinish(params.name, chunks.length - 1);
    return await settled;
  } finally {
    manager.cleanupAll();
    workerClient.shutdown();
  }
}

function expectNoPhantomText(name: string, result: DictationStreamOutboundMessage): void {
  if (result.type === "dictation_stream_final") {
    console.log(`[${name}] transcript: ${JSON.stringify(result.payload.text)}`);
  }
  expect(result.type).toBe("dictation_stream_final");
  expect(result.type === "dictation_stream_final" ? result.payload.text : "").toBe("");
}

noiseTest(
  "recorded room tone with no speech in it produces no text and no failure",
  async () => {
    const result = await transcribeThroughRealEngine({
      name: "dictation-recorded-room-tone",
      pcm16: loadRecordedRoomTone(RECORDED_TONE_SECONDS),
    });
    expectNoPhantomText("dictation-recorded-room-tone", result);
  },
  300_000,
);

noiseTest(
  "a loud steady hiss produces no text and no failure",
  async () => {
    const result = await transcribeThroughRealEngine({
      name: "dictation-room-noise",
      pcm16: buildRoomNoise(NOISE_SECONDS, NOISE_PEAK),
    });
    expectNoPhantomText("dictation-room-noise", result);
  },
  300_000,
);
