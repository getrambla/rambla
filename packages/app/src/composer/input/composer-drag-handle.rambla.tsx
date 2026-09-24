// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: grabber row — drag adjusts the composer ceiling, double-tap toggles default/max.
import { useCallback, useMemo, useRef } from "react";
import { View, type PointerEvent as RNPointerEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useWindowDimensions } from "react-native";
import {
  resolveEffectiveMaxInputHeight,
  useComposerHeightStore,
} from "./composer-height-store.rambla";

const HANDLE_ROW_HEIGHT = 16;
const GRIP_WIDTH = 36;
const GRIP_HEIGHT = 4;
const DRAG_PIXELS_PER_HEIGHT = 1;
const DOUBLE_TAP_MS = 300;
const MAX_TAP_DRIFT_PX = 8;

interface DragState {
  pointerId: number;
  lastY: number;
  downY: number;
  downTime: number;
  moved: boolean;
}

export function ComposerDragHandle() {
  const windowHeight = useWindowDimensions().height;
  const viewportBound = resolveEffectiveMaxInputHeight(null, Math.floor(windowHeight * 0.5));
  const finePointer = useHasFinePointer();
  const dragRef = useRef<DragState | null>(null);
  const lastTapTimeRef = useRef(0);

  const setUserMaxInputHeightDelta = useComposerHeightStore((s) => s.setUserMaxInputHeightDelta);
  const toggleUserMaxInputHeight = useComposerHeightStore((s) => s.toggleUserMaxInputHeight);

  const applyDragDelta = useCallback(
    (deltaY: number) => {
      // Dragging up (negative deltaY) grows the composer, so invert.
      setUserMaxInputHeightDelta(deltaY * DRAG_PIXELS_PER_HEIGHT, viewportBound);
    },
    [setUserMaxInputHeightDelta, viewportBound],
  );

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < DOUBLE_TAP_MS) {
      lastTapTimeRef.current = 0;
      toggleUserMaxInputHeight(viewportBound);
    } else {
      lastTapTimeRef.current = now;
    }
  }, [toggleUserMaxInputHeight, viewportBound]);

  const handlePointerDown = useCallback((event: RNPointerEvent) => {
    const element = event.currentTarget as unknown as HTMLElement | null;
    if (!element) return;
    dragRef.current = {
      pointerId: event.nativeEvent.pointerId,
      lastY: event.nativeEvent.pageY,
      downY: event.nativeEvent.pageY,
      downTime: Date.now(),
      moved: false,
    };
    element.setPointerCapture?.(event.nativeEvent.pointerId);
    event.preventDefault();
    event.stopPropagation();
  }, []);

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
      }
    },
    [applyDragDelta],
  );

  const handlePointerUp = useCallback(
    (event: RNPointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.nativeEvent.pointerId) return;
      dragRef.current = null;
      const element = event.currentTarget as unknown as HTMLElement | null;
      if (element?.hasPointerCapture?.(drag.pointerId)) {
        element.releasePointerCapture(drag.pointerId);
      }
      if (!drag.moved && Date.now() - drag.downTime < DOUBLE_TAP_MS) {
        handleTap();
      }
    },
    [handleTap],
  );

  const touchGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetY([-6, 6])
        .failOffsetX([-6, 6])
        .onUpdate((event) => applyDragDelta(event.translationY))
        // A real drag must not count as a tap — mirror the web path's moved-flag behavior.
        .onEnd((event) => {
          if (Math.abs(event.translationY) <= MAX_TAP_DRIFT_PX) {
            handleTap();
          }
        }),
    [applyDragDelta, handleTap],
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
    () => [styles.hitArea, { cursor: "row-resize", touchAction: "none" } as object],
    [],
  );

  return (
    <View style={styles.row} testID="composer-drag-handle">
      {finePointer ? (
        <View style={hitAreaStyle} {...pointerHandlers}>
          <View style={styles.grip} />
        </View>
      ) : (
        <GestureDetector gesture={touchGesture}>
          <View style={styles.hitArea} collapsable={false}>
            <View style={styles.grip} />
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
  grip: {
    width: GRIP_WIDTH,
    height: GRIP_HEIGHT,
    borderRadius: GRIP_HEIGHT / 2,
    backgroundColor: theme.colors.border,
  },
}));
