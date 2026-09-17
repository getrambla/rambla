/**
 * Microphone capture for the web, running its per-sample work on the audio
 * thread. Dictation and voice chat share it: `segmentFrames` is a number rather
 * than a mode, mute is a command only a consumer that needs it sends, and
 * nothing here knows about base64 or React.
 */

// `node.port` is a MessagePort, not a Window: its second argument is a transfer
// list, and assigning `onmessage` is how a worklet port starts delivering.
// oxlint-disable unicorn/require-post-message-target-origin, unicorn/prefer-add-event-listener

/** Served from `packages/app/public/`, which dev, export and Electron all expose at the site root. */
export const PROCESSOR_URL = "/rambla-audio-capture-processor.js";
const PROCESSOR_NAME = "rambla-audio-capture";
const OUTPUT_SAMPLE_RATE = 16_000;
const VOLUME_EVERY_QUANTA = 16;
const FLUSH_TIMEOUT_MS = 500;

export interface CaptureSegment {
  pcm: Int16Array;
  firstFrameIndex: number;
}

export type WorkletMessage =
  | { type: "segment"; pcm: ArrayBuffer; frames: number; firstFrameIndex: number }
  | { type: "volume"; rms: number }
  | { type: "flushed"; finalFrameIndex: number; final: boolean };

export type CaptureCommand = { type: "mute"; muted: boolean } | { type: "flush"; final: boolean };

export interface CaptureSession {
  post: (command: CaptureCommand) => void;
  close: () => Promise<void>;
}

export interface CaptureOpenRequest {
  processorUrl: string;
  processorOptions: {
    outputSampleRate: number;
    segmentFrames: number;
    volumeEveryQuanta: number;
  };
  onMessage: (message: WorkletMessage) => void;
  onInterruption: () => void;
}

/** The browser half, swapped for a fake in unit tests. */
export interface CaptureBackend {
  open: (request: CaptureOpenRequest) => Promise<CaptureSession>;
}

export interface AudioCaptureOptions {
  segmentFrames: number;
  onSegment: (segment: CaptureSegment) => void;
  onVolume?: (rms: number) => void;
  onError?: (error: Error) => void;
  onInterruption?: () => void;
  backend?: CaptureBackend;
  flushTimeoutMs?: number;
}

export interface AudioCapture {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  setMuted: (muted: boolean) => void;
}

export const webCaptureBackend: CaptureBackend = {
  open: async ({ processorUrl, processorOptions, onMessage, onInterruption }) => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
      },
    });
    const context = new AudioContext();
    let closing = false;

    const stopStream = () => {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    };

    try {
      await context.audioWorklet.addModule(processorUrl);
      const node = new AudioWorkletNode(context, PROCESSOR_NAME, { processorOptions });
      node.port.onmessage = (event: MessageEvent<WorkletMessage>) => onMessage(event.data);

      const source = context.createMediaStreamSource(stream);
      // Web Audio only renders what reaches the destination, so the silenced
      // gain node is what keeps the capture node running.
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(node);
      node.connect(gain);
      gain.connect(context.destination);

      const interrupt = () => {
        if (!closing) {
          onInterruption();
        }
      };
      for (const track of stream.getAudioTracks()) {
        track.addEventListener("ended", interrupt);
        track.addEventListener("mute", interrupt);
      }
      context.addEventListener("statechange", () => {
        if (context.state !== "running") {
          interrupt();
        }
      });

      return {
        post: (command) => node.port.postMessage(command),
        close: async () => {
          closing = true;
          node.port.onmessage = null;
          source.disconnect();
          node.disconnect();
          gain.disconnect();
          stopStream();
          await context.close();
        },
      };
    } catch (error) {
      stopStream();
      await context.close().catch(() => undefined);
      throw error;
    }
  },
};

export function createAudioCapture(options: AudioCaptureOptions): AudioCapture {
  const backend = options.backend ?? webCaptureBackend;
  const flushTimeoutMs = options.flushTimeoutMs ?? FLUSH_TIMEOUT_MS;

  let session: CaptureSession | null = null;
  let deliveredFrameIndex: number | null = null;
  let everMuted = false;
  let interrupted = false;
  let resolveFlushed: ((finalFrameIndex: number) => void) | null = null;

  const report = (message: string) => options.onError?.(new Error(message));

  const handleMessage = (message: WorkletMessage) => {
    if (message.type === "volume") {
      options.onVolume?.(message.rms);
      return;
    }
    if (message.type === "flushed") {
      resolveFlushed?.(message.finalFrameIndex);
      resolveFlushed = null;
      return;
    }
    if (deliveredFrameIndex !== null && message.firstFrameIndex !== deliveredFrameIndex) {
      report(
        `Microphone capture skipped ${message.firstFrameIndex - deliveredFrameIndex} frames of audio: the audio thread missed renders.`,
      );
    }
    deliveredFrameIndex = message.firstFrameIndex + message.frames;
    options.onSegment({
      pcm: new Int16Array(message.pcm),
      firstFrameIndex: message.firstFrameIndex,
    });
  };

  const handleInterruption = () => {
    const active = session;
    if (interrupted || !active) {
      return;
    }
    interrupted = true;
    session = null;
    options.onInterruption?.();
    // The microphone or the context is already gone, so a flush would only time out.
    void active.close().catch(() => undefined);
  };

  const waitForFlush = async (): Promise<number | null> => {
    const flushed = new Promise<number>((resolve) => {
      resolveFlushed = resolve;
    });
    const timedOut = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), flushTimeoutMs);
    });
    const result = await Promise.race([flushed, timedOut]);
    resolveFlushed = null;
    return result;
  };

  const reportShortfall = (finalFrameIndex: number | null) => {
    if (finalFrameIndex === null) {
      report(
        `Microphone capture did not confirm its final flush within ${flushTimeoutMs} ms, so the end of the recording may be missing.`,
      );
      return;
    }
    // A consumer that muted asked for the gap, so it is not a shortfall.
    const missing = finalFrameIndex - (deliveredFrameIndex ?? 0);
    if (!everMuted && missing > 0) {
      report(`Microphone capture ended ${missing} frames short of what the audio clock reported.`);
    }
  };

  return {
    start: async () => {
      if (session) {
        return;
      }
      deliveredFrameIndex = null;
      everMuted = false;
      interrupted = false;
      try {
        session = await backend.open({
          processorUrl: PROCESSOR_URL,
          processorOptions: {
            outputSampleRate: OUTPUT_SAMPLE_RATE,
            segmentFrames: options.segmentFrames,
            volumeEveryQuanta: VOLUME_EVERY_QUANTA,
          },
          onMessage: handleMessage,
          onInterruption: handleInterruption,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Could not start microphone capture from ${PROCESSOR_URL}: ${detail}`, {
          cause: error,
        });
      }
    },

    stop: async () => {
      const active = session;
      if (!active) {
        return;
      }
      session = null;
      const flushed = waitForFlush();
      active.post({ type: "flush", final: true });
      reportShortfall(await flushed);
      await active.close();
    },

    setMuted: (muted) => {
      everMuted = everMuted || muted;
      session?.post({ type: "mute", muted });
    },
  };
}
