import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";

import { DictationStreamManager } from "./dictation-stream-manager.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";
import { SherpaParakeetRealtimeTranscriptionSession } from "../speech/providers/local/sherpa/sherpa-parakeet-realtime-session.js";

const FORMAT = "audio/pcm;rate=24000;bits=16";
const SAMPLE_RATE = 24_000;

class FakeRealtimeSession extends EventEmitter implements StreamingTranscriptionSession {
  requiredSampleRate = SAMPLE_RATE;

  async connect(): Promise<void> {}
  appendPcm16(): void {}
  commit(): void {}
  clear(): void {}
  close(): void {}

  emitCommitted(segmentId: string): void {
    this.emit("committed", { segmentId, previousSegmentId: null });
  }

  emitTranscript(
    segmentId: string,
    transcript: string,
    isFinal: boolean,
    segmentIndex?: number,
  ): void {
    this.emit("transcript", { segmentId, transcript, isFinal, segmentIndex });
  }
}

interface EmittedPartialSegment {
  id: string;
  index: number;
  text: string;
  isFinal: boolean;
}

interface EmittedMessage {
  type: string;
  payload: { text?: string; segment?: EmittedPartialSegment };
}

/** Runs one scripted stream and returns every message the client would receive. */
async function runScriptedStream(params: {
  supportsSegments: boolean;
  script: (session: FakeRealtimeSession) => void;
}): Promise<EmittedMessage[]> {
  const session = new FakeRealtimeSession();
  const emitted: EmittedMessage[] = [];
  const provider: SpeechToTextProvider = {
    id: "fake",
    createSession: () => session,
  };
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message as EmittedMessage),
    sessionId: "segments",
    stt: provider,
    supportsSegments: () => params.supportsSegments,
  });

  await manager.handleStart("d-seg", FORMAT);
  params.script(session);
  manager.handleCancel("d-seg");
  return emitted;
}

const partialsOf = (emitted: EmittedMessage[]): EmittedMessage[] =>
  emitted.filter((message) => message.type === "dictation_stream_partial");

/** The script both paths run: two segments, the first settling while the second is live. */
function twoSegmentScript(session: FakeRealtimeSession): void {
  session.emitTranscript("seg-1", "hello", false, 0);
  session.emitTranscript("seg-1", "hello there", false, 0);
  session.emitCommitted("seg-1");
  session.emitTranscript("seg-1", "hello there friend", true, 0);
  session.emitTranscript("seg-2", "how are", false, 1);
  session.emitTranscript("seg-2", "how are you", false, 1);
}

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

/** Reports the sample count it decoded, so each segment's text is distinct. */
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

const speech = (samples: number): Buffer => {
  const pcm = new Int16Array(samples);
  pcm.fill(2000);
  return Buffer.from(pcm.buffer);
};

const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe("dictation.rambla: live segments reach a capable client", () => {
  it("a partial carries exactly one segment and no glued text", async () => {
    const emitted = await runScriptedStream({
      supportsSegments: true,
      script: (session) => session.emitTranscript("seg-1", "hello", false, 0),
    });

    expect(partialsOf(emitted).map((message) => message.payload)).toEqual([
      {
        dictationId: "d-seg",
        text: "",
        segment: { id: "seg-1", index: 0, text: "hello", isFinal: false },
      },
    ]);
  });

  it("a settled segment is sent once as final and never again", async () => {
    const emitted = await runScriptedStream({ supportsSegments: true, script: twoSegmentScript });
    const segments = partialsOf(emitted).map((message) => message.payload.segment);

    const seg1 = segments.filter((segment) => segment?.id === "seg-1");
    expect(seg1.filter((segment) => segment?.isFinal === true)).toHaveLength(1);
    expect(seg1.at(-1)?.isFinal).toBe(true);
    expect(segments.at(-1)?.id).toBe("seg-2");
  });

  it("a segment's index never changes across its own messages", async () => {
    const emitted = await runScriptedStream({ supportsSegments: true, script: twoSegmentScript });
    const indexesById = new Map<string, Set<number>>();
    for (const segment of partialsOf(emitted).map((message) => message.payload.segment)) {
      if (!segment) throw new Error("expected every partial to carry a segment");
      indexesById.set(segment.id, (indexesById.get(segment.id) ?? new Set()).add(segment.index));
    }

    expect([...indexesById].map(([id, indexes]) => [id, [...indexes]])).toEqual([
      ["seg-1", [0]],
      ["seg-2", [1]],
    ]);
  });

  it("a final arriving after a later partial keeps its lower index", async () => {
    const emitted = await runScriptedStream({
      supportsSegments: true,
      script: (session) => {
        session.emitTranscript("seg-2", "how are you", false, 1);
        session.emitCommitted("seg-1");
        session.emitTranscript("seg-1", "hello there friend", true, 0);
      },
    });

    expect(partialsOf(emitted).map((message) => message.payload.segment)).toEqual([
      { id: "seg-2", index: 1, text: "how are you", isFinal: false },
      { id: "seg-1", index: 0, text: "hello there friend", isFinal: true },
    ]);
  });

  it("segments sorted by index and joined equal the glued text the same audio produces", async () => {
    const withSegments = await runScriptedStream({
      supportsSegments: true,
      script: twoSegmentScript,
    });
    const withoutSegments = await runScriptedStream({
      supportsSegments: false,
      script: twoSegmentScript,
    });

    const latestById = new Map<number, string>();
    for (const message of partialsOf(withSegments)) {
      const segment = message.payload.segment;
      if (!segment) throw new Error("expected every partial to carry a segment");
      latestById.set(segment.index, segment.text);
    }
    const joined = [...latestById.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, text]) => text)
      .filter((text) => text.length > 0)
      .join(" ");

    expect(joined).toBe(partialsOf(withoutSegments).at(-1)?.payload.text);
  });

  it("a client without the capability still receives glued text and no segments", async () => {
    const emitted = await runScriptedStream({ supportsSegments: false, script: twoSegmentScript });
    const partials = partialsOf(emitted);

    expect(partials.at(-1)?.payload.text).toBe("hello there friend how are you");
    expect(partials.every((message) => message.payload.segment === undefined)).toBe(true);
  });

  it("an event without an index carries no segment even to a capable client", async () => {
    const emitted = await runScriptedStream({
      supportsSegments: true,
      script: (session) => session.emitTranscript("seg-1", "hello", true),
    });

    expect(partialsOf(emitted).map((message) => message.payload)).toEqual([
      { dictationId: "d-seg", text: "hello" },
    ]);
  });
});

describe("dictation.rambla: the sherpa session numbers its own segments", () => {
  it("numbers from zero and advances on commit and on clear", async () => {
    const engine = new CountingParakeetEngine();
    const session = new SherpaParakeetRealtimeTranscriptionSession({
      engine,
      minDecodeIntervalMs: 0,
    });
    const events: Array<{ index: number | undefined; isFinal: boolean }> = [];
    session.on(
      "transcript",
      (payload: { segmentIndex?: number; isFinal: boolean }) =>
        void events.push({ index: payload.segmentIndex, isFinal: payload.isFinal }),
    );

    await session.connect();
    session.appendPcm16(speech(2_400));
    await tick();
    session.commit();
    await tick();
    session.appendPcm16(speech(4_800));
    await tick();
    session.clear();
    session.appendPcm16(speech(7_200));
    await tick();

    expect(events).toEqual([
      { index: 0, isFinal: false },
      { index: 0, isFinal: true },
      { index: 1, isFinal: false },
      { index: 2, isFinal: false },
    ]);
  });
});
