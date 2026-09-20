import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DictationStreamSender } from "@/dictation/dictation-stream-sender";
import { useDictationAudioSource } from "@/hooks/use-dictation-audio-source";
import { generateMessageId } from "@/types/stream";
import { AttemptGuard } from "@/utils/attempt-guard";
import {
  DURATION_TICK_MS,
  PCM_DICTATION_FORMAT,
  toError,
  type DictationStatus,
  type UseDictationOptions,
  type UseDictationResult,
} from "./use-dictation.shared";

export function useDictation(options: UseDictationOptions): UseDictationResult {
  const { t } = useTranslation();
  const {
    client,
    onTranscript,
    onPartialTranscript,
    onDictationRestarted,
    onError,
    onPermanentFailure,
    canStart,
    canConfirm,
    enableDuration = false,
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [partialTranscript, setPartialTranscript] = useState("");
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [canRetryFailedDictation, setCanRetryFailedDictation] = useState(false);
  const latestPartialTranscriptRef = useRef("");

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const onPartialTranscriptRef = useRef(onPartialTranscript);
  useEffect(() => {
    onPartialTranscriptRef.current = onPartialTranscript;
  }, [onPartialTranscript]);

  const onDictationRestartedRef = useRef(onDictationRestarted);
  useEffect(() => {
    onDictationRestartedRef.current = onDictationRestarted;
  }, [onDictationRestarted]);

  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const onPermanentFailureRef = useRef(onPermanentFailure);
  useEffect(() => {
    onPermanentFailureRef.current = onPermanentFailure;
  }, [onPermanentFailure]);

  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);
  const isRecordingActive = useCallback(() => isRecordingRef.current, []);

  const isProcessingRef = useRef(isProcessing);
  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  // duration is used for UI only; no need to mirror into a ref.

  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptGuardRef = useRef(new AttemptGuard());
  // Teardown cancels the attempt guard the same way a supersede does, so the two are
  // told apart here; navigating away is not an abort the user needs told about.
  const isTearingDownRef = useRef(false);
  const actionGateRef = useRef<{
    starting: boolean;
    confirming: boolean;
    cancelling: boolean;
    retrying: boolean;
  }>({
    starting: false,
    confirming: false,
    cancelling: false,
    retrying: false,
  });

  const senderRef = useRef<DictationStreamSender | null>(null);
  if (!senderRef.current) {
    senderRef.current = new DictationStreamSender({
      client,
      format: PCM_DICTATION_FORMAT,
      createDictationId: generateMessageId,
      onRestart: () => onDictationRestartedRef.current?.(),
    });
  }
  useEffect(() => {
    senderRef.current?.setClient(client);
  }, [client]);

  const stopDurationTracking = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  const startDurationTracking = useCallback(() => {
    if (!enableDuration) {
      return;
    }
    if (durationIntervalRef.current) {
      return;
    }
    durationIntervalRef.current = setInterval(() => {
      setDuration((prev) => prev + 1);
    }, DURATION_TICK_MS);
  }, [enableDuration]);

  useEffect(() => {
    if (!enableDuration) {
      stopDurationTracking();
      setDuration(0);
    }
  }, [enableDuration, stopDurationTracking]);

  const reportError = useCallback(
    (err: unknown, context?: string) => {
      const normalized = toError(err);
      if (normalized.name === "AttemptCancelledError") {
        return;
      }
      if (context) {
        console.error(`[useDictation] ${context}`, normalized);
      } else {
        console.error("[useDictation]", normalized);
      }
      setError(normalized.message);
      onErrorRef.current?.(normalized);
    },
    [setError],
  );

  const clearStreamingState = useCallback(() => {
    senderRef.current?.clearAll();
    latestPartialTranscriptRef.current = "";
    setPartialTranscript("");
  }, []);

  const startNewStream = useCallback(async (reason: string) => {
    await senderRef.current?.restartStream(reason);
  }, []);

  const ensureFinalTranscript = useCallback(
    async (finalSeq: number): Promise<{ text: string; droppedTranscript?: string }> => {
      const result = await senderRef.current!.finish(finalSeq);
      return { text: result.text, droppedTranscript: result.droppedTranscript };
    },
    [],
  );

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.subscribeConnectionStatus((next) => {
      if (next.status !== "connected") {
        return;
      }
      if (!isRecordingRef.current) {
        return;
      }
      void startNewStream("reconnect").catch((err) => {
        reportError(err, "Failed to restart dictation stream after reconnect");
      });
    });
  }, [client, reportError, startNewStream]);

  useEffect(() => {
    if (!client) {
      return;
    }
    return client.on("dictation_stream_partial", (message) => {
      if (message.type !== "dictation_stream_partial") {
        return;
      }
      const activeDictationId = senderRef.current?.getDictationId();
      if (!activeDictationId) {
        return;
      }
      if (message.payload.dictationId !== activeDictationId) {
        return;
      }
      const next = message.payload.text ?? "";
      latestPartialTranscriptRef.current = next;
      setPartialTranscript(next);
      onPartialTranscriptRef.current?.(next, {
        requestId: generateMessageId(),
        segment: message.payload.segment,
      });
    });
  }, [client]);

  const handleDictationFailure = useCallback(
    (failure: unknown) => {
      const normalized = toError(failure);
      const failureId = generateMessageId();
      stopDurationTracking();
      setIsProcessing(false);
      isProcessingRef.current = false;
      isRecordingRef.current = false;
      setIsRecording(false);

      const hasBufferedAudio = senderRef.current?.hasSegments() ?? false;
      setStatus("failed");
      setCanRetryFailedDictation(hasBufferedAudio);
      if (hasBufferedAudio) {
        onPermanentFailureRef.current?.(normalized, { requestId: failureId });
      }

      reportError(normalized, "Failed to complete dictation");
    },
    [reportError, stopDurationTracking],
  );

  // reportError's console line already carries the specific reason via `context`, so the
  // user-facing toast stays one plain message per situation and the log keeps the detail.
  const reportDetailOnly = useCallback((detail: string, context: string) => {
    console.error(`[useDictation] ${context}: ${detail}`);
  }, []);

  // A submit that aborts silently is indistinguishable from a successful send, so the abort
  // is reported; the specific cause stays in the log and the toast names only the outcome.
  const reportConfirmAbort = useCallback(
    (detail: string, abortOptions?: { asFailure?: boolean }) => {
      if (abortOptions?.asFailure) {
        handleDictationFailure(new Error(t("common.errors.dictationNotSent")));
        reportDetailOnly(detail, "Dictation submit aborted");
        return;
      }
      reportDetailOnly(detail, "Dictation submit aborted");
      reportError(new Error(t("common.errors.dictationNotSent")), "Dictation submit aborted");
    },
    [handleDictationFailure, reportDetailOnly, reportError, t],
  );

  const reportRetryAbort = useCallback(
    (detail: string) => {
      reportDetailOnly(detail, "Dictation retry aborted");
      reportError(
        new Error(t("common.errors.dictationRetryNotPossible")),
        "Dictation retry aborted",
      );
    },
    [reportDetailOnly, reportError, t],
  );

  // The daemon transcribed these words but could not place them in `text`; appending them is
  // the only recovery the daemon offers, since it no longer holds that audio as pending.
  const handleStreamingTranscriptionSuccess = useCallback(
    (text: string, requestId: string, droppedTranscript?: string) => {
      const latestPartial = latestPartialTranscriptRef.current.trim();
      const trimmedDropped = droppedTranscript?.trim();
      const recovered = [text.trim(), trimmedDropped]
        .filter((part) => part && part.length > 0)
        .join(" ");
      const transcriptText = recovered.length > 0 ? recovered : latestPartial;

      if (trimmedDropped) {
        console.warn(
          "[useDictation] Appended transcript the daemon dropped from the final text:",
          trimmedDropped,
        );
      }

      // Nothing came back, or the final stops at a word boundary the daemon had
      // already spoken past, so keep the buffered audio for the overlay's retry.
      if (!transcriptText || latestPartial.startsWith(`${transcriptText} `)) {
        handleDictationFailure(new Error(t("common.errors.unexpectedDictationError")));
        return;
      }

      setIsProcessing(false);
      isProcessingRef.current = false;
      setDuration(0);
      setStatus("idle");
      clearStreamingState();

      onTranscriptRef.current?.(transcriptText, { requestId });
    },
    [clearStreamingState, handleDictationFailure, t],
  );

  const audio = useDictationAudioSource({
    onPcmSegment: (audioData) => {
      senderRef.current?.enqueueSegment(audioData);
    },
    onError: (err) => {
      onErrorRef.current?.(err);
    },
    onInterruption: () => {
      try {
        senderRef.current?.cancel();
      } catch {
        // no-op
      }
      handleDictationFailure(new Error("Dictation was interrupted by another audio source."));
    },
  });
  const audioStopRef = useRef(audio.stop);
  useEffect(() => {
    audioStopRef.current = audio.stop;
  }, [audio.stop]);

  const startDictation = useCallback(async () => {
    if (
      actionGateRef.current.starting ||
      actionGateRef.current.confirming ||
      actionGateRef.current.cancelling
    ) {
      return;
    }
    if (isRecordingRef.current || isProcessingRef.current) {
      return;
    }
    const startAllowed = canStart ? canStart() : true;
    if (!startAllowed) {
      return;
    }

    actionGateRef.current.starting = true;
    setError(null);
    setPartialTranscript("");
    setDuration(0);
    setIsProcessing(false);
    setStatus("recording");
    clearStreamingState();

    try {
      await audio.start();
      isRecordingRef.current = true;
      setIsRecording(true);
      if (enableDuration) {
        startDurationTracking();
      }
      if (client?.isConnected) {
        await startNewStream("start");
      }
    } catch (err) {
      await audio.stop().catch(() => undefined);
      stopDurationTracking();
      isRecordingRef.current = false;
      setIsRecording(false);
      setStatus("idle");
      reportError(err, "Failed to start dictation");
    } finally {
      actionGateRef.current.starting = false;
    }
  }, [
    audio,
    canStart,
    clearStreamingState,
    client,
    enableDuration,
    reportError,
    startDurationTracking,
    startNewStream,
    stopDurationTracking,
  ]);

  const cancelDictation = useCallback(async () => {
    attemptGuardRef.current.cancel();
    if (actionGateRef.current.cancelling) {
      return;
    }
    if (!isRecordingRef.current && !isProcessingRef.current) {
      return;
    }
    actionGateRef.current.cancelling = true;
    stopDurationTracking();
    setDuration(0);
    setError(null);

    try {
      try {
        senderRef.current?.cancel();
      } catch {
        // no-op
      }
      await audio.stop();
    } catch (err) {
      reportError(err, "Failed to cancel dictation");
    } finally {
      isRecordingRef.current = false;
      setIsRecording(false);
      setIsProcessing(false);
      isProcessingRef.current = false;
      setStatus("idle");
      clearStreamingState();
      actionGateRef.current.cancelling = false;
    }
  }, [audio, clearStreamingState, reportError, stopDurationTracking]);

  const confirmDictation = useCallback(async () => {
    if (actionGateRef.current.confirming) {
      reportConfirmAbort("submit already in flight");
      return;
    }
    // A cancel already in flight is the user discarding this recording on purpose,
    // so the submit chasing it is refused rather than reported as a failure.
    if (actionGateRef.current.cancelling) {
      reportConfirmAbort("cancel already in flight");
      return;
    }
    if (!isRecordingRef.current || isProcessingRef.current) {
      reportConfirmAbort("no recording in progress");
      return;
    }
    const confirmAllowed = canConfirm ? canConfirm() : true;
    if (!confirmAllowed) {
      await audio.stop().catch(() => undefined);
      handleDictationFailure(new Error(t("common.errors.daemonClientDisconnected")));
      return;
    }

    actionGateRef.current.confirming = true;
    setError(null);
    stopDurationTracking();
    setIsProcessing(true);
    isProcessingRef.current = true;

    const attemptId = attemptGuardRef.current.next();

    try {
      await audio.stop();
      attemptGuardRef.current.assertCurrent(attemptId);

      setStatus("uploading");
      isRecordingRef.current = false;
      setIsRecording(false);

      const finalSeq = senderRef.current?.getFinalSeq() ?? -1;
      if (finalSeq < 0) {
        reportConfirmAbort("no audio was captured", { asFailure: true });
        return;
      }

      const finalResult = await ensureFinalTranscript(finalSeq);
      attemptGuardRef.current.assertCurrent(attemptId);
      handleStreamingTranscriptionSuccess(
        finalResult.text,
        generateMessageId(),
        finalResult.droppedTranscript,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AttemptCancelledError") {
        reportConfirmAbort("superseded by cancel or restart");
        return;
      }
      handleDictationFailure(err);
    } finally {
      actionGateRef.current.confirming = false;
      if (isTearingDownRef.current) {
        attemptGuardRef.current.cancel();
        senderRef.current?.dispose();
      }
    }
  }, [
    audio,
    canConfirm,
    handleDictationFailure,
    handleStreamingTranscriptionSuccess,
    reportConfirmAbort,
    stopDurationTracking,
    ensureFinalTranscript,
    t,
  ]);

  const retryFailedDictation = useCallback(async () => {
    // Without this gate the second tap resets the stream under the first, whose finish then
    // throws and reports a failure for a transcript the user already received.
    if (actionGateRef.current.retrying) {
      reportRetryAbort("retry already in flight");
      return;
    }
    if (!senderRef.current?.hasSegments()) {
      reportRetryAbort("no buffered audio to resend");
      return;
    }
    actionGateRef.current.retrying = true;
    setError(null);
    setStatus("uploading");
    setIsProcessing(true);
    isProcessingRef.current = true;

    try {
      if (!client?.isConnected) {
        throw new Error(t("common.errors.daemonClientDisconnected"));
      }
      senderRef.current.resetStreamForReplay();
      const finalSeq = senderRef.current.getFinalSeq();
      const finalResult = await ensureFinalTranscript(finalSeq);
      handleStreamingTranscriptionSuccess(
        finalResult.text,
        generateMessageId(),
        finalResult.droppedTranscript,
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AttemptCancelledError") {
        reportRetryAbort("superseded by cancel or restart");
        return;
      }
      handleDictationFailure(err);
    } finally {
      actionGateRef.current.retrying = false;
      if (isTearingDownRef.current) {
        attemptGuardRef.current.cancel();
        senderRef.current?.dispose();
      }
    }
  }, [
    client,
    ensureFinalTranscript,
    handleDictationFailure,
    handleStreamingTranscriptionSuccess,
    reportRetryAbort,
    t,
  ]);

  const discardFailedDictation = useCallback(() => {
    setIsProcessing(false);
    isProcessingRef.current = false;
    setDuration(0);
    setStatus("idle");
    setError(null);
    clearStreamingState();
  }, [clearStreamingState]);

  const reset = useCallback(() => {
    setIsRecording(false);
    isRecordingRef.current = false;
    setIsProcessing(false);
    isProcessingRef.current = false;
    stopDurationTracking();
    setDuration(0);
    setError(null);
    setStatus("idle");
    clearStreamingState();
  }, [clearStreamingState, stopDurationTracking]);

  useEffect(() => {
    const attemptGuard = attemptGuardRef.current;
    const actionGate = actionGateRef.current;
    const audioStop = audioStopRef;
    return () => {
      isTearingDownRef.current = true;
      stopDurationTracking();
      void audioStop.current().catch(() => undefined);
      // A submit or retry already waiting on the daemon owns the transcript: cancelling or
      // disposing it here drops words the user spoke, so it runs to delivery and cleans up
      // after itself.
      if (actionGate.confirming || actionGate.retrying) {
        return;
      }
      attemptGuard.cancel();
      senderRef.current?.dispose();
    };
  }, [stopDurationTracking]);

  return {
    isRecording,
    isRecordingActive,
    isProcessing,
    partialTranscript,
    volume: audio.volume,
    duration,
    error,
    status,
    canRetryFailedDictation,
    startDictation,
    cancelDictation,
    confirmDictation,
    retryFailedDictation,
    discardFailedDictation,
    reset,
  };
}

export type {
  DictationStatus,
  UseDictationOptions,
  UseDictationResult,
} from "./use-dictation.shared";
