import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
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
  errorText?: string;
  onStart: () => void;
  onCancel: () => void;
  onAccept: () => void;
  onAcceptAndSend: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}

/** The recording controls beside the composer field, so the dictated text stays visible. */
export function DictationRecordingControls(props: DictationRecordingControlsProps) {
  const { t } = useTranslation();

  if (!props.show) {
    return null;
  }
  return (
    <View style={styles.container}>
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
      {props.status === "failed" ? (
        <Text style={styles.errorText}>
          {props.errorText
            ? t("message.dictation.failed", { error: props.errorText })
            : t("message.dictation.failedRetry")}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    position: "absolute",
    top: 0,
    right: 0,
    gap: theme.spacing[1],
  },
  errorText: {
    color: theme.colors.destructiveForeground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
}));
