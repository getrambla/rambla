// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: drag handle for the user-adjustable composer height.
import { useCallback, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import * as Haptics from "expo-haptics";
import { isNative } from "@/constants/platform";

// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: pure helpers for height math, activation, and double-tap timing.
export const COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX = 10;
export const COMPOSER_HANDLE_DOUBLE_TAP_WINDOW_MS = 300;

export interface ComputeHandleHeightInputs {
  heightAtPress: number;
  pointerYAtPress: number;
  pointerYNow: number;
  min: number;
  max: number;
}

export function computeHandleHeight(inputs: ComputeHandleHeightInputs): number {
  // Drag up (decreasing pageY) grows the composer: the handle sits on the composer's top edge.
  const delta = inputs.pointerYAtPress - inputs.pointerYNow;
  return Math.min(inputs.max, Math.max(inputs.min, inputs.heightAtPress + delta));
}

// After a clamp the raw anchor (height-at-press + press Y) sits beyond the
// bound; keeping it would make the pull-back resume from the unclamped
// formula instead of the bound. Re-anchoring on the bound keeps 1:1 tracking
// on the way out (plan criterion 10).
function isPinnedAtBound(height: number, min: number, max: number): boolean {
  return height === min || height === max;
}

export function isActivationThresholdPassed(inputs: {
  pointerYAtPress: number;
  pointerYNow: number;
}): boolean {
  return (
    Math.abs(inputs.pointerYNow - inputs.pointerYAtPress) > COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX
  );
}

export function isDoubleTapWindow(inputs: {
  previousTapAt: number | null;
  tappedAt: number;
}): boolean {
  if (inputs.previousTapAt === null) {
    return false;
  }
  return inputs.tappedAt - inputs.previousTapAt < COMPOSER_HANDLE_DOUBLE_TAP_WINDOW_MS;
}

export type ComposerHandleHapticKind = "grab" | "release" | "double-tap";

export function createComposerHandleHaptics(options: {
  trigger: (kind: ComposerHandleHapticKind) => void;
  isNativePlatform: boolean;
}) {
  const { trigger, isNativePlatform } = options;
  return {
    onGrab: () => {
      if (isNativePlatform) trigger("grab");
    },
    onMoveFrame: () => {
      // Haptics never fire during movement.
    },
    onRelease: () => {
      if (isNativePlatform) trigger("release");
    },
    onDoubleTap: () => {
      if (isNativePlatform) trigger("double-tap");
    },
  };
}

function triggerHaptic(kind: ComposerHandleHapticKind) {
  if (kind === "double-tap") {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    return;
  }
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

export interface ComposerDragHandleProps {
  testID?: string;
  height: number;
  minHeight: number;
  maxHeight: number;
  onHeightChange: (height: number) => void;
  /** Fires when a drag finishes, so the host can resume layout measurement. */
  onResizeEnd?: () => void;
}

export function ComposerDragHandle({
  testID,
  height,
  minHeight,
  maxHeight,
  onHeightChange,
  onResizeEnd,
}: ComposerDragHandleProps) {
  const [, setIsActive] = useState(false);
  const heightRef = useRef(height);
  heightRef.current = height;
  // Threshold checks stay anchored on the true press point; the drag formula
  // re-anchors separately (anchor refs) when a clamp pins the height, so
  // pulling back resumes 1:1 from the bound (plan criterion 10). The re-anchor
  // happens at the transition into the bound — the clamp point — so moves made
  // while already pinned do not drift the anchor.
  const pressYRef = useRef(0);
  const anchorHeightRef = useRef(height);
  const anchorYRef = useRef(0);
  const isPinnedRef = useRef(false);
  const lastTapAtRef = useRef<number | null>(null);
  const haptics = useMemo(
    () => createComposerHandleHaptics({ trigger: triggerHaptic, isNativePlatform: isNative }),
    [],
  );

  const emitHeight = useCallback(
    (pointerYNow: number) => {
      const next = computeHandleHeight({
        heightAtPress: anchorHeightRef.current,
        pointerYAtPress: anchorYRef.current,
        pointerYNow,
        min: minHeight,
        max: maxHeight,
      });
      const pinned = isPinnedAtBound(next, minHeight, maxHeight);
      if (pinned && !isPinnedRef.current) {
        anchorHeightRef.current = next;
        anchorYRef.current = pointerYNow;
      }
      isPinnedRef.current = pinned;
      onHeightChange(next);
    },
    [maxHeight, minHeight, onHeightChange],
  );

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        // Without minDistance, RNGH web's Pan activates on its default touch slop
        // (15px), so activation would land past our own 10px threshold and the
        // emitting onStart would fire too late (or never, for sub-15px drags).
        .minDistance(COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX)
        .onBegin((event) => {
          pressYRef.current = event.absoluteY;
          anchorHeightRef.current = heightRef.current;
          anchorYRef.current = event.absoluteY;
          isPinnedRef.current = false;
        })
        .onStart((event) => {
          // onStart fires at activation (>10px of movement), not at the physical
          // press; onBegin above captured the true press refs. On web the activating
          // pointermove is the only event of a fast drag (no onUpdate follows), so
          // the height must be emitted here for the first post-activation frame.
          haptics.onGrab();
          setIsActive(true);
          if (!Number.isFinite(event.absoluteY)) return;
          emitHeight(event.absoluteY);
        })
        .onUpdate((event) => {
          if (
            !isActivationThresholdPassed({
              pointerYAtPress: pressYRef.current,
              pointerYNow: event.absoluteY,
            })
          ) {
            return;
          }
          setIsActive(true);
          emitHeight(event.absoluteY);
        })
        .onEnd(() => {
          haptics.onRelease();
          onResizeEnd?.();
        })
        .onFinalize(() => {
          setIsActive(false);
        }),
    [emitHeight, haptics, onResizeEnd],
  );

  const handlePress = useCallback(() => {
    const tappedAt = Date.now();
    if (isDoubleTapWindow({ previousTapAt: lastTapAtRef.current, tappedAt })) {
      lastTapAtRef.current = null;
      haptics.onDoubleTap();
      return;
    }
    lastTapAtRef.current = tappedAt;
  }, [haptics]);

  return (
    <GestureDetector gesture={gesture}>
      <View collapsable={false} testID={testID} onTouchEnd={handlePress} style={styles.handle}>
        <View style={styles.handleIndicator} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  handle: {
    // RAMBLA-FORK: fix: 2026-09-24-feat-user-adjustable-composer-height.md: comfortable grab target, pill at its center.
    height: 24,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  handleIndicator: {
    width: 36,
    height: 4,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.borderAccent,
  },
}));
