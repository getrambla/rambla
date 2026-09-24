// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: grabber row — drag moves the actual composer height in line steps with haptics; double-tap toggles default/max.
import { useCallback, useMemo, useRef, useState } from "react";
import { View, type PointerEvent as RNPointerEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import { StyleSheet } from "react-native-unistyles";
import { useHasFinePointer } from "@/hooks/use-fine-pointer";
import { useWindowDimensions } from "react-native";
import {
  resolveComposerViewportBound,
  useComposerHeightStore,
} from "./composer-height-store.rambla";

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
  const viewportBound = resolveComposerViewportBound(windowHeight);
  const finePointer = useHasFinePointer();
  const dragRef = useRef<DragState | null>(null);
  const lastTapTimeRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  const setExplicitHeightDelta = useComposerHeightStore((s) => s.setExplicitHeightDelta);
  const toggleExplicitHeight = useComposerHeightStore((s) => s.toggleExplicitHeight);

  // Dragging up (negative deltaY) grows the composer, so invert. One haptic tick per
  // whole-line step, following the haptics pattern in use-long-press-drag-interaction.ts.
  const lineRef = useRef<number | null>(null);
  const lastTranslationRef = useRef(0);

  const beginDrag = useCallback(() => {
    lastTranslationRef.current = 0;
    setIsDragging(true);
    lineRef.current = null;
    void Haptics.selectionAsync().catch(() => {});
  }, []);

  const applyDragDelta = useCallback(
    (deltaY: number) => {
      setExplicitHeightDelta(-deltaY, viewportBound, lineHeight);
    },
    [setExplicitHeightDelta, viewportBound, lineHeight],
  );

  const tickPerLine = useCallback(
    (y: number, downY: number) => {
      const line = Math.round((y - downY) / lineHeight);
      if (lineRef.current === null) {
        lineRef.current = line;
        return;
      }
      if (line !== lineRef.current) {
        lineRef.current = line;
        void Haptics.selectionAsync().catch(() => {});
      }
    },
    [lineHeight],
  );

  const endDrag = useCallback(() => {
    setIsDragging(false);
    lineRef.current = null;
  }, []);

  const handleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapTimeRef.current < DOUBLE_TAP_MS) {
      lastTapTimeRef.current = 0;
      toggleExplicitHeight(viewportBound, lineHeight);
    } else {
      lastTapTimeRef.current = now;
    }
  }, [toggleExplicitHeight, viewportBound, lineHeight]);

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
      }
      tickPerLine(y, drag.downY);
    },
    [applyDragDelta, tickPerLine],
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
          tickPerLine(event.translationY, 0);
        })
        .onEnd((event) => {
          endDrag();
          if (Math.abs(event.translationY) <= MAX_TAP_DRIFT_PX) {
            handleTap();
          }
        }),
    [applyDragDelta, beginDrag, endDrag, handleTap, tickPerLine],
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
