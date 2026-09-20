/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import type { SessionOutboundMessage } from "@getrambla/protocol/messages";
import { type DictationStreamSender } from "@/dictation/dictation-stream-sender";
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
  /** Words the daemon transcribed but could not place in the final text. */
  droppedTranscript: string | undefined = undefined;
  /** False makes the finish time out inside the daemon client, the way a wedged stream does. */
  answersFinish = true;
  cancels: string[] = [];
  finishes = 0;
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

  async finishDictationStream(
    dictationId: string,
    _finalSeq: number,
  ): Promise<{ dictationId: string; text: string; droppedTranscript?: string }> {
    this.finishes += 1;
    if (!this.answersFinish) {
      throw new Error("Timeout waiting for dictation finalization");
    }
    return {
      dictationId,
      text: this.finishText,
      ...(this.droppedTranscript ? { droppedTranscript: this.droppedTranscript } : {}),
    };
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

/** The partial the daemon reports mid-dictation, addressed to the open stream. */
function partialMessage(dictationId: string, text: string): SessionOutboundMessage {
  return {
    type: "dictation_stream_partial",
    payload: { dictationId, text },
  } as unknown as SessionOutboundMessage;
}

const asClient = (client: FakeDictationClient): UseDictationOptions["client"] =>
  client as unknown as UseDictationOptions["client"];

let consoleError: ReturnType<typeof vi.spyOn>;

/** Every console.error argument list flattened to one line, so a message can be searched for. */
const loggedLines = (): string[] =>
  (consoleError.mock.calls as unknown[][]).map((call) =>
    call.map((part) => String(part)).join(" "),
  );

/** The user sees one plain outcome message; the specific reason stays in the log only. */
function expectAbortAnnounced(
  onError: ReturnType<typeof vi.fn>,
  detail: string,
  options?: { userMessage?: string },
): void {
  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ message: options?.userMessage ?? "Dictation not sent." }),
  );
  expect(loggedLines().some((line) => line.includes(detail))).toBe(true);
}

describe("dictation loss", () => {
  beforeEach(() => {
    captured.sender = null;
    audio.emitPcmSegment = null;
    audio.source.start.mockClear();
    audio.source.stop.mockClear();
    audio.source.stop.mockImplementation(async () => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
    vi.useRealTimers();
  });

  it("reports a failure when the recording has no final sequence", async () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useDictation({ client: null, onTranscript, onError }));

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
    expectAbortAnnounced(onError, "no audio was captured");
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

    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expect(capturedSender()?.hasSegments()).toBe(true);
    expect(result.current.status).toBe("failed");
    expect(result.current.canRetryFailedDictation).toBe(true);
  });

  it("names the abort when a submit follows the cancel the user asked for", async () => {
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
    expect(result.current.status).toBe("idle");
    expectAbortAnnounced(onError, "cancel already in flight");
  });

  it("names the abort when a submit is already in flight", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    audio.source.stop.mockImplementation(() => stopped);

    const client = new FakeDictationClient();
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
      const first = result.current.confirmDictation();
      const second = result.current.confirmDictation();
      releaseStop();
      await first;
      await second;
    });

    expect(onTranscript).toHaveBeenCalledWith("hello", expect.anything());
    expectAbortAnnounced(onError, "submit already in flight");
  });

  it("names the abort when there is no recording to submit", async () => {
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() => useDictation({ client: null, onTranscript, onError }));

    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expectAbortAnnounced(onError, "no recording in progress");
  });

  it("names the abort when a newer attempt supersedes the submit", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    const client = new FakeDictationClient();
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

    audio.source.stop.mockImplementation(() => stopped);
    await act(async () => {
      const confirmed = result.current.confirmDictation();
      const cancelled = result.current.cancelDictation();
      releaseStop();
      await confirmed;
      await cancelled;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expectAbortAnnounced(onError, "superseded by cancel or restart");
  });

  it("says nothing when the hook unmounts mid-submit", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    audio.source.stop.mockImplementation(() => stopped);
    await act(async () => {
      const confirmed = result.current.confirmDictation();
      unmount();
      releaseStop();
      await confirmed;
    });

    // Navigating away is not an abort the user needs told about.
    expect(onError).not.toHaveBeenCalled();
    expect(loggedLines().some((line) => line.includes("superseded by cancel or restart"))).toBe(
      false,
    );
  });

  it("delivers the transcript when the hook unmounts mid-submit", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    audio.source.stop.mockImplementation(() => stopped);
    await act(async () => {
      const confirmed = result.current.confirmDictation();
      unmount();
      releaseStop();
      await confirmed;
    });

    // The words were already spoken and the daemon still answers, so unmounting the
    // overlay is no reason to throw the transcript away.
    expect(onTranscript).toHaveBeenCalledWith("hello", expect.anything());
    expect(onError).not.toHaveBeenCalled();
  });

  it("names the abort when a cancel supersedes a submit the hook is unmounting", async () => {
    let releaseStop = () => {};
    const stopped = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    audio.source.stop.mockImplementation(() => stopped);
    await act(async () => {
      const confirmed = result.current.confirmDictation();
      const cancelled = result.current.cancelDictation();
      unmount();
      releaseStop();
      await confirmed;
      await cancelled;
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expectAbortAnnounced(onError, "superseded by cancel or restart");
  });

  it("appends the words the daemon could not place into the delivered transcript", async () => {
    const client = new FakeDictationClient();
    client.droppedTranscript = "about the kittens";
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

    // The lost words ride along with the delivered text instead of being announced as a loss.
    expect(onTranscript).toHaveBeenCalledWith("hello about the kittens", expect.anything());
    expect(onError).not.toHaveBeenCalled();
  });

  it("delivers the transcript when the hook unmounts mid-retry", async () => {
    let releaseFinish = () => {};
    const finished = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });

    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result, unmount } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.startDictation();
    });
    await act(async () => {
      audio.emitPcmSegment?.("AAAAAAAA");
    });

    client.answersFinish = false;
    await act(async () => {
      await result.current.confirmDictation();
    });
    onError.mockClear();
    consoleError.mockClear();

    client.answersFinish = true;
    const slowFinish = client.finishDictationStream.bind(client);
    client.finishDictationStream = async (dictationId: string, finalSeq: number) => {
      await finished;
      return await slowFinish(dictationId, finalSeq);
    };

    await act(async () => {
      const retried = result.current.retryFailedDictation();
      unmount();
      releaseFinish();
      await retried;
    });

    // Navigating away mid-retry must not throw away the words the daemon already has.
    expect(onTranscript).toHaveBeenCalledWith("hello", expect.anything());
    expect(onError).not.toHaveBeenCalled();
  });

  it("names the abort when a retry is already in flight", async () => {
    let releaseFinish = () => {};
    const finished = new Promise<void>((resolve) => {
      releaseFinish = resolve;
    });

    const client = new FakeDictationClient();
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

    client.answersFinish = false;
    await act(async () => {
      await result.current.confirmDictation();
    });
    onError.mockClear();
    consoleError.mockClear();

    client.answersFinish = true;
    const slowFinish = client.finishDictationStream.bind(client);
    client.finishDictationStream = async (dictationId: string, finalSeq: number) => {
      await finished;
      return await slowFinish(dictationId, finalSeq);
    };

    await act(async () => {
      const first = result.current.retryFailedDictation();
      const second = result.current.retryFailedDictation();
      releaseFinish();
      await first;
      await second;
    });

    // The second tap must not race the first into a failure toast for a delivered transcript.
    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(client.finishes).toBe(2);
    expectAbortAnnounced(onError, "retry already in flight", {
      userMessage: "There is no recording to resend.",
    });
  });

  it("names the abort when a retry has no recording held", async () => {
    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript, onError }),
    );

    await act(async () => {
      await result.current.retryFailedDictation();
    });

    expectAbortAnnounced(onError, "no buffered audio to resend", {
      userMessage: "There is no recording to resend.",
    });
  });

  it("names the abort when a newer attempt supersedes the retry", async () => {
    const client = new FakeDictationClient();
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

    client.finishDictationStream = async () => {
      const cancelled = new Error("Attempt cancelled");
      cancelled.name = "AttemptCancelledError";
      throw cancelled;
    };

    await act(async () => {
      await result.current.confirmDictation();
    });
    onError.mockClear();
    consoleError.mockClear();

    await act(async () => {
      await result.current.retryFailedDictation();
    });

    expect(onTranscript).not.toHaveBeenCalled();
    expectAbortAnnounced(onError, "superseded by cancel or restart", {
      userMessage: "There is no recording to resend.",
    });
  });
});
