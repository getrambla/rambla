import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import pino from "pino";
import { expect, test } from "vitest";

import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "./dictation-stream-manager.js";
import { parsePcmRateFromFormat } from "../speech/audio.js";
import { SherpaOnnxTTS } from "../speech/providers/local/sherpa/sherpa-tts.js";
import {
  LocalSpeechWorkerClient,
  WorkerBackedSpeechToTextProvider,
} from "../speech/providers/local/worker-client.js";
import {
  chunkPcm16,
  normalizeTranscript,
  wordSimilarity,
  writeFixtureWav,
} from "../test-utils/dictation-e2e.js";

const SOURCE_TEXT =
  "The morning after the storm, the whole street smelled of wet leaves and broken branches. " +
  "Our neighbour was out early with a borrowed saw, cutting the fallen elm into pieces small " +
  "enough to carry. I made coffee and took two cups down the path, and we stood there for a " +
  "while without saying much, watching the water run along the gutter and disappear into the " +
  "drain at the corner. Someone had already set out orange cones around the downed line, though " +
  "nobody could say when the crew would arrive. By the middle of the afternoon the power was " +
  "still off, so we cooked on the camp stove in the back garden and ate outside while the light " +
  "lasted. The children thought it was a holiday. They dragged blankets onto the grass and " +
  "argued about which of them had heard the loudest crack in the night. Later, when the lamps " +
  "in the far houses came back on one by one, there was a small cheer from somewhere down the " +
  "road. I remember thinking that a week of ordinary days would pass without anyone speaking to " +
  "each other at all, and that it took a ruined tree to get us talking again. The crew came at " +
  "last just before dark, two vans and a cherry picker that took up the whole width of the road. " +
  "We watched them work under the floodlights, and the smell of cut wood hung in the cold air " +
  "long after the noise had stopped. By nine the kettle was boiling again, and the house made " +
  "its usual small sounds, and none of it seemed quite as ordinary as it had the week before.";

const ENDING_WORD_COUNT = 5;

const modelsDir =
  process.env.RAMBLA_LOCAL_MODELS_DIR ?? path.join(homedir(), ".rambla", "models", "local-speech");

function hasSherpaParakeetModels(dir: string): boolean {
  return (
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx")) &&
    existsSync(path.join(dir, "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "tokens.txt"))
  );
}

function hasSherpaKokoroModels(dir: string): boolean {
  return (
    existsSync(path.join(dir, "kokoro-en-v0_19", "model.onnx")) &&
    existsSync(path.join(dir, "kokoro-en-v0_19", "voices.bin")) &&
    existsSync(path.join(dir, "kokoro-en-v0_19", "tokens.txt"))
  );
}

const retentionTest =
  hasSherpaParakeetModels(modelsDir) && hasSherpaKokoroModels(modelsDir) ? test : test.skip;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adjacent word pairs, as "a b" strings, for detecting duplicates the speaker never said. */
function adjacentPairs(words: string[]): Set<string> {
  const pairs = new Set<string>();
  for (let i = 0; i + 1 < words.length; i += 1) {
    pairs.add(`${words[i]} ${words[i + 1]}`);
  }
  return pairs;
}

retentionTest(
  "retains dictated words, the ending, and introduces no stutters through the real pipeline",
  async () => {
    const startedAt = Date.now();
    const logLines: string[] = [];
    const logger = pino(
      { level: "warn" },
      {
        write(line: string) {
          logLines.push(line.trim());
        },
      },
    );

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

    const pcm16 = Buffer.concat(ttsChunks);
    const sampleRate = parsePcmRateFromFormat(synthesized.format, 24000) ?? 24000;
    const audioSeconds = pcm16.length / (sampleRate * 2);
    console.log(`[dictation-retention] synthesized audio: ${audioSeconds.toFixed(1)}s`);
    console.log(
      `[dictation-retention] audio: ${writeFixtureWav("dictation-retention", pcm16, sampleRate)}`,
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

    const emitted: DictationStreamOutboundMessage[] = [];
    let settle!: (message: DictationStreamOutboundMessage) => void;
    const settled = new Promise<DictationStreamOutboundMessage>((resolve) => {
      settle = resolve;
    });

    const format = `audio/pcm;rate=${sampleRate};bits=16`;
    const dictationId = "dictation-retention";
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
      sessionId: "dictation-retention-session",
      stt: new WorkerBackedSpeechToTextProvider(workerClient, "dictationStt"),
    });

    let transcript: string;
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
        await sleep(1000);
      }
      await manager.handleFinish(dictationId, chunks.length - 1);

      const result = await settled;
      if (result.type === "dictation_stream_error") {
        throw new Error(`Dictation stream failed: ${result.payload.error}`);
      }
      transcript = result.payload.text;
    } finally {
      manager.cleanupAll();
      workerClient.shutdown();
    }

    const sourceWords = normalizeTranscript(SOURCE_TEXT).split(" ").filter(Boolean);
    const transcriptWords = normalizeTranscript(transcript).split(" ").filter(Boolean);
    const retention = wordSimilarity(SOURCE_TEXT, transcript);

    console.log(`[dictation-retention] source text:\n${SOURCE_TEXT}`);
    console.log(`[dictation-retention] transcript:\n${transcript}`);
    console.log(`[dictation-retention] word retention: ${(retention * 100).toFixed(1)}%`);
    console.log(
      `[dictation-retention] wall clock: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
    console.log(`[dictation-retention] manager log lines:\n${logLines.join("\n") || "(none)"}`);

    const ending = sourceWords.slice(-ENDING_WORD_COUNT).join(" ");
    expect(transcriptWords.join(" ")).toContain(ending);

    const sourcePairs = adjacentPairs(sourceWords);
    const stutters: string[] = [];
    for (let i = 0; i + 1 < transcriptWords.length; i += 1) {
      const pair = `${transcriptWords[i]} ${transcriptWords[i + 1]}`;
      if (transcriptWords[i] === transcriptWords[i + 1] && !sourcePairs.has(pair)) {
        stutters.push(pair);
      }
    }
    expect(stutters).toEqual([]);
  },
  600_000,
);
