/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionOutboundMessage } from "@getrambla/protocol/messages";
import type { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { i18n } from "@/i18n/i18next";
import {
  DICTATION_FINISH_ACCEPT_TIMEOUT_MS,
  DICTATION_FINISH_TIMEOUT_GRACE_MS,
  useDictation,
  type UseDictationOptions,
} from "./use-dictation";

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
  /** False makes the daemon take the finish and never reply, the way a wedged stream does. */
  answersFinish = true;
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
    if (!this.answersFinish) {
      return new Promise<never>(() => {});
    }
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

  on(type: string, handler: (message: SessionOutboundMessage) => void): () => void {
    const listeners = this.typedListeners.get(type) ?? new Set();
    listeners.add(handler);
    this.typedListeners.set(type, listeners);
    return () => listeners.delete(handler);
  }

  /** Delivers a daemon message to whatever the hook subscribed to by type. */
  emit(message: SessionOutboundMessage): void {
    for (const listener of this.typedListeners.get(message.type) ?? []) {
      listener(message);
    }
  }

  private readonly typedListeners = new Map<
    string,
    Set<(message: SessionOutboundMessage) => void>
  >();
}

/** The daemon taking the finish and naming how long it will take to answer it. */
function finishAcceptedMessage(dictationId: string, timeoutMs: number): SessionOutboundMessage {
  return {
    type: "dictation_stream_finish_accepted",
    payload: { dictationId, timeoutMs },
  } as unknown as SessionOutboundMessage;
}

/** The partial the daemon reports mid-dictation, addressed to the open stream. */
function partialMessage(dictationId: string, text: string): SessionOutboundMessage {
  return {
    type: "dictation_stream_partial",
    payload: { dictationId, text },
  } as unknown as SessionOutboundMessage;
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("keeps the recording when the final drops an ending the daemon already reported", async () => {
    const client = new FakeDictationClient();
    client.finishText = "one two three four five";
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: asClient(client), onTranscript }));

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });
    act(() => {
      client.emit(
        partialMessage(capturedSender()!.getDictationId()!, "one two three four five six seven"),
      );
    });
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(capturedSender()?.hasSegments()).toBe(true);
    expect(result.current.status).toBe("failed");
    expect(result.current.canRetryFailedDictation).toBe(true);
  });

  it("accepts a final that rewords the partial rather than cutting it short", async () => {
    const client = new FakeDictationClient();
    client.finishText = "One, two, three.";
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: asClient(client), onTranscript }));

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });
    act(() => {
      client.emit(partialMessage(capturedSender()!.getDictationId()!, "one two three"));
    });
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).toHaveBeenCalledWith("One, two, three.", expect.anything());
    expect(result.current.status).toBe("idle");
  });

  it("reports a failure when the daemon never answers the finish", async () => {
    const client = new FakeDictationClient();
    client.answersFinish = false;
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: asClient(client), onTranscript }));

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    vi.useFakeTimers();
    await act(async () => {
      const confirmed = result.current.confirmDictation();
      await vi.advanceTimersByTimeAsync(DICTATION_FINISH_ACCEPT_TIMEOUT_MS + 1);
      await confirmed;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(capturedSender()?.hasSegments()).toBe(true);
    expect(result.current.status).toBe("failed");
    expect(result.current.canRetryFailedDictation).toBe(true);
  });

  it("waits out the deadline the daemon states when it takes the finish", async () => {
    const daemonTimeoutMs = 60_000;
    const client = new FakeDictationClient();
    client.answersFinish = false;
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: asClient(client), onTranscript }));

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    vi.useFakeTimers();
    let confirmed!: Promise<void>;
    await act(async () => {
      confirmed = result.current.confirmDictation();
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => {
      client.emit(finishAcceptedMessage(capturedSender()!.getDictationId()!, daemonTimeoutMs));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(DICTATION_FINISH_ACCEPT_TIMEOUT_MS + 1);
    });
    expect(result.current.status).toBe("uploading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(daemonTimeoutMs + DICTATION_FINISH_TIMEOUT_GRACE_MS);
      await confirmed;
    });
    expect(result.current.status).toBe("failed");
    expect(result.current.canRetryFailedDictation).toBe(true);
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
