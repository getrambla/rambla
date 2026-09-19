/** @vitest-environment jsdom */
import React, { type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEngineCallbacks } from "@/voice/audio-engine-types";
import type { VoiceRuntime } from "@/voice/voice-runtime";
import { VoiceProvider, useVoiceCaptureClaimOptional } from "@/contexts/voice-context";
import { useDictationAudioSource } from "@/hooks/use-dictation-audio-source.native";

const engineMock = vi.hoisted(() => ({
  callbacks: null as AudioEngineCallbacks | null,
  initialize: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
  startCapture: vi.fn(async () => {}),
  stopCapture: vi.fn(async () => {}),
  toggleMute: vi.fn(() => false),
  isMuted: vi.fn(() => false),
  play: vi.fn(async () => 0),
  stop: vi.fn(() => {}),
  clearQueue: vi.fn(() => {}),
  isPlaying: vi.fn(() => false),
}));

const runtimeMock = vi.hoisted(() => ({
  handleCapturePcm: vi.fn(() => {}),
  handleCaptureVolume: vi.fn(() => {}),
  stopVoice: vi.fn(async () => {}),
  destroy: vi.fn(async () => {}),
}));

// The repo's tsconfig picks the classic JSX transform, so rendered modules need a global React.
vi.stubGlobal("React", React);

vi.mock("@/voice/audio-engine", () => ({
  createAudioEngine: (callbacks: AudioEngineCallbacks) => {
    engineMock.callbacks = callbacks;
    return engineMock;
  },
}));

vi.mock("@/voice/voice-runtime", () => ({
  createVoiceRuntime: () => runtimeMock as unknown as VoiceRuntime,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <VoiceProvider>{children}</VoiceProvider>
);

function createConsumer(): AudioEngineCallbacks & { pcm: Uint8Array[] } {
  const pcm: Uint8Array[] = [];
  return {
    pcm,
    onCaptureData: (chunk) => {
      pcm.push(chunk);
    },
    onVolumeLevel: () => {},
  };
}

describe("voice capture claim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engineMock.callbacks = null;
  });

  it("refuses a second claim while one consumer holds the microphone", () => {
    const { result } = renderHook(() => useVoiceCaptureClaimOptional(), { wrapper });
    const claim = result.current!;

    expect(claim.claimCapture(createConsumer())).toBe(true);
    expect(claim.claimCapture(createConsumer())).toBe(false);
  });

  it("lets the next consumer claim after the holder releases", () => {
    const { result } = renderHook(() => useVoiceCaptureClaimOptional(), { wrapper });
    const claim = result.current!;
    const first = createConsumer();

    claim.claimCapture(first);
    claim.releaseCapture(first);

    expect(claim.claimCapture(createConsumer())).toBe(true);
  });

  it("ignores a release from a consumer that no longer holds the claim", () => {
    const { result } = renderHook(() => useVoiceCaptureClaimOptional(), { wrapper });
    const claim = result.current!;
    const first = createConsumer();
    const second = createConsumer();

    claim.claimCapture(first);
    claim.releaseCapture(first);
    claim.claimCapture(second);
    claim.releaseCapture(first);

    expect(claim.claimCapture(first)).toBe(false);
  });

  it("routes capture data to the claiming consumer", () => {
    const { result } = renderHook(() => useVoiceCaptureClaimOptional(), { wrapper });
    const consumer = createConsumer();

    result.current!.claimCapture(consumer);
    engineMock.callbacks?.onCaptureData(new Uint8Array([1, 2, 3]));

    expect(consumer.pcm).toHaveLength(1);
    expect(runtimeMock.handleCapturePcm).not.toHaveBeenCalled();
  });

  it("leaves the shared engine alive when the dictation hook unmounts", async () => {
    const { result, unmount } = renderHook(
      () => useDictationAudioSource({ onPcmSegment: () => {} }),
      { wrapper },
    );

    await act(async () => {
      await result.current.start();
    });
    unmount();

    expect(engineMock.destroy).not.toHaveBeenCalled();
    expect(engineMock.stopCapture).toHaveBeenCalledTimes(1);
  });

  it("a dictation stop after losing the claim does not stop the other consumer's capture", async () => {
    const { result } = renderHook(
      () => ({
        claim: useVoiceCaptureClaimOptional(),
        dictation: useDictationAudioSource({ onPcmSegment: () => {} }),
      }),
      { wrapper },
    );

    await act(async () => {
      await result.current.dictation.start();
    });
    await act(async () => {
      await result.current.dictation.stop();
    });
    expect(engineMock.stopCapture).toHaveBeenCalledTimes(1);

    expect(result.current.claim!.claimCapture(createConsumer())).toBe(true);
    await act(async () => {
      await result.current.dictation.stop();
    });

    expect(engineMock.stopCapture).toHaveBeenCalledTimes(1);
  });
});
