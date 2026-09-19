import { beforeEach, describe, expect, it, vi } from "vitest";

const microphoneListeners = new Set<(event: { data: Uint8Array }) => void>();

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
};

vi.mock("@getrambla/expo-two-way-audio", () => ({
  addExpoTwoWayAudioEventListener: (
    name: string,
    listener: (event: { data: Uint8Array }) => void,
  ) => {
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
  });

  it("starts capture after another wrapper tore down the shared native engine", async () => {
    const dictation = createEngine();
    const voice = createEngine();

    await dictation.initialize();
    await voice.initialize();

    // The voice provider unmounting calls tearDown() on the singleton both wrappers share.
    await voice.destroy();

    await expect(dictation.startCapture()).resolves.toBeUndefined();
    expect(nativeSingleton.recording).toBe(true);
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

  it("hands the audio session back when the capturing wrapper is destroyed", async () => {
    const engine = createEngine();
    await engine.initialize();
    await engine.startCapture();

    await engine.destroy();

    expect(nativeSingleton.sessionActive).toBe(false);
  });
});
