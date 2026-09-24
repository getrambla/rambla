// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: grabber row — hold to drag the composer 1:1 in line steps with per-line haptics; release pins; double-tap toggles default/max.
import { useCallback, useMemo, useRef, useState } from "react";
import { View, type PointerEvent as RNPointerEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { StyleSheet } from "react-native-unistyles";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useWindowDimensions } from "react-native";
import { useComposerHeightStore } from "./composer-height-store.rambla";

const HANDLE_ROW_HEIGHT = 16;
const GRIP_WIDTH = 36;
const GRIP_HEIGHT = 4;
const DOUBLE_TAP_MS = 300;
const MAX_TAP_DRIFT_PX = 8;

interface DragState {
  pointerId: number;
  lastY: number;
  downY: number;
  downTime: number;
  moved: boolean;
}

export function ComposerDragHandle({ lineHeight }: { lineHeight: number }) {
  const windowHeight = useWindowDimensions().height;
  const finePointer = useHasFinePointer();
  const dragRef = useRef<DragState | null>(null);
  const lastTapTimeRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const setDragHeightDelta = useComposerHeightStore((s) => s.setDragHeightDelta);
  const pinDragHeight = useComposerHeightStore((s) => s.pinDragHeight);
  const toggleExplicitHeight = useComposerHeightStore((s) => s.toggleExplicitHeight);

  // RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: one haptic on grab; during the drag one tick per line crossed, only when the line index changes (v2 device bug: constant buzz).
  const tickedLineRef = useRef<number | null>(null);
  const lastTranslationRef = useRef(0);

  const tickForHeight = useCallback(
    (height: number) => {
      const line = Math.round(height / lineHeight);
      if (tickedLineRef.current !== line) {
        tickedLineRef.current = line;
        void Haptics.selectionAsync().catch(() => {});
      }
    },
    [lineHeight],
  );

  const beginDrag = useCallback(() => {
    lastTranslationRef.current = 0;
    tickedLineRef.current = null;
    setIsDragging(true);
    // Grab: a single tick, then the drag session starts.
    void Haptics.selectionAsync().catch(() => {});
  }, []);

  // Dragging up (negative deltaY) grows the composer, so invert; the store quantizes to
  // whole lines with a 1-line minimum and no maximum.
  const applyDragDelta = useCallback(
    (deltaY: number) => {
      setDragHeightDelta(-deltaY, lineHeight);
    },
    [setDragHeightDelta, lineHeight],
  );

  const endDrag = useCallback(() => {
    setIsDragging(false);
    tickedLineRef.current = null;
    // Release: pin min = max = the height the box was left at.
    pinDragHeight();
  }, [pinDragHeight]);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < DOUBLE_TAP_MS) {
      lastTapTimeRef.current = 0;
      toggleExplicitHeight(windowHeight, lineHeight);
    } else {
      lastTapTimeRef.current = now;
    }
  }, [toggleExplicitHeight, windowHeight, lineHeight]);

  const handlePointerDown = useCallback(
    (event: RNPointerEvent) => {
      const element = event.currentTarget as unknown as HTMLElement | null;
      if (!element) return;
      dragRef.current = {
        pointerId: event.nativeEvent.pointerId,
        lastY: event.nativeEvent.pageY,
        downY: event.nativeEvent.pageY,
        downTime: Date.now(),
        moved: false,
      };
      beginDrag();
      element.setPointerCapture?.(event.nativeEvent.pointerId);
      event.preventDefault();
      event.stopPropagation();
    },
    [beginDrag],
  );

  const handlePointerMove = useCallback(
    (event: RNPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.nativeEvent.pointerId) return;
      const y = event.nativeEvent.pageY;
      const delta = y - drag.lastY;
      drag.lastY = y;
      if (Math.abs(y - drag.downY) > MAX_TAP_DRIFT_PX) {
        drag.moved = true;
        applyDragDelta(delta);
        // 1:1: the tick tracks the height the finger produced, not the raw pointer.
        const { dragHeight } = useComposerHeightStore.getState();
        if (dragHeight !== null) tickForHeight(dragHeight);
      }
    },
    [applyDragDelta, tickForHeight],
  );

  const handlePointerUp = useCallback(
    (event: RNPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.nativeEvent.pointerId) return;
      dragRef.current = null;
      endDrag();
      const element = event.currentTarget as unknown as HTMLElement | null;
      if (element?.hasPointerCapture?.(drag.pointerId)) {
        element.releasePointerCapture(drag.pointerId);
      }
      if (!drag.moved && Date.now() - drag.downTime < DOUBLE_TAP_MS) {
        handleTap();
      }
    },
    [endDrag, handleTap],
  );

  const touchGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        // Any meaningful vertical movement grabs the drag; only a mostly-horizontal motion
        // fails it, so sloppy diagonal starts still grab.
        .activeOffsetY([-6, 6])
        .failOffsetX([-24, 24])
        .onStart(() => {
          beginDrag();
        })
        .onUpdate((event) => {
          const previous = lastTranslationRef.current;
          lastTranslationRef.current = event.translationY;
          applyDragDelta(event.translationY - previous);
          const { dragHeight } = useComposerHeightStore.getState();
          if (dragHeight !== null) tickForHeight(dragHeight);
        })
        .onEnd(() => {
          endDrag();
          const translation = lastTranslationRef.current;
          lastTranslationRef.current = 0;
          if (Math.abs(translation) <= MAX_TAP_DRIFT_PX) {
            handleTap();
          }
        }),
    [applyDragDelta, beginDrag, endDrag, handleTap, tickForHeight],
  );

  const pointerHandlers = useMemo(
    () => ({
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    }),
    [handlePointerDown, handlePointerMove, handlePointerUp],
  );

  const hitAreaStyle = useMemo(
    () => [
      styles.hitArea,
      isDragging && styles.pressableHitArea,
      { cursor: "row-resize", touchAction: "none" } as object,
    ],
    [isDragging],
  );

  return (
    <View style={styles.row} testID="composer-drag-handle">
      {finePointer ? (
        <View style={hitAreaStyle} {...pointerHandlers}>
          <View style={[styles.grip, isDragging && styles.activeGrip]} />
        </View>
      ) : (
        <GestureDetector gesture={touchGesture}>
          <View style={[styles.hitArea, isDragging && styles.pressableHitArea]} collapsable={false}>
            <View style={[styles.grip, isDragging && styles.activeGrip]} />
          </View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    height: HANDLE_ROW_HEIGHT,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  hitArea: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    // The handle must set this itself — a web drag must never start a text selection.
    userSelect: "none",
  },
  pressableHitArea: {
    backgroundColor: theme.colors.surface1,
  },
  grip: {
    width: GRIP_WIDTH,
    height: GRIP_HEIGHT,
    borderRadius: GRIP_HEIGHT / 2,
    backgroundColor: theme.colors.border,
  },
  activeGrip: {
    width: GRIP_WIDTH * 1.5,
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
