import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import { PersistedConfigSchema } from "../persisted-config.js";
import { resolveSpeechConfig } from "../speech/speech-config-resolver.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";
import { SherpaParakeetRealtimeTranscriptionSession } from "../speech/providers/local/sherpa/sherpa-parakeet-realtime-session.js";

class FakeRealtimeSession extends EventEmitter implements StreamingTranscriptionSession {
  connected = false;
  appended: Buffer[] = [];
  commitCalls = 0;
  clearCalls = 0;
  closed = false;
  requiredSampleRate = 24000;

  async connect(): Promise<void> {
    this.connected = true;
  }

  appendPcm16(pcm16le: Buffer): void {
    this.appended.push(pcm16le);
  }

  commit(): void {
    this.commitCalls += 1;
  }

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
  public lastLanguage?: string;
  constructor(private readonly session: FakeRealtimeSession) {}
  createSession(
    params: Parameters<SpeechToTextProvider["createSession"]>[0],
  ): StreamingTranscriptionSession {
    this.lastLanguage = params.language;
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

interface EmittedMessage {
  type: string;
  payload: unknown;
}

interface EmitCollector {
  emitted: EmittedMessage[];
  emit: (message: EmittedMessage) => void;
  waitFor: (type: string) => Promise<EmittedMessage>;
}

/** Collects emitted messages so a test can await one by type instead of flushing microtasks. */
const createEmitCollector = (): EmitCollector => {
  const emitted: EmittedMessage[] = [];
  const waiters = new Map<string, Array<(message: EmittedMessage) => void>>();
  return {
    emitted,
    emit: (message) => {
      emitted.push(message);
      const pending = waiters.get(message.type);
      if (!pending) return;
      waiters.delete(message.type);
      for (const resolve of pending) resolve(message);
    },
    waitFor: (type) => {
      const existing = emitted.find((message) => message.type === type);
      if (existing) return Promise.resolve(existing);
      return new Promise<EmittedMessage>((resolve) => {
        waiters.set(type, [...(waiters.get(type) ?? []), resolve]);
      });
    },
  };
};

const textOf = (message: EmittedMessage | undefined): string | undefined =>
  (message?.payload as { text?: string } | undefined)?.text;

// The debug flag decides whether the daemon writes recordings to disk, so it is
// pinned for the whole file: no block may inherit a developer's shell.
beforeEach(() => {
  vi.stubEnv("RAMBLA_DICTATION_DEBUG", "false");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DictationStreamManager (finish buffer-too-small tolerance)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats buffer-too-small as benign and finalizes with existing transcripts", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      finalTimeoutMs: 5000,
    });

    await manager.handleStart("d1", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d1",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });

    session.emitTranscript("seg-1", "hello world", true);

    await manager.handleFinish("d1", 0);

    session.emitError(
      "Error committing input audio buffer: buffer too small. Expected at least 100ms of audio, but buffer only has 0.00ms of audio.",
    );

    const final = await collector.waitFor("dictation_stream_final");
    const error = collector.emitted.find((msg) => msg.type === "dictation_stream_error");
    expect(error).toBeUndefined();
    expect(textOf(final)).toBe("hello world");
    expect(session.closed).toBe(true);
  });
});

describe("DictationStreamManager (provider-agnostic provider)", () => {
  function resolveDictationLanguage(params: {
    env?: NodeJS.ProcessEnv;
    persisted?: unknown;
  }): string {
    const result = resolveSpeechConfig({
      ramblaHome: "/tmp/rambla-home",
      env: params.env ?? ({} as NodeJS.ProcessEnv),
      persisted: PersistedConfigSchema.parse(params.persisted ?? {}),
    });
    return result.speech.sttLanguages.dictation;
  }

  async function startWithResolvedDictationLanguage(params: {
    env?: NodeJS.ProcessEnv;
    persisted?: unknown;
  }): Promise<FakeSttProvider> {
    const session = new FakeRealtimeSession();
    const sttProvider = new FakeSttProvider(session);
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: () => {},
      sessionId: "s1",
      stt: sttProvider,
      language: resolveDictationLanguage(params),
    });

    await manager.handleStart("d-lang", "audio/pcm;rate=24000;bits=16");
    return sttProvider;
  }

  it("defaults to English when dictation language config is unset", async () => {
    const sttProvider = await startWithResolvedDictationLanguage({});

    expect(sttProvider.lastLanguage).toBe("en");
  });

  it("uses RAMBLA_DICTATION_LANGUAGE when set", async () => {
    const sttProvider = await startWithResolvedDictationLanguage({
      env: {
        RAMBLA_DICTATION_LANGUAGE: "pt",
      } as NodeJS.ProcessEnv,
    });

    expect(sttProvider.lastLanguage).toBe("pt");
  });

  it("treats empty RAMBLA_DICTATION_LANGUAGE as unset", async () => {
    const sttProvider = await startWithResolvedDictationLanguage({
      env: {
        RAMBLA_DICTATION_LANGUAGE: "  ",
      } as NodeJS.ProcessEnv,
    });

    expect(sttProvider.lastLanguage).toBe("en");
  });

  it("uses settings dictation STT language when env var is unset", async () => {
    const sttProvider = await startWithResolvedDictationLanguage({
      persisted: {
        features: {
          dictation: {
            stt: {
              language: "fr",
            },
          },
        },
      },
    });

    expect(sttProvider.lastLanguage).toBe("fr");
  });

  it("uses env dictation language over settings dictation STT language", async () => {
    const sttProvider = await startWithResolvedDictationLanguage({
      env: {
        RAMBLA_DICTATION_LANGUAGE: "pt",
      } as NodeJS.ProcessEnv,
      persisted: {
        features: {
          dictation: {
            stt: {
              language: "fr",
            },
          },
        },
      },
    });

    expect(sttProvider.lastLanguage).toBe("pt");
  });

  it("does not require OPENAI_API_KEY", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const session = new FakeRealtimeSession();
      const emitted: Array<{ type: string; payload: unknown }> = [];
      const manager = new DictationStreamManager({
        logger: pino({ level: "silent" }),
        emit: (msg) => emitted.push(msg),
        sessionId: "s1",
        stt: new FakeSttProvider(session),
      });

      await manager.handleStart("d-local", "audio/pcm;rate=16000;bits=16");

      expect(session.connected).toBe(true);
      expect(emitted.find((msg) => msg.type === "dictation_stream_error")).toBeUndefined();
    } finally {
      if (original !== undefined) {
        process.env.OPENAI_API_KEY = original;
      } else {
        delete process.env.OPENAI_API_KEY;
      }
    }
  });

  it("auto-commits while streaming and assembles final transcript in segment order", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-segmented", "audio/pcm;rate=24000;bits=16");

    await manager.handleChunk({
      dictationId: "d-segmented",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24000, 7200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    expect(session.commitCalls).toBe(1);

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello", true);

    await manager.handleChunk({
      dictationId: "d-segmented",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 12000),
      format: "audio/pcm;rate=24000;bits=16",
    });

    await manager.handleFinish("d-segmented", 1);
    expect(session.commitCalls).toBe(2);

    session.emitCommitted("seg-2");
    session.emitTranscript("seg-2", "world", true);

    expect(textOf(await collector.waitFor("dictation_stream_final"))).toBe("hello world");
  });

  it("waits for an in-flight auto-commit before finalizing", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-delayed-auto-commit", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-delayed-auto-commit",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24000, 7200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    expect(session.commitCalls).toBe(1);

    await manager.handleFinish("d-delayed-auto-commit", 0);

    expect(
      collector.emitted.find((message) => message.type === "dictation_stream_final"),
    ).toBeUndefined();
    expect(session.closed).toBe(false);

    session.emitCommitted("seg-tail");
    session.emitTranscript("seg-tail", "the final words", true);
    // The silence after the pause is committed too, and transcribes to nothing.
    session.emitCommitted("seg-silent-tail");
    session.emitTranscript("seg-silent-tail", "", true);

    expect(textOf(await collector.waitFor("dictation_stream_final"))).toBe("the final words");
    expect(session.closed).toBe(true);
  });

  it("commits tail audio appended while an auto-commit is in flight", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-tail-during-commit", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-tail-during-commit",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24000, 7200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleChunk({
      dictationId: "d-tail-during-commit",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });

    session.emitCommitted("seg-first");
    session.emitTranscript("seg-first", "the beginning", true);
    await manager.handleFinish("d-tail-during-commit", 1);

    expect(session.commitCalls).toBe(2);

    session.emitCommitted("seg-tail");
    session.emitTranscript("seg-tail", "the final words", true);

    expect(textOf(await collector.waitFor("dictation_stream_final"))).toBe(
      "the beginning the final words",
    );
  });

  it("does not wait for an abandoned partial after committing mid-stream silence", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-cleared-partial", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-cleared-partial",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 24000, 7200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    session.emitCommitted("seg-first");
    session.emitTranscript("seg-first", "the beginning", true);

    session.emitTranscript("seg-abandoned", "quiet partial", false);
    await manager.handleChunk({
      dictationId: "d-cleared-partial",
      seq: 1,
      audioBase64: buildPcmBase64(0, 24000),
      format: "audio/pcm;rate=24000;bits=16",
    });
    expect(session.clearCalls).toBe(0);
    session.emitCommitted("seg-silence");
    session.emitTranscript("seg-silence", "", true);

    await manager.handleChunk({
      dictationId: "d-cleared-partial",
      seq: 2,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await manager.handleFinish("d-cleared-partial", 2);
    session.emitCommitted("seg-final");
    session.emitTranscript("seg-final", "the final words", true);

    expect(textOf(await collector.waitFor("dictation_stream_final"))).toBe(
      "the beginning the final words",
    );
    expect(session.closed).toBe(true);
  });

  it("adapts finish timeout based on pending committed segments", async () => {
    const session = new FakeRealtimeSession();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: (msg) => emitted.push(msg),
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      finalTimeoutMs: 5000,
    });

    await manager.handleStart("d-timeout", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-timeout",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });

    // Simulate a committed segment whose final transcript is still pending.
    session.emitCommitted("seg-pending");

    await manager.handleFinish("d-timeout", 0);

    const finishAccepted = emitted.find((msg) => msg.type === "dictation_stream_finish_accepted");
    expect(finishAccepted).toBeDefined();
    expect(
      (finishAccepted?.payload as { timeoutMs?: number } | undefined)?.timeoutMs,
    ).toBeGreaterThan(5000);
  });

  it("does not extend the finish timeout for abandoned non-final transcripts", async () => {
    const session = new FakeRealtimeSession();
    const emitted: Array<{ type: string; payload: unknown }> = [];
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: (msg) => emitted.push(msg),
      sessionId: "s1",
      stt: new FakeSttProvider(session),
      finalTimeoutMs: 5000,
    });

    await manager.handleStart("d-uncommitted-timeout", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-uncommitted-timeout",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });

    session.emitCommitted("seg-1");
    session.emitTranscript("seg-1", "hello", true);
    session.emitTranscript("seg-dangling", "hel", false);

    await manager.handleFinish("d-uncommitted-timeout", 0);

    const finishAccepted = emitted.find((msg) => msg.type === "dictation_stream_finish_accepted");
    expect(finishAccepted).toBeDefined();
    expect((finishAccepted?.payload as { timeoutMs?: number } | undefined)?.timeoutMs).toBe(10_000);
  });

  it("drops dangling uncommitted non-final transcripts when finishing after a silence tail", async () => {
    vi.useFakeTimers();
    try {
      const session = new FakeRealtimeSession();
      const collector = createEmitCollector();
      const manager = new DictationStreamManager({
        logger: pino({ level: "silent" }),
        emit: collector.emit,
        sessionId: "s1",
        stt: new FakeSttProvider(session),
        finalTimeoutMs: 5000,
        autoCommitSeconds: 1,
      });

      await manager.handleStart("d-clear-tail", "audio/pcm;rate=24000;bits=16");
      await manager.handleChunk({
        dictationId: "d-clear-tail",
        seq: 0,
        audioBase64: buildPcmBase64(2000, 24000, 7200),
        format: "audio/pcm;rate=24000;bits=16",
      });

      session.emitCommitted("seg-1");
      session.emitTranscript("seg-1", "hello", true);

      await manager.handleChunk({
        dictationId: "d-clear-tail",
        seq: 1,
        audioBase64: buildPcmBase64(0, 2400),
        format: "audio/pcm;rate=24000;bits=16",
      });
      session.emitTranscript("seg-dangling", "", false);

      await manager.handleFinish("d-clear-tail", 1);
      session.emitCommitted("seg-silent-tail");
      session.emitTranscript("seg-silent-tail", "", true);

      const final = await collector.waitFor("dictation_stream_final");
      // Past the finish deadline the stream is gone, so no late timeout error follows.
      await vi.advanceTimersByTimeAsync(5_100);

      const error = collector.emitted.find((msg) => msg.type === "dictation_stream_error");
      expect(session.clearCalls).toBe(0);
      expect(error).toBeUndefined();
      expect(textOf(final)).toBe("hello");
    } finally {
      vi.useRealTimers();
    }
  });
});

it("cancellation during STT bootstrap closes the producer and never acknowledges a late connection", async () => {
  let connected!: () => void;
  const gate = new Promise<void>((resolve) => {
    connected = resolve;
  });
  class ConnectingSession extends FakeRealtimeSession {
    override async connect(): Promise<void> {
      await gate;
    }
  }
  const session = new ConnectingSession();
  const messages: Array<{ type: string }> = [];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => messages.push(message),
    sessionId: "cancel-bootstrap",
    stt: new FakeSttProvider(session),
  });
  const starting = manager.handleStart("dictation", "audio/pcm;rate=24000;bits=16");
  manager.handleCancel("dictation");
  expect(session.closed).toBe(true);
  connected();
  await starting;
  expect(messages).toEqual([]);
  manager.cleanupAll();
});

class FakeParakeetStream {
  samples = new Float32Array(0);
  freed = false;

  accept(samples: Float32Array): void {
    const merged = new Float32Array(this.samples.length + samples.length);
    merged.set(this.samples);
    merged.set(samples, this.samples.length);
    this.samples = merged;
  }

  free(): void {
    this.freed = true;
  }
}

function textForSamples(sampleCount: number): string {
  if (sampleCount >= 26_000) return "hello there";
  if (sampleCount >= 23_000) return "hello";
  return "";
}

class FakeParakeetEngine {
  readonly sampleRate = 24_000;
  readonly streams: FakeParakeetStream[] = [];
  readonly recognizer = {
    decode: (_stream: FakeParakeetStream) => {},
    getResult: (stream: FakeParakeetStream) => textForSamples(stream.samples.length),
  };

  createStream(): FakeParakeetStream {
    const stream = new FakeParakeetStream();
    this.streams.push(stream);
    return stream;
  }

  acceptWaveform(stream: FakeParakeetStream, _sampleRate: number, samples: Float32Array): void {
    stream.accept(samples);
  }
}

describe("DictationStreamManager (commit during in-flight decode)", () => {
  it("a commit during an in-flight decode transcribes the audio that arrived during it", async () => {
    const engine = new FakeParakeetEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({ engine });
    const committedTranscripts: string[] = [];
    session.on("transcript", (payload: { transcript: string; isFinal: boolean }) => {
      if (payload.isFinal) committedTranscripts.push(payload.transcript);
    });
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: { id: "fake-parakeet", createSession: () => session },
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-commit-in-flight", "audio/pcm;rate=24000;bits=16");
    // The first chunk runs past the auto-commit window and then goes quiet, so
    // the window commits at that pause while its own decode is still in flight.
    // Both chunks are fed in the same tick so the second lands during it.
    const first = manager.handleChunk({
      dictationId: "d-commit-in-flight",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 27_000, 7_200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    const second = manager.handleChunk({
      dictationId: "d-commit-in-flight",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 2_400),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await first;
    await second;

    // Pins the scenario: the mid-stream commit landed before finish, and it
    // covered its own window only. Without this the test passes on the
    // finish-time commit alone and stops covering a commit inside a decode.
    expect(committedTranscripts).toEqual(["hello there"]);

    await manager.handleFinish("d-commit-in-flight", 1);

    expect(textOf(await collector.waitFor("dictation_stream_final"))).toBe("hello there");
    expect(collector.emitted.find((msg) => msg.type === "dictation_stream_error")).toBeUndefined();
    expect(session).toBeDefined();
  });

  it("audio is never discarded without appearing in a transcript", async () => {
    const engine = new FakeParakeetEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({ engine });
    const committedTranscripts: string[] = [];
    session.on("transcript", (payload: { transcript: string; isFinal: boolean }) => {
      if (payload.isFinal) committedTranscripts.push(payload.transcript);
    });
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s1",
      stt: { id: "fake-parakeet", createSession: () => session },
      autoCommitSeconds: 1,
    });

    await manager.handleStart("d-no-discard", "audio/pcm;rate=24000;bits=16");
    const first = manager.handleChunk({
      dictationId: "d-no-discard",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 27_000, 7_200),
      format: "audio/pcm;rate=24000;bits=16",
    });
    const second = manager.handleChunk({
      dictationId: "d-no-discard",
      seq: 1,
      audioBase64: buildPcmBase64(2000, 2_400),
      format: "audio/pcm;rate=24000;bits=16",
    });
    await first;
    await second;

    // Pins the scenario: the mid-stream auto-commit landed, bounded to its
    // own window, before any finish-time commit.
    expect(committedTranscripts).toEqual(["hello there"]);

    await manager.handleFinish("d-no-discard", 1);

    const final = await collector.waitFor("dictation_stream_final");
    // The tail audio's words must survive into the committed final transcript,
    // not just into a partial that later gets dropped as abandoned.
    expect(textOf(final)).toBe("hello there");
    // The decode that produced the committed final must have covered every
    // appended sample (24000 + 2400) — nothing cleared before being decoded.
    const fullCoverage = engine.streams.some((stream) => stream.samples.length >= 26_400);
    expect(fullCoverage).toBe(true);
  });
});

describe("DictationStreamManager (debug recording enabled)", () => {
  let debugDir: string;

  beforeEach(async () => {
    debugDir = await mkdtemp(join(tmpdir(), "rambla-dictation-debug-"));
    vi.stubEnv("RAMBLA_DICTATION_DEBUG", "1");
    vi.stubEnv("DICTATION_DEBUG_AUDIO_DIR", debugDir);
  });

  afterEach(async () => {
    await rm(debugDir, { recursive: true, force: true });
  });

  it("delivers the final transcript without waiting for the debug recording write", async () => {
    const session = new FakeRealtimeSession();
    const collector = createEmitCollector();
    const manager = new DictationStreamManager({
      logger: pino({ level: "silent" }),
      emit: collector.emit,
      sessionId: "s-debug",
      stt: new FakeSttProvider(session),
    });

    await manager.handleStart("d-debug", "audio/pcm;rate=24000;bits=16");
    await manager.handleChunk({
      dictationId: "d-debug",
      seq: 0,
      audioBase64: buildPcmBase64(2000, 2400),
      format: "audio/pcm;rate=24000;bits=16",
    });
    session.emitTranscript("seg-1", "hello world", true);
    await manager.handleFinish("d-debug", 0);
    session.emitCommitted("seg-1");

    // Nothing is awaited between the last provider event and this assertion, so
    // a debug disk write on the finalize path would push the final past it.
    expect(textOf(collector.emitted.find((msg) => msg.type === "dictation_stream_final"))).toBe(
      "hello world",
    );

    // The flag still does its job: the artifact lands and is announced.
    const activity = await collector.waitFor("activity_log");
    expect((activity.payload as { content: string }).content).toMatch(/^Saved dictation audio: /);
    const sessionDirs = await readdir(debugDir);
    expect(sessionDirs).toEqual(["s-debug"]);
  });
});

it("closes every dictation stream when one provider cleanup fails", async () => {
  class FailingCloseSession extends FakeRealtimeSession {
    override close(): void {
      super.close();
      throw new Error("provider cleanup failed");
    }
  }
  const first = new FailingCloseSession();
  const second = new FakeRealtimeSession();
  const sessions = [first, second];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    sessionId: "cleanup-failure",
    emit: () => {},
    stt: { id: "controlled", createSession: () => sessions.shift()! },
  });
  await manager.handleStart("first", "audio/pcm;rate=24000;bits=16");
  await manager.handleStart("second", "audio/pcm;rate=24000;bits=16");
  expect(() => manager.cleanupAll()).toThrow();
  expect(first.closed).toBe(true);
  expect(second.closed).toBe(true);
  expect(manager.hasDemand).toBe(false);
});
