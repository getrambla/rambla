/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { useDictation } from "./use-dictation";

const audio = vi.hoisted(() => {
  const source = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    volume: 0,
  };
  return { source, emitPcmSegment: null as ((pcm16Base64: string) => void) | null };
});

vi.mock("@/hooks/use-dictation-audio-source", () => ({
  useDictationAudioSource: (config: { onPcmSegment: (pcm16Base64: string) => void }) => {
    audio.emitPcmSegment = config.onPcmSegment;
    return audio.source;
  },
}));

const captured = vi.hoisted(() => ({ sender: null as unknown }));

// The hook builds its own sender, so subclass the real one to get a handle on it.
vi.mock("@/dictation/dictation-stream-sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/dictation/dictation-stream-sender")>();
  return {
    ...actual,
    DictationStreamSender: class extends actual.DictationStreamSender {
      constructor(params: ConstructorParameters<typeof actual.DictationStreamSender>[0]) {
        super(params);
        captured.sender = this;
      }
    },
  };
});

const capturedSender = (): DictationStreamSender | null =>
  captured.sender as DictationStreamSender | null;

describe("dictation loss", () => {
  beforeEach(() => {
    captured.sender = null;
    audio.emitPcmSegment = null;
    audio.source.start.mockClear();
    audio.source.stop.mockClear();
  });

  it("reports a failure when the recording has no final sequence", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: null, onTranscript }));

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(result.current.status).toBe("failed");
  });

  it("reports a failure when confirming is not allowed", async () => {
    const onTranscript = vi.fn();
    const { result } = renderHook(() =>
      useDictation({ client: null, onTranscript, canConfirm: () => false }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    audio.emitPcmSegment?.("AAAAAAAA");
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(capturedSender()?.hasSegments()).toBe(true);
    expect(result.current.status).toBe("failed");
  });
});
