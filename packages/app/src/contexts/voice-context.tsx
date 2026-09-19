import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSessionStore } from "@/stores/session-store";
import { createAudioEngine } from "@/voice/audio-engine";
import type { AudioEngine, AudioEngineCallbacks } from "@/voice/audio-engine-types";
import {
  createVoiceRuntime,
  type VoiceRuntime,
  type VoiceRuntimeSnapshot,
  type VoiceRuntimeTelemetrySnapshot,
} from "@/voice/voice-runtime";

interface VoiceContextValue extends VoiceRuntimeSnapshot {
  startVoice: (serverId: string, agentId: string) => Promise<void>;
  stopVoice: () => Promise<void>;
  isVoiceModeForAgent: (serverId: string, agentId: string) => boolean;
  toggleMute: () => void;
}

const EMPTY_SNAPSHOT: VoiceRuntimeSnapshot = {
  phase: "disabled",
  isVoiceMode: false,
  isVoiceSwitching: false,
  isMuted: false,
  activeServerId: null,
  activeAgentId: null,
};

const EMPTY_TELEMETRY: VoiceRuntimeTelemetrySnapshot = {
  volume: 0,
  isSpeaking: false,
  segmentDuration: 0,
};

export interface VoiceCaptureClaim {
  claimCapture(consumer: AudioEngineCallbacks): boolean;
  releaseCapture(consumer: AudioEngineCallbacks): void;
}

const VoiceRuntimeContext = createContext<VoiceRuntime | null>(null);
const VoiceAudioEngineContext = createContext<AudioEngine | null>(null);
const VoiceCaptureClaimContext = createContext<VoiceCaptureClaim | null>(null);

const noopSubscribe = () => () => {};
const getEmptySnapshot = () => EMPTY_SNAPSHOT;
const getEmptyTelemetry = () => EMPTY_TELEMETRY;

export function useVoice() {
  const value = useVoiceOptional();
  if (!value) {
    throw new Error("useVoice must be used within VoiceProvider");
  }
  return value;
}

export function useVoiceOptional(): VoiceContextValue | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribe : noopSubscribe,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
    runtime ? runtime.getSnapshot : getEmptySnapshot,
  );

  // Methods on the runtime object literal close over factory-local state; they
  // don't use `this`, so no binding is needed. Memoising on [snapshot, runtime]
  // keeps the returned object reference stable across re-renders that don't
  // change either, preventing downstream memo/useMemo misses.
  return useMemo(() => {
    if (!runtime) {
      return null;
    }
    return {
      ...snapshot,
      startVoice: runtime.startVoice,
      stopVoice: runtime.stopVoice,
      isVoiceModeForAgent: runtime.isVoiceModeForAgent,
      toggleMute: runtime.toggleMute,
    };
  }, [snapshot, runtime]);
}

export function useVoiceTelemetry() {
  const telemetry = useVoiceTelemetryOptional();
  if (!telemetry) {
    throw new Error("useVoiceTelemetry must be used within VoiceProvider");
  }
  return telemetry;
}

export function useVoiceTelemetryOptional(): VoiceRuntimeTelemetrySnapshot | null {
  const runtime = useContext(VoiceRuntimeContext);
  const snapshot = useSyncExternalStore(
    runtime ? runtime.subscribeTelemetry.bind(runtime) : noopSubscribe,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
    runtime ? runtime.getTelemetrySnapshot.bind(runtime) : getEmptyTelemetry,
  );

  return runtime ? snapshot : null;
}

export function useVoiceRuntimeOptional(): VoiceRuntime | null {
  return useContext(VoiceRuntimeContext);
}

export function useVoiceAudioEngineOptional(): AudioEngine | null {
  return useContext(VoiceAudioEngineContext);
}

export function useVoiceCaptureClaimOptional(): VoiceCaptureClaim | null {
  return useContext(VoiceCaptureClaimContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const engineRef = useRef<AudioEngine | null>(null);
  const runtimeRef = useRef<VoiceRuntime | null>(null);
  const claimRef = useRef<VoiceCaptureClaim | null>(null);
  const captureConsumerRef = useRef<AudioEngineCallbacks | null>(null);

  if (!engineRef.current) {
    let runtime: VoiceRuntime | null = null;
    const runtimeConsumer: AudioEngineCallbacks = {
      onCaptureData: (pcm) => {
        runtime?.handleCapturePcm(pcm);
      },
      onVolumeLevel: (level) => {
        runtime?.handleCaptureVolume(level);
      },
      onInterruption: () => {
        void runtime?.stopVoice().catch((error) => {
          console.error("[VoiceEngine] Failed to stop after audio interruption:", error);
        });
      },
      onError: (error) => {
        console.error("[VoiceEngine] Capture error:", error);
      },
    };

    const claim: VoiceCaptureClaim = {
      claimCapture(consumer) {
        if (captureConsumerRef.current && captureConsumerRef.current !== consumer) {
          return false;
        }
        captureConsumerRef.current = consumer;
        return true;
      },
      releaseCapture(consumer) {
        if (captureConsumerRef.current === consumer) {
          captureConsumerRef.current = null;
        }
      },
    };

    const engine = createAudioEngine(
      {
        onCaptureData: (pcm) => {
          (captureConsumerRef.current ?? runtimeConsumer).onCaptureData(pcm);
        },
        onVolumeLevel: (level) => {
          (captureConsumerRef.current ?? runtimeConsumer).onVolumeLevel(level);
        },
        onInterruption: () => {
          (captureConsumerRef.current ?? runtimeConsumer).onInterruption?.();
        },
        onError: (error) => {
          (captureConsumerRef.current ?? runtimeConsumer).onError?.(error);
        },
      },
      { hasCaptureClaim: () => captureConsumerRef.current !== null },
    );

    // Voice mode is one consumer among several, so it takes the claim through the same cell.
    const claimedEngine: AudioEngine = {
      ...engine,
      async startCapture() {
        if (!claim.claimCapture(runtimeConsumer)) {
          throw new Error("The microphone is in use by something else.");
        }
        await engine.startCapture();
      },
      async stopCapture() {
        await engine.stopCapture();
        claim.releaseCapture(runtimeConsumer);
      },
    };

    runtime = createVoiceRuntime({
      engine: claimedEngine,
      getServerInfo: (serverId) =>
        useSessionStore.getState().getSession(serverId)?.serverInfo ?? null,
      activateKeepAwake: async (tag) => {
        await activateKeepAwakeAsync(tag);
      },
      deactivateKeepAwake: async (tag) => {
        await deactivateKeepAwake(tag);
      },
    });

    engineRef.current = engine;
    runtimeRef.current = runtime;
    claimRef.current = claim;
  }

  const engine = engineRef.current;
  const runtime = runtimeRef.current!;
  const claim = claimRef.current!;

  useEffect(() => {
    return () => {
      void runtime.destroy().catch((error) => {
        console.error("[VoiceProvider] Failed to destroy voice runtime", error);
      });
    };
  }, [runtime]);

  return (
    <VoiceAudioEngineContext.Provider value={engine}>
      <VoiceCaptureClaimContext.Provider value={claim}>
        <VoiceRuntimeContext.Provider value={runtime}>{children}</VoiceRuntimeContext.Provider>
      </VoiceCaptureClaimContext.Provider>
    </VoiceAudioEngineContext.Provider>
  );
}
