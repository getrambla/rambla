import { beforeEach, describe, expect, it, vi } from "vitest";

type NativeEventListener = (event: { data: Uint8Array | string }) => void;

const microphoneListeners = new Set<NativeEventListener>();
const interruptionListeners = new Set<NativeEventListener>();

/**
 * Mirrors the process-wide native singleton in `ExpoTwoWayAudioModule.swift` and
 * `ExpoTwoWayAudioModule.kt`: `initialize()` is idempotent, `tearDown()` drops the engine,
 * and `toggleRecording()` returns false whenever no engine exists.
 */
const nativeSingleton = {
  engineAlive: false,
  recording: false,
  sessionActive: false,
  refuseRecording: false,
  /** The mic tap only delivers buffers while a live engine is recording, in both the Swift and the Kotlin. */
  emitMicrophoneData(data: Uint8Array) {
    if (!nativeSingleton.engineAlive || !nativeSingleton.recording) {
      return;
    }
    for (const listener of microphoneListeners) {
      listener({ data });
    }
  },
  /** An interruption stops the native recording; a resume turns it back on before JavaScript hears it. */
  emitInterruption(kind: string) {
    if (kind === "began") {
      nativeSingleton.recording = false;
    }
    if (kind === "ended") {
      nativeSingleton.recording = true;
    }
    for (const listener of interruptionListeners) {
      listener({ data: kind });
    }
  },
};

vi.mock("@getrambla/expo-two-way-audio", () => ({
  addExpoTwoWayAudioEventListener: (name: string, listener: NativeEventListener) => {
    if (name === "onAudioInterruption") {
      interruptionListeners.add(listener);
      return { remove: () => interruptionListeners.delete(listener) };
    }
    if (name !== "onMicrophoneData") {
      return { remove: () => {} };
    }
    microphoneListeners.add(listener);
    return { remove: () => microphoneListeners.delete(listener) };
  },
  initialize: async () => {
    nativeSingleton.engineAlive = true;
    nativeSingleton.sessionActive = true;
    return true;
  },
  tearDown: () => {
    nativeSingleton.engineAlive = false;
    nativeSingleton.recording = false;
    nativeSingleton.sessionActive = false;
  },
  toggleRecording: (value: boolean) => {
    if (!nativeSingleton.engineAlive || nativeSingleton.refuseRecording) {
      return false;
    }
    nativeSingleton.recording = value;
    if (value) {
      nativeSingleton.sessionActive = true;
    }
    return value;
  },
  releaseAudioSession: () => {
    // The native guard: the singleton is the only layer that knows if anything still needs it.
    if (nativeSingleton.recording) {
      return;
    }
    nativeSingleton.sessionActive = false;
  },
  stopPlayback: () => {},
  resumePlayback: () => {},
  playPCMData: () => {},
  getMicrophonePermissionsAsync: async () => ({ granted: true }),
  requestMicrophonePermissionsAsync: async () => ({ granted: true }),
}));

const { createAudioEngine } = await import("@/voice/audio-engine.native");

function createEngine() {
  return createAudioEngine({
    onCaptureData: () => {},
    onVolumeLevel: () => {},
  });
}

describe("createAudioEngine (native)", () => {
  beforeEach(() => {
    nativeSingleton.engineAlive = false;
    nativeSingleton.recording = false;
    nativeSingleton.sessionActive = false;
    nativeSingleton.refuseRecording = false;
    microphoneListeners.clear();
    interruptionListeners.clear();
  });

  it("blames the audio engine, not Android audio focus, when capture fails", async () => {
    const errors: Error[] = [];
    const engine = createAudioEngine({
      onCaptureData: () => {},
      onVolumeLevel: () => {},
      onError: (error) => errors.push(error),
    });
    await engine.initialize();
    nativeSingleton.refuseRecording = true;

    await expect(engine.startCapture()).rejects.toThrow(
      "Microphone capture could not start because the audio engine is not available.",
    );
    expect(errors[0]?.message).not.toMatch(/android/i);
  });

  it("keeps a capture in flight alive when another wrapper is destroyed", async () => {
    const captured: Uint8Array[] = [];
    const dictation = createAudioEngine({
      onCaptureData: (pcm) => captured.push(pcm),
      onVolumeLevel: () => {},
    });
    const voice = createEngine();

    await dictation.initialize();
    await voice.initialize();
    await dictation.startCapture();

    // The voice provider unmounts mid-dictation. Nothing tells the composer, so a capture
    // killed here goes on drawing a waveform while every word spoken into it is lost.
    await voice.destroy();

    nativeSingleton.emitMicrophoneData(new Uint8Array([1, 2, 3, 4]));

    expect(nativeSingleton.recording).toBe(true);
    expect(captured).toHaveLength(1);
  });

  it("stops treating capture as live when the system interrupts", async () => {
    const captured: Uint8Array[] = [];
    const volumes: number[] = [];
    let interruptions = 0;
    const engine = createAudioEngine({
      onCaptureData: (pcm) => captured.push(pcm),
      onVolumeLevel: (level) => volumes.push(level),
      onInterruption: () => {
        interruptions += 1;
      },
    });
    await engine.initialize();
    await engine.startCapture();
    nativeSingleton.emitMicrophoneData(new Uint8Array([1, 2]));

    nativeSingleton.emitInterruption("began");
    nativeSingleton.emitMicrophoneData(new Uint8Array([3, 4]));

    expect(interruptions).toBe(1);
    expect(volumes).toContain(0);
    expect(captured).toHaveLength(1);
  });

  it("re-asserts capture when the interruption ends and the consumer still holds the claim", async () => {
    const captured: Uint8Array[] = [];
    const engine = createAudioEngine(
      {
        onCaptureData: (pcm) => captured.push(pcm),
        onVolumeLevel: () => {},
      },
      { hasCaptureClaim: () => true },
    );
    await engine.initialize();
    await engine.startCapture();

    nativeSingleton.emitInterruption("began");
    nativeSingleton.emitInterruption("ended");
    nativeSingleton.emitMicrophoneData(new Uint8Array([5, 6]));

    expect(captured).toHaveLength(1);
  });

  it("turns native recording off when the interruption ends and nobody holds the claim", async () => {
    const engine = createAudioEngine(
      {
        onCaptureData: () => {},
        onVolumeLevel: () => {},
      },
      { hasCaptureClaim: () => false },
    );
    await engine.initialize();
    await engine.startCapture();

    nativeSingleton.emitInterruption("began");
    nativeSingleton.emitInterruption("ended");

    expect(nativeSingleton.recording).toBe(false);
  });

  it("hands the audio session back when the capturing wrapper is destroyed", async () => {
    const engine = createEngine();
    await engine.initialize();
    await engine.startCapture();

    await engine.destroy();

    expect(nativeSingleton.sessionActive).toBe(false);
  });
});
