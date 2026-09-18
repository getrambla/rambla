/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionOutboundMessage } from "@getrambla/protocol/messages";
import type { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { i18n } from "@/i18n/i18next";
import { useDictation, type UseDictationOptions } from "./use-dictation";

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

/** Minimal connected daemon stand-in: acks every chunk and answers finish with a fixed text. */
class FakeDictationClient {
  isConnected = true;
  finishText = "hello";
  cancels: string[] = [];
  private readonly rawListeners = new Set<(message: SessionOutboundMessage) => void>();

  async startDictationStream(): Promise<void> {}

  sendDictationStreamChunk(dictationId: string, seq: number): void {
    const ack = {
      type: "dictation_stream_ack",
      payload: { dictationId, ackSeq: seq },
    } as unknown as SessionOutboundMessage;
    for (const listener of this.rawListeners) {
      listener(ack);
    }
  }

  async finishDictationStream(dictationId: string): Promise<{ dictationId: string; text: string }> {
    return { dictationId, text: this.finishText };
  }

  cancelDictationStream(dictationId: string): void {
    this.cancels.push(dictationId);
  }

  subscribeRawMessages(handler: (message: SessionOutboundMessage) => void): () => void {
    this.rawListeners.add(handler);
    return () => this.rawListeners.delete(handler);
  }

  subscribeConnectionStatus(): () => void {
    return () => {};
  }

  on(): () => void {
    return () => {};
  }
}

const asClient = (client: FakeDictationClient): UseDictationOptions["client"] =>
  client as unknown as UseDictationOptions["client"];

describe("dictation loss", () => {
  beforeEach(() => {
    captured.sender = null;
    audio.emitPcmSegment = null;
    audio.source.start.mockClear();
    audio.source.stop.mockClear();
    audio.source.stop.mockImplementation(async () => {});
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
    // Nothing was captured, so there is nothing a retry could send.
    expect(result.current.canRetryFailedDictation).toBe(false);
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
    expect(result.current.error).toBe(i18n.t("common.errors.daemonClientDisconnected"));
    // The microphone must not keep running once the submit has been refused.
    expect(audio.source.stop).toHaveBeenCalledTimes(1);
    expect(result.current.canRetryFailedDictation).toBe(true);
  });

  it("keeps the recording when the daemon answers the finish with an empty transcript", async () => {
    const client = new FakeDictationClient();
    client.finishText = "";
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(capturedSender()?.hasSegments()).toBe(true);
    expect(result.current.status).toBe("failed");
    expect(result.current.canRetryFailedDictation).toBe(true);
    expect(onError).toHaveBeenCalled();
  });

  it("cancels quietly when a submit follows the cancel the user asked for", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    audio.source.stop.mockImplementation(() => stopped);

    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useDictation({ client: null, onTranscript, onError }));

    await act(async () => {
      await result.current.startDictation();
    });
    audio.emitPcmSegment?.("AAAAAAAA");

    await act(async () => {
      const cancelled = result.current.cancelDictation();
      const confirmed = result.current.confirmDictation();
      releaseStop();
      await cancelled;
      await confirmed;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    // The user asked for the cancel, so it is not an error and not a failure.
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe("idle");
  });
});
