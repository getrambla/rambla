import { useCallback, useEffect, useRef } from "react";
import { Buffer } from "buffer";
import { useState } from "react";

import {
  useVoiceAudioEngineOptional,
  useVoiceCaptureClaimOptional,
} from "@/contexts/voice-context";
import type { AudioEngineCallbacks } from "@/voice/audio-engine-types";

import type {
  DictationAudioSource,
  DictationAudioSourceConfig,
} from "./use-dictation-audio-source.types";

export function useDictationAudioSource(config: DictationAudioSourceConfig): DictationAudioSource {
  const onPcmSegmentRef = useRef(config.onPcmSegment);
  const onErrorRef = useRef(config.onError);
  const onInterruptionRef = useRef(config.onInterruption);
  const [volume, setVolume] = useState(0);
  const engine = useVoiceAudioEngineOptional();
  const claim = useVoiceCaptureClaimOptional();
  const holdsClaimRef = useRef(false);

  // The object's identity is the claim token, so it has to outlive every render.
  const consumerRef = useRef<AudioEngineCallbacks>({
    onCaptureData: (pcm) => {
      onPcmSegmentRef.current(Buffer.from(pcm).toString("base64"));
    },
    onVolumeLevel: (level) => {
      setVolume(level);
    },
    onError: (error) => {
      onErrorRef.current?.(error);
    },
    onInterruption: () => {
      onInterruptionRef.current?.();
    },
  });

  useEffect(() => {
    onPcmSegmentRef.current = config.onPcmSegment;
    onErrorRef.current = config.onError;
    onInterruptionRef.current = config.onInterruption;
  }, [config.onPcmSegment, config.onError, config.onInterruption]);

  const start = useCallback(async () => {
    if (!engine || !claim) {
      throw new Error("The microphone is not available.");
    }
    if (!claim.claimCapture(consumerRef.current)) {
      throw new Error("Stop voice mode before starting dictation.");
    }
    holdsClaimRef.current = true;
    try {
      await engine.initialize();
      await engine.startCapture();
    } catch (error) {
      claim.releaseCapture(consumerRef.current);
      holdsClaimRef.current = false;
      throw error;
    }
  }, [engine, claim]);

  const stop = useCallback(async () => {
    if (holdsClaimRef.current) {
      await engine?.stopCapture();
      claim?.releaseCapture(consumerRef.current);
      holdsClaimRef.current = false;
    }
    setVolume(0);
  }, [engine, claim]);

  const stopRef = useRef(stop);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  useEffect(() => {
    return () => {
      void stopRef.current().catch(() => undefined);
    };
  }, []);

  return {
    start,
    stop,
    volume,
  };
}
