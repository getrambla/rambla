import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it } from "vitest";

import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "./dictation-stream-manager.js";
import type { StreamingTranscriptionSession } from "../speech/speech-provider.js";

const FORMAT = "audio/pcm;rate=16000;bits=16";
const SAMPLE_RATE = 16_000;
const DICTATION_ID = "dictation-1";

/** A session the test drives by hand: it decodes nothing and emits exactly what a case asks for. */
class ScriptedSession extends EventEmitter implements StreamingTranscriptionSession {
  readonly requiredSampleRate = SAMPLE_RATE;

  async connect(): Promise<void> {}
  appendPcm16(): void {}
  commit(): void {}
  clear(): void {}
  close(): void {}

  partial(params: { id: string; index?: number; text: string }): void {
    this.emit("transcript", {
      segmentId: params.id,
      transcript: params.text,
      isFinal: false,
      ...(params.index === undefined ? {} : { index: params.index }),
    });
  }

  final(params: { id: string; index?: number; text: string }): void {
    this.emit("committed", { segmentId: params.id, previousSegmentId: null });
    this.emit("transcript", {
      segmentId: params.id,
      transcript: params.text,
      isFinal: true,
      ...(params.index === undefined ? {} : { index: params.index }),
    });
  }
}

type PartialPayload = Extract<
  DictationStreamOutboundMessage,
  { type: "dictation_stream_partial" }
>["payload"];

interface Stream {
  session: ScriptedSession;
  partials: () => PartialPayload[];
}

async function startStream(supportsSegments: boolean): Promise<Stream> {
  const session = new ScriptedSession();
  const emitted: DictationStreamOutboundMessage[] = [];
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message),
    sessionId: "session-1",
    stt: { id: "local", createSession: () => session },
    supportsSegments: () => supportsSegments,
  });
  await manager.handleStart(DICTATION_ID, FORMAT);
  return {
    session,
    partials: () =>
      emitted
        .filter((message) => message.type === "dictation_stream_partial")
        .map((message) => message.payload),
  };
}

/** The script both capability paths are measured against. */
function speakSameAudio(session: ScriptedSession): void {
  session.partial({ id: "seg-a", index: 0, text: "one" });
  session.final({ id: "seg-a", index: 0, text: "one two" });
  session.final({ id: "seg-b", index: 1, text: "" });
  session.partial({ id: "seg-c", index: 2, text: "three" });
  session.partial({ id: "seg-c", index: 2, text: "three four" });
}

describe("dictation segment partials", () => {
  it("carries exactly one segment per partial", async () => {
    const stream = await startStream(true);

    stream.session.partial({ id: "seg-a", index: 0, text: "hello" });

    expect(stream.partials()).toEqual([
      {
        dictationId: DICTATION_ID,
        text: "",
        segment: { id: "seg-a", index: 0, text: "hello", isFinal: false },
      },
    ]);
  });

  it("sends a committed id once with isFinal and never again", async () => {
    const stream = await startStream(true);

    stream.session.partial({ id: "seg-a", index: 0, text: "hello" });
    stream.session.final({ id: "seg-a", index: 0, text: "hello there" });
    stream.session.partial({ id: "seg-b", index: 1, text: "again" });
    stream.session.partial({ id: "seg-b", index: 1, text: "again and again" });

    const finals = stream
      .partials()
      .filter((payload) => payload.segment?.id === "seg-a" && payload.segment.isFinal);
    expect(finals).toHaveLength(1);
    expect(finals[0].segment?.text).toBe("hello there");
    expect(
      stream
        .partials()
        .slice(2)
        .map((payload) => payload.segment?.id),
    ).toEqual(["seg-b", "seg-b"]);
  });

  it("keeps a segment's index the same across its own messages", async () => {
    const stream = await startStream(true);

    stream.session.partial({ id: "seg-a", index: 0, text: "hel" });
    stream.session.partial({ id: "seg-a", index: 0, text: "hello" });
    stream.session.final({ id: "seg-a", index: 0, text: "hello there" });

    const indexes = stream
      .partials()
      .filter((payload) => payload.segment?.id === "seg-a")
      .map((payload) => payload.segment?.index);
    expect(indexes).toEqual([0, 0, 0]);
  });

  it("gives a late final a lower index than the partial that arrived before it", async () => {
    const stream = await startStream(true);

    stream.session.partial({ id: "seg-b", index: 1, text: "later words" });
    stream.session.final({ id: "seg-a", index: 0, text: "earlier words" });

    expect(stream.partials().map((payload) => payload.segment?.index)).toEqual([1, 0]);
  });

  it("joins segments by index into the same text the glued path produces", async () => {
    const segmented = await startStream(true);
    const glued = await startStream(false);

    speakSameAudio(segmented.session);
    speakSameAudio(glued.session);

    const latestById = new Map<string, { index: number; text: string }>();
    for (const payload of segmented.partials()) {
      const segment = payload.segment;
      if (!segment) throw new Error("expected a segment");
      latestById.set(segment.id, { index: segment.index, text: segment.text });
    }
    const joined = [...latestById.values()]
      .sort((left, right) => left.index - right.index)
      .map((segment) => segment.text)
      .filter((text) => text.length > 0)
      .join(" ")
      .trim();

    const gluedPartials = glued.partials();
    expect(joined).toBe(gluedPartials[gluedPartials.length - 1].text);
    expect(joined).toBe("one two three four");
  });

  it("gives a client without the capability today's glued messages and no segment", async () => {
    const stream = await startStream(false);

    speakSameAudio(stream.session);

    expect(stream.partials()).toEqual([
      { dictationId: DICTATION_ID, text: "one" },
      { dictationId: DICTATION_ID, text: "one two" },
      { dictationId: DICTATION_ID, text: "one two" },
      { dictationId: DICTATION_ID, text: "one two three" },
      { dictationId: DICTATION_ID, text: "one two three four" },
    ]);
  });
});
