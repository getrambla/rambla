import { EventEmitter } from "node:events";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import {
  DictationStreamManager,
  type DictationStreamOutboundMessage,
} from "./dictation-stream-manager.js";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionSession,
} from "../speech/speech-provider.js";

// RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: the submit tail through the real manager with a fake session.
const FORMAT = "audio/pcm;rate=16000;bits=16";
const TAIL_SAMPLES = 1600;

class FakeSession extends EventEmitter implements StreamingTranscriptionSession {
  requiredSampleRate = 16000;
  commitCalls = 0;
  clearCalls = 0;
  failCommit = false;

  async connect(): Promise<void> {}
  appendPcm16(): void {}

  commit(): void {
    if (this.failCommit) {
      throw new Error("commit failed");
    }
    this.commitCalls += 1;
    this.emit("committed", { segmentId: "seg-tail", previousSegmentId: "seg-1" });
    this.emit("transcript", { segmentId: "seg-tail", transcript: "there", isFinal: true });
  }

  clear(): void {
    this.clearCalls += 1;
  }

  close(): void {}
}

class FakeClipSession extends FakeSession {
  checked: Buffer[] = [];
  release!: (result: boolean | Error) => void;

  clipHasSpeech(pcm16le: Buffer): Promise<boolean> {
    this.checked.push(pcm16le);
    const { promise, resolve, reject } = Promise.withResolvers<boolean>();
    this.release = (result) => (result instanceof Error ? reject(result) : resolve(result));
    return promise;
  }
}

function pcmBase64(sampleValue: number, sampleCount: number): string {
  return Buffer.from(new Int16Array(sampleCount).fill(sampleValue).buffer).toString("base64");
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function submit(session: FakeSession, preview?: string) {
  const emitted: DictationStreamOutboundMessage[] = [];
  const stt: SpeechToTextProvider = { id: "fake", createSession: () => session };
  const manager = new DictationStreamManager({
    logger: pino({ level: "silent" }),
    emit: (message) => emitted.push(message),
    sessionId: "s-tail",
    stt,
    autoCommitSeconds: 0,
    finalTimeoutMs: 5000,
  });
  await manager.handleStart("d-tail", FORMAT);
  session.emit("committed", { segmentId: "seg-1", previousSegmentId: null });
  session.emit("transcript", { segmentId: "seg-1", transcript: "hello world", isFinal: true });
  await manager.handleChunk({
    dictationId: "d-tail",
    seq: 0,
    audioBase64: pcmBase64(3000, TAIL_SAMPLES),
    format: FORMAT,
  });
  if (preview) {
    session.emit("transcript", { segmentId: "seg-tail", transcript: preview, isFinal: false });
  }
  await manager.handleFinish("d-tail", 0);
  return { manager, emitted };
}

function messageTypes(emitted: DictationStreamOutboundMessage[]): string[] {
  return emitted.map((message) => message.type);
}

function finals(emitted: DictationStreamOutboundMessage[]) {
  return emitted.filter((message) => message.type === "dictation_stream_final");
}

describe("dictation-tail-vad.rambla: the submit tail through the manager", () => {
  it("drops a no-speech tail: cleared, never committed, preview erased, not reported as lost", async () => {
    const session = new FakeClipSession();
    const { manager, emitted } = await submit(session, "Yeah.");
    try {
      expect(session.checked[0]?.length).toBe(TAIL_SAMPLES * 2);
      const before = emitted.length;
      session.release(false);
      await settle();
      expect(session.commitCalls).toBe(0);
      expect(session.clearCalls).toBe(1);
      expect(emitted.slice(before)[0]).toEqual({
        type: "dictation_stream_partial",
        payload: { dictationId: "d-tail", text: "hello world" },
      });
      expect(finals(emitted)).toEqual([
        { type: "dictation_stream_final", payload: { dictationId: "d-tail", text: "hello world" } },
      ]);
    } finally {
      manager.cleanupAll();
    }
  });

  it("keeps a tail with speech and joins it without doubled or missing words", async () => {
    const session = new FakeClipSession();
    const { manager, emitted } = await submit(session, "the");
    try {
      session.release(true);
      await settle();
      expect(session.commitCalls).toBe(1);
      expect(session.clearCalls).toBe(0);
      expect(finals(emitted)).toEqual([
        {
          type: "dictation_stream_final",
          payload: { dictationId: "d-tail", text: "hello world there" },
        },
      ]);
    } finally {
      manager.cleanupAll();
    }
  });

  it("holds finalize and any second seal while the check runs", async () => {
    const session = new FakeClipSession();
    const { manager, emitted } = await submit(session);
    try {
      await manager.handleFinish("d-tail", 0);
      await settle();
      expect(session.checked).toHaveLength(1);
      expect(session.commitCalls).toBe(0);
      expect(finals(emitted)).toEqual([]);
      session.release(true);
      await settle();
      expect(session.commitCalls).toBe(1);
      expect(finals(emitted)).toHaveLength(1);
    } finally {
      manager.cleanupAll();
    }
  });

  it("commits the tail as today when the check fails", async () => {
    const session = new FakeClipSession();
    const { manager, emitted } = await submit(session);
    try {
      session.release(new Error("worker gone"));
      await settle();
      expect(session.commitCalls).toBe(1);
      expect(finals(emitted)[0]?.payload).toEqual({
        dictationId: "d-tail",
        text: "hello world there",
      });
    } finally {
      manager.cleanupAll();
    }
  });

  it("fails the stream cleanly when the kept tail's commit throws", async () => {
    const session = new FakeClipSession();
    session.failCommit = true;
    const { manager, emitted } = await submit(session);
    try {
      session.release(true);
      await vi.waitFor(() => expect(messageTypes(emitted)).toContain("dictation_stream_error"));
      expect(finals(emitted)).toEqual([]);
    } finally {
      manager.cleanupAll();
    }
  });

  it("commits at once, without a check, for a session with no clip check", async () => {
    const session = new FakeSession();
    const { manager, emitted } = await submit(session, "the");
    try {
      expect(session.commitCalls).toBe(1);
      expect(session.clearCalls).toBe(0);
      expect(finals(emitted)).toEqual([
        {
          type: "dictation_stream_final",
          payload: { dictationId: "d-tail", text: "hello world there" },
        },
      ]);
    } finally {
      manager.cleanupAll();
    }
  });

  it("sends only the message types and payload keys the session without a check sends", async () => {
    const plain = await submit(new FakeSession(), "Yeah.");
    const clip = new FakeClipSession();
    const dropped = await submit(clip, "Yeah.");
    try {
      clip.release(false);
      await settle();
      const shape = (messages: DictationStreamOutboundMessage[]) =>
        new Set(messages.map((m) => `${m.type}:${Object.keys(m.payload).toSorted().join(",")}`));
      expect(shape(dropped.emitted)).toEqual(
        new Set([
          ...shape(plain.emitted),
          "dictation_stream_finish_accepted:dictationId,timeoutMs",
        ]),
      );
    } finally {
      plain.manager.cleanupAll();
      dropped.manager.cleanupAll();
    }
  });
});
