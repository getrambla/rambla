import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "@/hooks/use-dictation-audio-source.types";

import { createAudioCapture, type AudioCapture } from "./capture.web";

/** One second of 16 kHz audio per segment, which is what the daemon transcribes against. */
const DICTATION_SEGMENT_FRAMES = 16_000;
const VOLUME_INTERVAL_MS = 100;

/** Base64 of the raw little-endian PCM bytes, which is what the dictation stream carries. */
export function pcm16ToBase64(pcm: Int16Array): string {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

/** Lets one value through per interval, so the composer does not re-render per worklet message. */
export function createVolumeThrottle(intervalMs: number, now: () => number): () => boolean {
  let last: number | null = null;
  return () => {
    const current = now();
    if (last !== null && current - last < intervalMs) {
      return false;
    }
    last = current;
    return true;
  };
}

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const [volume, setVolume] = useState(0);

  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const onInterruptionRef = useRef(config.onInterruption);

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
    onInterruptionRef.current = config.onInterruption;
  }, [config.onPcmSegment, config.onError, config.onInterruption]);

  const captureRef = useRef<AudioCapture | null>(null);
  if (!captureRef.current) {
    const allowVolume = createVolumeThrottle(VOLUME_INTERVAL_MS, () => Date.now());
    captureRef.current = createAudioCapture({
      segmentFrames: DICTATION_SEGMENT_FRAMES,
      onSegment: (segment) => onPcmSegmentRef.current(pcm16ToBase64(segment.pcm)),
      onVolume: (rms) => {
        if (allowVolume()) {
          setVolume(Math.min(1, Math.max(0, rms * 2)));
        }
      },
      onError: (error) => onErrorRef.current?.(error),
      onInterruption: () => onInterruptionRef.current?.(),
    });
  }

  const start = useCallback(async () => {
    try {
      await captureRef.current?.start();
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      onErrorRef.current?.(normalized);
      throw normalized;
    }
  }, []);

  const stop = useCallback(async () => {
    await captureRef.current?.stop();
    setVolume(0);
  }, []);

  useEffect(() => {
    return () => {
      void captureRef.current?.stop().catch(() => undefined);
    };
  }, []);

  return useMemo(() => ({ start, stop, volume }), [start, stop, volume]);
}
