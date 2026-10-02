import { existsSync, readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { homedir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterAll, beforeAll, expect, test } from "vitest";

import { Pcm16MonoResampler } from "../agent/pcm16-resampler.js";
import { parsePcm16MonoWav, parsePcmRateFromFormat } from "../speech/audio.js";
import { SherpaOnnxTTS } from "../speech/providers/local/sherpa/sherpa-tts.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
} from "../speech/providers/local/worker-client.js";
import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "./dictation-stream-manager.js";

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: imports for the manager-level submit tests.
import { chunkPcm16, normalizeTranscript } from "../test-utils/dictation-e2e.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: e2e tests for the worker clip-check session kind.

const SOURCE_TEXT =
  "The morning after the storm, the whole street smelled of wet leaves and broken branches.";

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

function hasSherpaParakeetModels(dir: string): boolean {
  return (
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx")) &&
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "tokens.txt"))
  );
}

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: tests skip when models are missing, like dictation-retention does.
const fixtureTest = hasSherpaParakeetModels(modelsDir) ? test : test.skip;
const speechTest =
  hasSherpaParakeetModels(modelsDir) && hasSherpaKokoroModels(modelsDir) ? test : test.skip;

function fadeLastWord(pcm16le: Buffer, sampleRate: number, seconds = 0.4, endGain = 0.05): Buffer {
  const faded = Buffer.from(trimTrailingSilence(pcm16le));
  const samples = new Int16Array(faded.buffer, faded.byteOffset, faded.byteLength / 2);
  const fadeSamples = Math.min(samples.length, Math.round(sampleRate * seconds));
  const start = samples.length - fadeSamples;
  for (let i = start; i < samples.length; i += 1) {
    const gain = 1 - ((i - start) / fadeSamples) * (1 - endGain);
    samples[i] = Math.round(samples[i]! * gain);
  }
  return faded;
}

function countingProvider(counts: { commits: number }): SpeechToTextProvider {
  const provider = new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt");
  return {
    id: provider.id,
    createSession: (params) => {
      const session = provider.createSession(params);
      const commit = session.commit.bind(session);
      session.commit = () => {
        counts.commits += 1;
        commit();
      };
      return session;
    },
  };
}

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

fixtureTest.each(SILENT_TAIL_FIXTURES)(
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

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: criteria 1, 2, 7 — generated speech through the real dictation path, with a quiet tail the manager decides on.
speechTest(
  "submit keeps the dictated ending and drops only the quiet no-speech tail",
  async () => {
    const logger = pino({ level: "warn" });
    const tts = new SherpaOnnxTTS(
      { preset: "kokoro-en-v0_19", modelDir: path.join(modelsDir, "kokoro-en-v0_19") },
      logger,
    );
    const synthesized = await tts.synthesizeSpeech(SOURCE_TEXT);
    const ttsChunks: Buffer[] = [];
    for await (const chunk of synthesized.stream) {
      ttsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    tts.free();

    const sampleRate = parsePcmRateFromFormat(synthesized.format, 24000) ?? 24000;
    const pcm16 = fadeLastWord(Buffer.concat(ttsChunks), sampleRate);

    const emitted: DictationStreamOutboundMessage[] = [];
    let settle!: (message: DictationStreamOutboundMessage) => void;
    const settled = new Promise<DictationStreamOutboundMessage>((resolve) => {
      settle = resolve;
    });

    const format = `audio/pcm;rate=${sampleRate};bits=16`;
    const dictationId = "dictation-tail-keep";
    const manager = new DictationStreamManager({
      logger,
      emit: (message) => {
        emitted.push(message);
        if (
          message.type === "dictation_stream_final" ||
          message.type === "dictation_stream_error"
        ) {
          settle(message);
        }
      },
      sessionId: "dictation-tail-session",
      stt: new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt"),
      autoCommitSeconds: 5,
    });

    let transcript: string;
    let droppedTranscript: string | undefined;
    try {
      await manager.handleStart(dictationId, format);
      const chunks = chunkPcm16(pcm16, sampleRate * 2);
      for (let seq = 0; seq < chunks.length; seq += 1) {
        await manager.handleChunk({
          dictationId,
          seq,
          audioBase64: chunks[seq].toString("base64"),
          format,
        });
      }
      await manager.handleFinish(dictationId, chunks.length - 1);

      const result = await settled;
      if (result.type === "dictation_stream_error") {
        throw new Error(`Dictation stream failed: ${result.payload.error}`);
      }
      transcript = result.payload.text;
      droppedTranscript = result.payload.droppedTranscript;
    } finally {
      manager.cleanupAll();
    }

    const sourceWords = normalizeTranscript(SOURCE_TEXT).split(" ").filter(Boolean);
    const transcriptWords = normalizeTranscript(transcript).split(" ").filter(Boolean);
    const ending = sourceWords.slice(-5).join(" ");
    expect(transcriptWords.join(" ")).toContain(ending);
    // Criterion 7: the last spoken word survives to the submitted text.
    expect(transcriptWords).toContain(sourceWords[sourceWords.length - 1]);
    // Criterion 1: no invented word was added beyond what was said.
    expect(transcriptWords.length).toBeLessThanOrEqual(sourceWords.length + 2);
    // Criterion 3: no doubled word at the seam between the last two audio pieces.
    const stutters: string[] = [];
    for (let i = 0; i + 1 < transcriptWords.length; i += 1) {
      if (
        transcriptWords[i] === transcriptWords[i + 1] &&
        !SOURCE_TEXT.toLowerCase().includes(`${transcriptWords[i]} ${transcriptWords[i + 1]}`)
      ) {
        stutters.push(transcriptWords[i]);
      }
    }
    expect(stutters).toEqual([]);
    // Criterion 8: a kept tail is not reported as lost words.
    expect(droppedTranscript).toBeUndefined();
  },
  600_000,
);

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: criterion 7's drop side — the spoken ending survives a silent final tail.
speechTest(
  "submit with a trailing silent tail keeps the spoken ending and reports no lost words",
  async () => {
    const logger = pino({ level: "warn" });
    const tts = new SherpaOnnxTTS(
      { preset: "kokoro-en-v0_19", modelDir: path.join(modelsDir, "kokoro-en-v0_19") },
      logger,
    );
    const synthesized = await tts.synthesizeSpeech(SOURCE_TEXT);
    const ttsChunks: Buffer[] = [];
    for await (const chunk of synthesized.stream) {
      ttsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    tts.free();

    const sampleRate = parsePcmRateFromFormat(synthesized.format, 24000) ?? 24000;
    const pcm16 = Buffer.concat([
      fadeLastWord(Buffer.concat(ttsChunks), sampleRate),
      Buffer.alloc(sampleRate * 2),
    ]);

    const emitted: DictationStreamOutboundMessage[] = [];
    let settle!: (message: DictationStreamOutboundMessage) => void;
    const settled = new Promise<DictationStreamOutboundMessage>((resolve) => {
      settle = resolve;
    });

    const format = `audio/pcm;rate=${sampleRate};bits=16`;
    const dictationId = "dictation-tail-silent";
    const manager = new DictationStreamManager({
      logger,
      emit: (message) => {
        emitted.push(message);
        if (
          message.type === "dictation_stream_final" ||
          message.type === "dictation_stream_error"
        ) {
          settle(message);
        }
      },
      sessionId: "dictation-tail-silent-session",
      stt: new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt"),
      autoCommitSeconds: 5,
    });

    let result: DictationStreamOutboundMessage;
    try {
      await manager.handleStart(dictationId, format);
      const chunks = chunkPcm16(pcm16, sampleRate * 2);
      for (let seq = 0; seq < chunks.length; seq += 1) {
        await manager.handleChunk({
          dictationId,
          seq,
          audioBase64: chunks[seq].toString("base64"),
          format,
        });
      }
      await manager.handleFinish(dictationId, chunks.length - 1);
      result = await settled;
    } finally {
      manager.cleanupAll();
    }

    expect(result.type).toBe("dictation_stream_final");
    if (result.type !== "dictation_stream_final") {
      return;
    }
    const sourceWords = normalizeTranscript(SOURCE_TEXT).split(" ").filter(Boolean);
    const transcriptWords = normalizeTranscript(result.payload.text).split(" ").filter(Boolean);
    // Criterion 2: the quiet ending word survives.
    expect(transcriptWords).toContain(sourceWords[sourceWords.length - 1]);
    // Criterion 8: the dropped tail's audio is not reported as lost words.
    expect(result.payload.droppedTranscript).toBeUndefined();
  },
  600_000,
);

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: criterion 6 through the manager — each fixture tail after speech is not decoded; criterion 1's invented word.
speechTest.each(SILENT_TAIL_FIXTURES)(
  "a fixture tail after spoken audio adds no invented word on submit (%s)",
  async (fixture) => {
    const logger = pino({ level: "warn" });
    const tts = new SherpaOnnxTTS(
      { preset: "kokoro-en-v0_19", modelDir: path.join(modelsDir, "kokoro-en-v0_19") },
      logger,
    );
    const synthesized = await tts.synthesizeSpeech(SOURCE_TEXT);
    const ttsChunks: Buffer[] = [];
    for await (const chunk of synthesized.stream) {
      ttsChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    tts.free();

    const sampleRate = parsePcmRateFromFormat(synthesized.format, 24000) ?? 24000;
    const fixturePcm = loadFixturePcm16(fixture);
    // Speech at the dictation rate, then the real no-speech tail the replays hallucinated on.
    const pcm16 = Buffer.concat([
      sampleRate === 16000
        ? Buffer.concat([Buffer.concat(ttsChunks), Buffer.alloc(sampleRate * 3)])
        : new Pcm16MonoResampler({ inputRate: 24000, outputRate: sampleRate }).processChunk(
            Buffer.concat([Buffer.concat(ttsChunks), Buffer.alloc(24000 * 3)]),
          ),
      sampleRate === 16000
        ? fixturePcm
        : new Pcm16MonoResampler({ inputRate: 16000, outputRate: sampleRate }).processChunk(
            fixturePcm,
          ),
    ]);

    let settle!: (message: DictationStreamOutboundMessage) => void;
    const settled = new Promise<DictationStreamOutboundMessage>((resolve) => {
      settle = resolve;
    });
    const counts = { commits: 0 };

    const format = `audio/pcm;rate=${sampleRate};bits=16`;
    const dictationId = `dictation-tail-fixture-${fixture}`;
    const manager = new DictationStreamManager({
      logger,
      emit: (message) => {
        if (
          message.type === "dictation_stream_final" ||
          message.type === "dictation_stream_error"
        ) {
          settle(message);
        }
      },
      sessionId: `dictation-tail-fixture-session-${fixture}`,
      stt: countingProvider(counts),
      autoCommitSeconds: 1,
    });

    let result: DictationStreamOutboundMessage;
    let commitsBeforeFinish = 0;
    try {
      await manager.handleStart(dictationId, format);
      const chunks = chunkPcm16(pcm16, sampleRate * 2);
      for (let seq = 0; seq < chunks.length; seq += 1) {
        await manager.handleChunk({
          dictationId,
          seq,
          audioBase64: chunks[seq].toString("base64"),
          format,
        });
      }
      commitsBeforeFinish = counts.commits;
      await manager.handleFinish(dictationId, chunks.length - 1);
      result = await settled;
    } finally {
      manager.cleanupAll();
    }

    expect(result.type).toBe("dictation_stream_final");
    if (result.type !== "dictation_stream_final") {
      return;
    }
    // Criterion 6: the fixture tail is never committed, so the engine never decodes it.
    expect(commitsBeforeFinish).toBeGreaterThan(0);
    expect(counts.commits).toBe(commitsBeforeFinish);
    const sourceWords = normalizeTranscript(SOURCE_TEXT).split(" ").filter(Boolean);
    const transcriptWords = normalizeTranscript(result.payload.text).split(" ").filter(Boolean);
    expect(transcriptWords).toContain(sourceWords[sourceWords.length - 1]);
    // Criterion 1: the tail's filler word never appears.
    expect(transcriptWords.filter((word) => ["mm", "hmm", "yeah", "okay"].includes(word))).toEqual(
      [],
    );
    // Criterion 8: the dropped tail is not reported as lost words.
    expect(result.payload.droppedTranscript).toBeUndefined();
  },
  600_000,
);
