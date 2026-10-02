import { existsSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, expect, test } from "vitest";

import { Pcm16MonoResampler } from "../agent/pcm16-resampler.js";
import { parsePcm16MonoWav } from "../speech/audio.js";
import { SherpaOnnxTTS } from "../speech/providers/local/sherpa/sherpa-tts.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
} from "../speech/providers/local/worker-client.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: e2e tests for the worker clip-check session kind.

const FIXTURES_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "fixtures");
const SILENT_TAIL_FIXTURES = [
  "silent-tail-mm.wav",
  "silent-tail-yeah.wav",
  "silent-tail-mm-hmm.wav",
  "silent-tail-yeah-loud.wav",
];

const modelsDir =
  process.env.RAMBLA_LOCAL_MODELS_DIR ?? path.join(homedir(), ".rambla", "models", "local-speech");

function hasSherpaKokoroModels(dir: string): boolean {
  return (
    existsSync(path.join(dir, "kokoro-en-v0_19", "model.onnx")) &&
    existsSync(path.join(dir, "kokoro-en-v0_19", "voices.bin")) &&
    existsSync(path.join(dir, "kokoro-en-v0_19", "tokens.txt"))
  );
}

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: TTS-dependent tests skip when the Kokoro model is missing, like dictation-retention does.
const speechTest = hasSherpaKokoroModels(modelsDir) ? test : test.skip;

let workerClient: LocalSpeechWorkerClient;

beforeAll(() => {
  const logger = pino({ level: "warn" });
  workerClient = new LocalSpeechWorkerClient({
    logger,
    config: {
      modelsDir,
      voiceSttModel: "parakeet-tdt-0.6b-v2-int8",
      dictationSttModel: "parakeet-tdt-0.6b-v2-int8",
      voiceTtsModel: "kokoro-en-v0_19",
    },
  });
});

afterAll(() => {
  workerClient?.shutdown();
});

function createDictationSession(): StreamingTranscriptionSession {
  const provider = new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt");
  return provider.createSession({ logger: pino({ level: "warn" }) });
}

/** The dictation transcription session's clip check, added by this plan. */
function clipHasSpeech(session: StreamingTranscriptionSession, pcm16le: Buffer): Promise<boolean> {
  return (session as unknown as { clipHasSpeech(pcm: Buffer): Promise<boolean> }).clipHasSpeech(
    pcm16le,
  );
}

function loadFixturePcm16(name: string): Buffer {
  return parsePcm16MonoWav(readFileSync(path.join(FIXTURES_DIR, name))).pcm16;
}

/** Cuts trailing near-silence so the last word ends at the very end of the clip. */
function trimTrailingSilence(pcm16le: Buffer, threshold = 50): Buffer {
  const samples = new Int16Array(pcm16le.buffer, pcm16le.byteOffset, pcm16le.byteLength / 2);
  let lastLoud = -1;
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (Math.abs(samples[i]!) > threshold) {
      lastLoud = i;
      break;
    }
  }
  if (lastLoud < 0) {
    return pcm16le;
  }
  return pcm16le.subarray(0, (lastLoud + 1) * 2);
}

test.each(SILENT_TAIL_FIXTURES)(
  "clip check reports no speech for silent tail fixture %s",
  async (fixture) => {
    const session = createDictationSession();
    await session.connect();
    try {
      const hasSpeech = await clipHasSpeech(session, loadFixturePcm16(fixture));
      expect(hasSpeech).toBe(false);
    } finally {
      session.close();
    }
  },
  120_000,
);

speechTest(
  "clip check reports speech for generated speech, including a word ending at the clip end",
  async () => {
    const logger = pino({ level: "warn" });
    const tts = new SherpaOnnxTTS(
      { preset: "kokoro-en-v0_19", modelDir: path.join(modelsDir, "kokoro-en-v0_19") },
      logger,
    );
    const synthesized = await tts.synthesizeSpeech("The crew came at last just before dark.");
    const ttsChunks: Buffer[] = [];
    for await (const chunk of synthesized.stream) {
      ttsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    tts.free();

    const pcm24k = Buffer.concat(ttsChunks);
    const resampler = new Pcm16MonoResampler({ inputRate: 24000, outputRate: 16000 });
    const pcm16k = resampler.processChunk(pcm24k);
    expect(pcm16k.length).toBeGreaterThan(0);

    const session = createDictationSession();
    await session.connect();
    try {
      const midClip = await clipHasSpeech(session, pcm16k);
      expect(midClip).toBe(true);

      const trimmed = trimTrailingSilence(pcm16k);
      expect(trimmed.length).toBeLessThan(pcm16k.length);
      const endClip = await clipHasSpeech(session, trimmed);
      expect(endClip).toBe(true);
    } finally {
      session.close();
    }
  },
  120_000,
);

speechTest(
  "a vad session still discards unconfirmed speech on flush",
  async () => {
    const logger = pino({ level: "warn" });
    const tts = new SherpaOnnxTTS(
      { preset: "kokoro-en-v0_19", modelDir: path.join(modelsDir, "kokoro-en-v0_19") },
      logger,
    );
    const synthesized = await tts.synthesizeSpeech("dark.");
    const ttsChunks: Buffer[] = [];
    for await (const chunk of synthesized.stream) {
      ttsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    tts.free();

    const resampler = new Pcm16MonoResampler({ inputRate: 24000, outputRate: 16000 });
    const endClip = trimTrailingSilence(resampler.processChunk(Buffer.concat(ttsChunks)));

    const emitter = new EventEmitter();
    let speechStoppedCount = 0;
    emitter.on("speech_stopped", () => {
      speechStoppedCount += 1;
    });
    const { sessionId } = await workerClient.createSession("vad", emitter);
    try {
      workerClient.appendSessionAudio(sessionId, endClip);
      await workerClient.flushSession(sessionId);
    } finally {
      workerClient.closeSession(sessionId);
    }
    expect(speechStoppedCount).toBe(0);
  },
  120_000,
);
