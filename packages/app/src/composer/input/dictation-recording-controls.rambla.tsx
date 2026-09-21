import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowUp, Check, RefreshCcw, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { VolumeMeter } from "@/components/volume-meter";
import type { DictationStatus } from "@/hooks/use-dictation";

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

/** Compact strip height: a 44pt action row plus breathing room on the surface. */
const STRIP_HEIGHT = 52;
/** iOS minimum touch target, and the app's md/lg control contract. */
const ACTION_SIZE = 44;

const ThemedX = withUnistyles(X);
const ThemedCheck = withUnistyles(Check);
const ThemedRefreshCcw = withUnistyles(RefreshCcw);
const ThemedArrowUp = withUnistyles(ArrowUp);
const ThemedSpinner = withUnistyles(LoadingSpinner);

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const iconOnForegroundMapping = (theme: Theme) => ({ color: theme.colors.surface0 });
const iconMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

/**
 * The dictation recording strip: an in-flow, opaque row between the composer's
 * text surface and the bottom toolbar. It never overlaps the text — the strip
 * occupies its own space while dictation is active.
 */
export function DictationRecordingControls(props: DictationRecordingControlsProps) {
  const { t } = useTranslation();
  const isFailed = props.status === "failed";
  const actionsDisabled = props.isProcessing;
  const handleCancel = isFailed && props.canRetry ? props.onDiscard : props.onCancel;

  if (!props.show) {
    return null;
  }

  return (
    <View style={styles.strip} testID="dictation-recording-strip">
      <View style={styles.statusColumn}>
        {props.isRecording ? (
          <VolumeMeter
            volume={props.volume}
            isMuted={false}
            isSpeaking={false}
            orientation="horizontal"
            variant="compact"
          />
        ) : null}
        {props.isProcessing ? <ThemedSpinner size="small" uniProps={iconMutedMapping} /> : null}
        {isFailed ? <View style={styles.statusDot} /> : null}
      </View>
      {isFailed ? (
        <Text numberOfLines={2} style={styles.errorText}>
          {props.errorText
            ? t("message.dictation.failed", { error: props.errorText })
            : t("message.dictation.failedRetry")}
        </Text>
      ) : (
        <Text style={styles.timer}>{formatDuration(props.duration)}</Text>
      )}
      <View style={styles.actionGroup}>
        <Pressable
          onPress={handleCancel}
          disabled={actionsDisabled && !isFailed}
          accessibilityRole="button"
          accessibilityLabel={t("message.dictation.cancel")}
          style={styles.actionButton}
        >
          <ThemedX size={ICON_SIZE.md} uniProps={iconForegroundMapping} />
        </Pressable>
        {actionsDisabled ? (
          <View style={styles.actionButton}>
            <ThemedSpinner size="small" uniProps={iconForegroundMapping} />
          </View>
        ) : null}
        {!actionsDisabled && isFailed && props.canRetry ? (
          <Pressable
            onPress={props.onRetry}
            accessibilityRole="button"
            accessibilityLabel={t("message.dictation.retry")}
            style={[styles.actionButton, styles.actionButtonConfirm]}
          >
            <ThemedRefreshCcw size={ICON_SIZE.md} uniProps={iconOnForegroundMapping} />
          </Pressable>
        ) : null}
        {!actionsDisabled && !isFailed ? (
          <>
            <Pressable
              onPress={props.onAccept}
              accessibilityRole="button"
              accessibilityLabel={t("message.dictation.insert")}
              style={styles.actionButton}
            >
              <ThemedCheck size={ICON_SIZE.md} uniProps={iconForegroundMapping} />
            </Pressable>
            <Pressable
              onPress={props.onAcceptAndSend}
              accessibilityRole="button"
              accessibilityLabel={t("message.dictation.insertAndSend")}
              style={[styles.actionButton, styles.actionButtonConfirm]}
            >
              <ThemedArrowUp size={ICON_SIZE.md} uniProps={iconOnForegroundMapping} />
            </Pressable>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    width: "100%",
    minHeight: STRIP_HEIGHT,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  statusColumn: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDot: {
    width: theme.iconSize.sm,
    height: theme.iconSize.sm,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotDanger,
  },
  timer: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ["tabular-nums"],
  },
  errorText: {
    flexShrink: 1,
    color: theme.colors.destructiveForeground,
    fontSize: theme.fontSize.sm,
  },
  actionGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    marginLeft: "auto",
  },
  actionButton: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
  },
  actionButtonConfirm: {
    backgroundColor: theme.colors.foreground,
  },
}));
