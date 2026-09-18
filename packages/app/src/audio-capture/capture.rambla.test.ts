import { describe, expect, it } from "vitest";

import {
  PROCESSOR_URL,
  createAudioCapture,
  type CaptureBackend,
  type CaptureCommand,
  type CaptureSegment,
} from "./capture.web";

const SEGMENT_FRAMES = 16_000;

interface FakeWorklet {
  backend: CaptureBackend;
  posted: CaptureCommand[];
  closes: number;
  openFailure: Error | null;
  answerFlush: boolean;
  /** Frames the worklet's clock says it has produced. */
  cursor: number;
  emitSegment(frames: number): void;
  emitVolume(rms: number): void;
  interrupt(): void;
  tailOnFlush: number;
}

function createFakeWorklet(): FakeWorklet {
  const fake: FakeWorklet = {
    backend: {
      open: async (request) => {
        if (fake.openFailure) {
          throw fake.openFailure;
        }
        fake.emitSegment = (frames) => {
          const pcm = new Int16Array(frames).fill(7);
          request.onMessage({
            type: "segment",
            pcm: pcm.buffer,
            frames,
            firstFrameIndex: fake.cursor,
          });
          fake.cursor += frames;
        };
        fake.emitVolume = (rms) => request.onMessage({ type: "volume", rms });
        fake.interrupt = () => request.onInterruption();
        return {
          post: (command) => {
            fake.posted.push(command);
            if (command.type !== "flush" || !fake.answerFlush) {
              return;
            }
            if (fake.tailOnFlush > 0) {
              fake.emitSegment(fake.tailOnFlush);
            }
            request.onMessage({
              type: "flushed",
              finalFrameIndex: fake.cursor,
              final: command.final,
            });
          },
          close: async () => {
            fake.closes += 1;
          },
        };
      },
    },
    posted: [],
    closes: 0,
    openFailure: null,
    answerFlush: true,
    cursor: 0,
    tailOnFlush: 0,
    emitSegment: () => undefined,
    emitVolume: () => undefined,
    interrupt: () => undefined,
  };
  return fake;
}

function createCapture(fake: FakeWorklet, overrides: Record<string, unknown> = {}) {
  const segments: CaptureSegment[] = [];
  const volumes: number[] = [];
  const errors: string[] = [];
  const interruptions: string[] = [];
  const capture = createAudioCapture({
    segmentFrames: SEGMENT_FRAMES,
    backend: fake.backend,
    flushTimeoutMs: 20,
    onSegment: (segment) => segments.push(segment),
    onVolume: (rms) => volumes.push(rms),
    onError: (error) => errors.push(error.message),
    onInterruption: () => interruptions.push("interrupted"),
    ...overrides,
  });
  return { capture, segments, volumes, errors, interruptions };
}

describe("web audio capture", () => {
  it("delivers captured audio and volume to its consumer", async () => {
    const fake = createFakeWorklet();
    const { capture, segments, volumes } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    fake.emitVolume(0.25);

    expect(segments).toEqual([{ pcm: new Int16Array([7, 7, 7, 7]), firstFrameIndex: 0 }]);
    expect(volumes).toEqual([0.25]);
  });

  it("delivers the tail the worklet still held before stop resolves", async () => {
    const fake = createFakeWorklet();
    fake.tailOnFlush = 3;
    const order: string[] = [];
    const { capture } = createCapture(fake, {
      onSegment: (segment: CaptureSegment) => order.push(`segment:${segment.pcm.length}`),
    });

    await capture.start();
    fake.emitSegment(4);
    await capture.stop();
    order.push("stopped");

    expect(order).toEqual(["segment:4", "segment:3", "stopped"]);
    expect(fake.posted).toEqual([{ type: "flush", final: true }]);
    expect(fake.closes).toBe(1);
  });

  it("names the worklet it could not load when starting fails", async () => {
    const fake = createFakeWorklet();
    fake.openFailure = new Error("The user denied permission to use a media device");
    const { capture, errors } = createCapture(fake);

    await expect(capture.start()).rejects.toThrow(PROCESSOR_URL);
    await expect(capture.start()).rejects.toThrow(
      "The user denied permission to use a media device",
    );
    expect(errors).toEqual([]);
  });

  it("reports an interruption once and stops capturing", async () => {
    const fake = createFakeWorklet();
    const { capture, interruptions } = createCapture(fake);

    await capture.start();
    fake.interrupt();
    fake.interrupt();
    await capture.stop();

    expect(interruptions).toEqual(["interrupted"]);
    expect(fake.closes).toBe(1);
    expect(fake.posted).toEqual([]);
  });

  it("reports audio the audio thread skipped", async () => {
    const fake = createFakeWorklet();
    const { capture, errors, segments } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    fake.cursor += 799;
    fake.emitSegment(4);
    // Next gap: 801 frames = 50.06 ms, which rounds to 50 and must report.
    fake.cursor += 801;
    fake.emitSegment(4);

    expect(errors).toEqual([
      "Microphone capture dropped 50 ms of audio: the audio thread missed renders.",
    ]);
    expect(segments).toHaveLength(3);
  });

  it("drops sub-threshold gaps silently", async () => {
    const fake = createFakeWorklet();
    const { capture, errors, segments } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    // 50 ms at 16 kHz is exactly 800 frames; 799 is one frame under the edge.
    fake.cursor += 799;
    fake.emitSegment(4);

    expect(errors).toEqual([]);
    expect(segments).toHaveLength(2);
  });

  it("reports a flush the worklet never answers", async () => {
    const fake = createFakeWorklet();
    fake.answerFlush = false;
    const { capture, errors } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    await capture.stop();

    expect(errors).toEqual([
      "Microphone capture did not confirm its final flush within 20 ms, so the end of the recording may be missing.",
    ]);
    expect(fake.closes).toBe(1);
  });

  it("reports audio the worklet counted but never delivered", async () => {
    const fake = createFakeWorklet();
    const { capture, errors } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    fake.cursor += 160;
    await capture.stop();

    expect(errors).toEqual([
      "Microphone capture ended 160 frames short of what the audio clock reported.",
    ]);
  });

  it("does not mistake muted audio for lost audio", async () => {
    const fake = createFakeWorklet();
    const { capture, errors } = createCapture(fake);

    await capture.start();
    fake.emitSegment(4);
    capture.setMuted(true);
    fake.cursor += 160;
    await capture.stop();

    expect(errors).toEqual([]);
    expect(fake.posted).toEqual([
      { type: "mute", muted: true },
      { type: "flush", final: true },
    ]);
  });

  it("ignores a stop with no capture running", async () => {
    const fake = createFakeWorklet();
    const { capture, errors } = createCapture(fake);

    await capture.stop();

    expect(fake.posted).toEqual([]);
    expect(errors).toEqual([]);
  });
});
