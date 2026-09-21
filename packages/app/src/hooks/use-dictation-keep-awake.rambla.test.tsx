/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionOutboundMessage } from "@getrambla/protocol/messages";
import { type DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { useDictation, type UseDictationOptions, type UseDictationResult } from "./use-dictation";

const keepAwake = vi.hoisted(() => ({
  activate: vi.fn(async () => {}),
  deactivate: vi.fn(async () => {}),
}));

vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: keepAwake.activate,
  deactivateKeepAwake: keepAwake.deactivate,
}));

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
  /** False makes the finish time out inside the daemon client, the way a wedged stream does. */
  answersFinish = true;
  private readonly rawListeners = new Set<(message: SessionOutboundMessage) => void>();
  private readonly typedListeners = new Map<
    string,
    Set<(message: SessionOutboundMessage) => void>
  >();

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
  ): Promise<{ dictationId: string; text: string }> {
    if (!this.answersFinish) {
      throw new Error("Timeout waiting for dictation finalization");
    }
    return { dictationId, text: this.finishText };
  }

  cancelDictationStream(_dictationId: string): void {}

  subscribeRawMessages(handler: (message: SessionOutboundMessage) => void): () => void {
    this.rawListeners.add(handler);
    return () => this.rawListeners.delete(handler);
  }

  subscribeConnectionStatus(_handler: (next: { status: string }) => void): () => void {
    return () => {};
  }

  on(_type: string, _handler: (message: SessionOutboundMessage) => void): () => void {
    return () => {};
  }
}

const asClient = (client: FakeDictationClient): UseDictationOptions["client"] =>
  client as unknown as UseDictationOptions["client"];

/** Starts a recording and feeds it one segment, the way a speaking user does. */
async function startRecording(result: { current: UseDictationResult }): Promise<void> {
  await act(async () => {
    await result.current.startDictation();
  });
  await act(async () => {
    audio.emitPcmSegment?.("AAAAAAAA");
  });
}

describe("dictation wake lock", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    captured.sender = null;
    audio.emitPcmSegment = null;
    audio.source.start.mockClear();
    audio.source.stop.mockClear();
    audio.source.start.mockImplementation(async () => {});
    audio.source.stop.mockImplementation(async () => {});
    keepAwake.activate.mockClear();
    keepAwake.deactivate.mockClear();
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("holds the wake lock while recording and releases it on a successful submit", async () => {
    const client = new FakeDictationClient();
    const onTranscript = vi.fn();
    const { result } = renderHook(() => useDictation({ client: asClient(client), onTranscript }));

    await startRecording(result);

    expect(result.current.isRecording).toBe(true);
    expect(keepAwake.activate).toHaveBeenCalledTimes(1);
    expect(keepAwake.activate).toHaveBeenCalledWith("rambla:dictation");
    expect(keepAwake.deactivate).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(onTranscript).toHaveBeenCalledWith("hello", expect.anything());
    expect(keepAwake.deactivate).toHaveBeenCalledTimes(1);
    expect(keepAwake.deactivate).toHaveBeenCalledWith("rambla:dictation");
    expect(keepAwake.deactivate.mock.invocationCallOrder[0]).toBeGreaterThan(
      keepAwake.activate.mock.invocationCallOrder[0],
    );
  });

  it("releases the wake lock on cancel", async () => {
    const client = new FakeDictationClient();
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript: vi.fn() }),
    );

    await startRecording(result);
    await act(async () => {
      await result.current.cancelDictation();
    });

    expect(result.current.isRecording).toBe(false);
    expect(keepAwake.deactivate).toHaveBeenCalledWith("rambla:dictation");
  });

  it("releases the wake lock when the daemon fails the submit", async () => {
    const client = new FakeDictationClient();
    client.answersFinish = false;
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript: vi.fn() }),
    );

    await startRecording(result);
    await act(async () => {
      await result.current.confirmDictation();
    });

    expect(result.current.status).toBe("failed");
    expect(keepAwake.deactivate).toHaveBeenCalledWith("rambla:dictation");
  });

  it("releases the wake lock when the component unmounts mid-recording", async () => {
    const client = new FakeDictationClient();
    const { result, unmount } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript: vi.fn() }),
    );

    await startRecording(result);
    expect(keepAwake.deactivate).not.toHaveBeenCalled();

    unmount();

    expect(keepAwake.deactivate).toHaveBeenCalledWith("rambla:dictation");
  });

  it("releases the wake lock when the recording fails to start", async () => {
    const client = new FakeDictationClient();
    audio.source.start.mockRejectedValueOnce(new Error("mic busy"));
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript: vi.fn() }),
    );

    await act(async () => {
      await result.current.startDictation();
    });

    expect(result.current.isRecording).toBe(false);
    expect(keepAwake.activate).toHaveBeenCalledTimes(1);
    expect(keepAwake.deactivate).toHaveBeenCalledWith("rambla:dictation");
  });

  it("keeps dictation working when the wake lock itself fails", async () => {
    const client = new FakeDictationClient();
    keepAwake.activate.mockRejectedValueOnce(new Error("not supported"));
    const { result } = renderHook(() =>
      useDictation({ client: asClient(client), onTranscript: vi.fn() }),
    );

    await startRecording(result);

    expect(result.current.isRecording).toBe(true);
    expect(capturedSender()?.hasSegments()).toBe(true);
  });
});
