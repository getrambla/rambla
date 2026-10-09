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
// RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: imports for the toast and the capture-claim callback type.
import { useToast } from "@/contexts/toast-api-context";
import { useSessionStore } from "@/stores/session-store";
import { createAudioEngine } from "@/audio";
// RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: imports the callbacks type for claim consumers.
import type { AudioEngine, AudioEngineCallbacks } from "@/audio";
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

// RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: capture-claim interface and context shared by voice mode and dictation.
export interface VoiceCaptureClaim {
  claimCapture(consumer: AudioEngineCallbacks): boolean;
  releaseCapture(consumer: AudioEngineCallbacks): void;
}

const VoiceRuntimeContext = createContext<VoiceRuntime | null>(null);
const VoiceAudioEngineContext = createContext<AudioEngine | null>(null);
// RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: context carrying the capture claim.
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

// RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: hook exposing the capture claim to dictation.
export function useVoiceCaptureClaimOptional(): VoiceCaptureClaim | null {
  return useContext(VoiceCaptureClaimContext);
}

interface VoiceProviderProps {
  children: ReactNode;
}

export function VoiceProvider({ children }: VoiceProviderProps) {
  const engineRef = useRef<AudioEngine | null>(null);
  const runtimeRef = useRef<VoiceRuntime | null>(null);
  // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: claim cell and toast ref for engine errors.
  const claimRef = useRef<VoiceCaptureClaim | null>(null);
  const captureConsumerRef = useRef<AudioEngineCallbacks | null>(null);
  const toast = useToast();
  // The callbacks below are built once, so they read the toast api through a ref that stays current.
  const toastRef = useRef(toast);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  if (!engineRef.current) {
    let runtime: VoiceRuntime | null = null;
    // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: voice-mode callbacks become one claim consumer.
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
      // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: engine errors stop voice and toast; one shared engine routes callbacks to the claim holder.
      // Named `captureError` so the lint rule against promises in node-style callbacks stays quiet.
      onError: (captureError) => {
        console.error("[VoiceEngine] Capture error:", captureError);
        void runtime?.stopVoice().catch((stopError) => {
          console.error("[VoiceEngine] Failed to stop after capture error:", stopError);
        });
        toastRef.current.error(captureError.message);
      },
      // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: builds the claim, one shared engine routed to the claim holder, and a claim-taking engine for voice mode.
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
          throw new Error("Stop dictation before starting voice mode.");
        }
        await engine.startCapture();
      },
      async stopCapture() {
        // A refused start unwinds through here, and it must not stop whoever does hold capture.
        if (captureConsumerRef.current === runtimeConsumer) {
          await engine.stopCapture();
        }
        claim.releaseCapture(runtimeConsumer);
      },
    };

    runtime = createVoiceRuntime({
      // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: voice mode runs on the claim-taking engine.
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
    // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: keep the claim alongside the engine and runtime.
    claimRef.current = claim;
  }

  const engine = engineRef.current;
  const runtime = runtimeRef.current!;
  // RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: read the claim for the provider below.
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
      {/* RAMBLA-FORK: fix: 2026-09-19-fix-ios-microphone-ownership.md: provide the capture claim to the tree. */}
      <VoiceCaptureClaimContext.Provider value={claim}>
        <VoiceRuntimeContext.Provider value={runtime}>{children}</VoiceRuntimeContext.Provider>
      </VoiceCaptureClaimContext.Provider>
    </VoiceAudioEngineContext.Provider>
  );
}
