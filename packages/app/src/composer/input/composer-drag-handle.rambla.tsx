// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: grabber row that drags the composer height.
import { useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { StyleSheet } from "react-native-unistyles";
import {
  MIN_PINNED_HEIGHT,
  type ComposerHeightStore,
} from "./composer-height-store.rambla";

const DRAG_PIN_THRESHOLD_PX = 8;
const DOUBLE_TAP_WINDOW_MS = 300;

interface ComposerDragHandleProps {
  store: ComposerHeightStore;
  windowHeight: number;
  dragStartHeight: number | null;
}

export function ComposerDragHandle({
  store,
  windowHeight,
  dragStartHeight,
}: ComposerDragHandleProps) {
  const [isActive, setIsActive] = useState(false);
  const dragStartHeightRef = useRef(dragStartHeight ?? MIN_PINNED_HEIGHT);
  if (dragStartHeight !== null) {
    dragStartHeightRef.current = dragStartHeight;
  }
  const lastTapAtRef = useRef(0);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .failOffsetX([-24, 24])
        .activeOffsetY([-6, 6])
        .onBegin(() => {
          setIsActive(true);
          void Haptics.selectionAsync().catch(() => {});
        })
        .onUpdate((event) => {
          store.setLiveHeight(
            dragStartHeightRef.current - event.translationY,
            windowHeight,
          );
        })
        .onEnd((event) => {
          if (Math.abs(event.translationY) >= DRAG_PIN_THRESHOLD_PX) {
            store.pinLiveHeight(windowHeight);
            void Haptics.selectionAsync().catch(() => {});
            return;
          }
          // RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: single tap mutates nothing; two taps within 300ms restore the 3-line default.
          store.clearLiveHeight();
          const now = Date.now();
          if (now - lastTapAtRef.current < DOUBLE_TAP_WINDOW_MS) {
            lastTapAtRef.current = 0;
            store.restoreDefault();
            void Haptics.selectionAsync().catch(() => {});
            return;
          }
          lastTapAtRef.current = now;
        })
        .onFinalize(() => {
          setIsActive(false);
        }),
    [store, windowHeight],
  );

  const grabberStyle = useMemo(
    () => [styles.grabberRow, isActive && styles.grabberRowActive],
    [isActive],
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={grabberStyle} testID="composer-drag-handle">
        <View style={styles.grabberBar} />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create((theme) => ({
  grabberRow: {
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  grabberRowActive: {
    opacity: 0.6,
  },
  grabberBar: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.border,
  },
}));
