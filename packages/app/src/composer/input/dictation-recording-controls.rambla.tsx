import type { DictationStatus } from "@/hooks/use-dictation";
import { DictationControls } from "@/components/dictation-controls";

export interface DictationRecordingControlsProps {
  show: boolean;
  volume: number;
  duration: number;
  isRecording: boolean;
  isProcessing: boolean;
  status: DictationStatus;
  canRetry: boolean;
  onStart: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onAcceptAndSend: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

/** The recording controls beside the composer field, so the dictated text stays visible. */
export function DictationRecordingControls(props: DictationRecordingControlsProps) {
  if (!props.show) {
    return null;
  }
  return (
    <DictationControls
      volume={props.volume}
      duration={props.duration}
      isRecording={props.isRecording}
      isProcessing={props.isProcessing}
      status={props.status}
      onStart={props.onStart}
      onCancel={props.onCancel}
      onAccept={props.onAccept}
      onAcceptAndSend={props.onAcceptAndSend}
      onRetry={props.canRetry ? props.onRetry : undefined}
      onDiscard={props.onDiscard}
    />
  );
}
