import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const CONTEXT_RATE = 48_000;
const OUTPUT_RATE = 16_000;
const QUANTUM = 128;
const SEGMENT_FRAMES = 256;
const VOLUME_EVERY_QUANTA = 4;
/** Six 48 kHz quanta carry exactly 256 frames of 16 kHz audio. */
const QUANTA_PER_SEGMENT = 6;

type Posted = { type: string } & Record<string, unknown>;

class FakePort {
  readonly posted: Posted[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: Posted): void {
    this.posted.push(message);
  }
}

interface CaptureProcessor {
  port: FakePort;
  process(inputs: Float32Array[][]): boolean;
}

type CaptureProcessorCtor = new (options: {
  processorOptions: {
    outputSampleRate: number;
    segmentFrames: number;
    volumeEveryQuanta: number;
  };
}) => CaptureProcessor;

/** The AudioWorkletGlobalScope the processor is written against. */
const scope = globalThis as unknown as {
  sampleRate: number;
  currentFrame: number;
  AudioWorkletProcessor: unknown;
  registerProcessor: (name: string, ctor: CaptureProcessorCtor) => void;
};

let registeredName = "";
let Processor: CaptureProcessorCtor;

beforeAll(async () => {
  scope.sampleRate = CONTEXT_RATE;
  scope.currentFrame = 0;
  scope.AudioWorkletProcessor = class {
    port = new FakePort();
  };
  scope.registerProcessor = (name, ctor) => {
    registeredName = name;
    Processor = ctor;
  };
  await import("../../public/rambla-audio-capture-processor.js");
});

beforeEach(() => {
  scope.currentFrame = 0;
  scope.sampleRate = CONTEXT_RATE;
});

function createProcessor(): CaptureProcessor {
  return new Processor({
    processorOptions: {
      outputSampleRate: OUTPUT_RATE,
      segmentFrames: SEGMENT_FRAMES,
      volumeEveryQuanta: VOLUME_EVERY_QUANTA,
    },
  });
}

/** Renders whole quanta of a constant signal and advances the audio clock with them. */
function render(processor: CaptureProcessor, quanta: number, value = 0.5): void {
  for (let index = 0; index < quanta; index += 1) {
    processor.process([[new Float32Array(QUANTUM).fill(value)]]);
    scope.currentFrame += QUANTUM;
  }
}

/** A signal whose amplitude states the exact input frame it came from. */
function rampAt(frame: number, totalFrames: number): number {
  return -0.9 + (1.8 * frame) / (totalFrames - 1);
}

function expectedInt16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
}

function renderRamp(processor: CaptureProcessor, quanta: number): void {
  const totalFrames = quanta * QUANTUM;
  for (let index = 0; index < quanta; index += 1) {
    const channel = new Float32Array(QUANTUM);
    for (let frame = 0; frame < QUANTUM; frame += 1) {
      channel[frame] = rampAt(scope.currentFrame + frame, totalFrames);
    }
    processor.process([[channel]]);
    scope.currentFrame += QUANTUM;
  }
}

/** A starved audio thread: the clock moves on while process() is never called. */
function skipRenders(quanta: number): void {
  scope.currentFrame += QUANTUM * quanta;
}

function segments(processor: CaptureProcessor): Posted[] {
  return processor.port.posted.filter((message) => message.type === "segment");
}

function volumes(processor: CaptureProcessor): Posted[] {
  return processor.port.posted.filter((message) => message.type === "volume");
}

function send(processor: CaptureProcessor, data: Record<string, unknown>): void {
  processor.port.onmessage?.({ data });
}

function pcmOf(message: Posted): Int16Array {
  return new Int16Array(message.pcm as ArrayBuffer);
}

describe("audio capture worklet", () => {
  it("registers under the name the main thread constructs", () => {
    expect(registeredName).toBe("rambla-audio-capture");
  });

  it("posts a segment of exactly the requested frame count", () => {
    const processor = createProcessor();

    render(processor, QUANTA_PER_SEGMENT);

    expect(segments(processor)).toHaveLength(1);
    expect(segments(processor)[0].frames).toBe(SEGMENT_FRAMES);
    expect(pcmOf(segments(processor)[0])).toHaveLength(SEGMENT_FRAMES);
  });

  it("resamples the context rate down to 16 kHz PCM16", () => {
    const processor = createProcessor();

    render(processor, QUANTA_PER_SEGMENT, 0.5);

    expect([...pcmOf(segments(processor)[0])]).toEqual(Array(SEGMENT_FRAMES).fill(16_384));
  });

  it("interpolates between input samples at a fractional rate", () => {
    // 44.1 kHz does not divide into 16 kHz, so output frames land between input
    // samples and most quanta start before their own first sample. Nearest
    // neighbour, or clamping instead of reaching back a quantum, misses by
    // around a hundred counts here.
    scope.sampleRate = 44_100;
    const processor = createProcessor();
    const quanta = 6;
    const ratio = 44_100 / OUTPUT_RATE;

    renderRamp(processor, quanta);

    const pcm = pcmOf(segments(processor)[0]);
    const errors = [...pcm].map((sample, index) =>
      Math.abs(sample - expectedInt16(rampAt(index * ratio, quanta * QUANTUM))),
    );
    expect(Math.max(...errors)).toBeLessThanOrEqual(1);
  });

  it("numbers consecutive segments contiguously", () => {
    const processor = createProcessor();

    render(processor, QUANTA_PER_SEGMENT * 3);

    expect(segments(processor).map((message) => message.firstFrameIndex)).toEqual([0, 256, 512]);
  });

  it("numbers a segment from the audio clock, so a skipped render shows as a jump", () => {
    const processor = createProcessor();

    render(processor, QUANTA_PER_SEGMENT);
    skipRenders(QUANTA_PER_SEGMENT);
    render(processor, QUANTA_PER_SEGMENT);

    const indices = segments(processor).map((message) => message.firstFrameIndex);
    expect(indices).toEqual([0, 512]);
  });

  it("keeps reporting volume while muted and stops accumulating audio", () => {
    const processor = createProcessor();

    send(processor, { type: "mute", muted: true });
    render(processor, QUANTA_PER_SEGMENT * 2, 0.5);

    expect(segments(processor)).toHaveLength(0);
    expect(volumes(processor)).toHaveLength(3);
    expect(volumes(processor)[0].rms).toBeCloseTo(0.5, 5);
  });

  it("keeps the frame index on the audio clock across a muted stretch", () => {
    const processor = createProcessor();

    send(processor, { type: "mute", muted: true });
    render(processor, QUANTA_PER_SEGMENT);
    send(processor, { type: "flush", final: true });

    expect(processor.port.posted.at(-1)).toEqual({
      type: "flushed",
      finalFrameIndex: 256,
      final: true,
    });
  });

  it("resumes accumulating audio when unmuted", () => {
    const processor = createProcessor();

    send(processor, { type: "mute", muted: true });
    render(processor, QUANTA_PER_SEGMENT);
    send(processor, { type: "mute", muted: false });
    render(processor, QUANTA_PER_SEGMENT);

    expect(segments(processor)).toHaveLength(1);
    expect(segments(processor)[0].firstFrameIndex).toBe(256);
  });

  it("emits the remainder and then reports the flush", () => {
    const processor = createProcessor();

    render(processor, 3);
    send(processor, { type: "flush", final: true });

    expect(processor.port.posted.at(-2)).toMatchObject({
      type: "segment",
      frames: 128,
      firstFrameIndex: 0,
    });
    expect(processor.port.posted.at(-1)).toEqual({
      type: "flushed",
      finalFrameIndex: 128,
      final: true,
    });
  });

  it("reports a flush with nothing buffered instead of staying silent", () => {
    const processor = createProcessor();

    send(processor, { type: "flush", final: true });

    expect(segments(processor)).toHaveLength(0);
    expect(processor.port.posted.at(-1)).toEqual({
      type: "flushed",
      finalFrameIndex: 0,
      final: true,
    });
  });
});
