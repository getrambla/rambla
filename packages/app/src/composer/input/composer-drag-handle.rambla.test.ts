// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: unit tests for the drag handle decisions and the haptics guard.
import { describe, expect, it, vi } from "vitest";

import {
  computeHandleHeight,
  isActivationThresholdPassed,
  isDoubleTapWindow,
  createComposerHandleHaptics,
  COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX,
  COMPOSER_HANDLE_DOUBLE_TAP_WINDOW_MS,
} from "./composer-drag-handle.rambla";

describe("computeHandleHeight", () => {
  it("adds the inverted pointer delta to the height at press, clamped to bounds", () => {
    expect(
      computeHandleHeight({
        heightAtPress: 100,
        pointerYAtPress: 500,
        pointerYNow: 460,
        min: 52,
        max: 620,
      }),
    ).toBe(140);
    expect(
      computeHandleHeight({
        heightAtPress: 100,
        pointerYAtPress: 500,
        pointerYNow: 540,
        min: 52,
        max: 620,
      }),
    ).toBe(60);
  });

  it("clamps at the bounds while the finger keeps moving", () => {
    expect(
      computeHandleHeight({
        heightAtPress: 100,
        pointerYAtPress: 620,
        pointerYNow: 0,
        min: 52,
        max: 620,
      }),
    ).toBe(620);
    expect(
      computeHandleHeight({
        heightAtPress: 100,
        pointerYAtPress: 500,
        pointerYNow: 1100,
        min: 52,
        max: 620,
      }),
    ).toBe(52);
  });

  it("keeps arbitrary fractional heights — never quantized", () => {
    expect(
      computeHandleHeight({
        heightAtPress: 100,
        pointerYAtPress: 507.75,
        pointerYNow: 500.25,
        min: 52,
        max: 620,
      }),
    ).toBe(107.5);
  });
});

describe("isActivationThresholdPassed", () => {
  it("needs more than the threshold before the drag activates", () => {
    expect(isActivationThresholdPassed({ pointerYAtPress: 500, pointerYNow: 500 })).toBe(false);
    expect(
      isActivationThresholdPassed({
        pointerYAtPress: 500,
        pointerYNow: 500 - COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX,
      }),
    ).toBe(false);
    expect(
      isActivationThresholdPassed({
        pointerYAtPress: 500,
        pointerYNow: 500 - COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX - 0.5,
      }),
    ).toBe(true);
    expect(
      isActivationThresholdPassed({
        pointerYAtPress: 500,
        pointerYNow: 500 + COMPOSER_HANDLE_ACTIVATION_THRESHOLD_PX + 0.5,
      }),
    ).toBe(true);
  });
});

describe("isDoubleTapWindow", () => {
  it("accepts two taps within 300ms and rejects slower pairs", () => {
    expect(
      isDoubleTapWindow({
        previousTapAt: 1_000,
        tappedAt: 1_000 + COMPOSER_HANDLE_DOUBLE_TAP_WINDOW_MS - 1,
      }),
    ).toBe(true);
    expect(
      isDoubleTapWindow({
        previousTapAt: 1_000,
        tappedAt: 1_000 + COMPOSER_HANDLE_DOUBLE_TAP_WINDOW_MS,
      }),
    ).toBe(false);
    expect(isDoubleTapWindow({ previousTapAt: null, tappedAt: 1_050 })).toBe(false);
  });
});

describe("createComposerHandleHaptics", () => {
  it("fires on grab, on release, and on double-tap — never during movement", () => {
    const trigger = vi.fn();
    const haptics = createComposerHandleHaptics({ trigger, isNativePlatform: true });

    haptics.onGrab();
    haptics.onMoveFrame();
    haptics.onMoveFrame();
    haptics.onMoveFrame();
    haptics.onRelease();
    haptics.onDoubleTap();

    expect(trigger).toHaveBeenCalledTimes(3);
    expect(trigger).toHaveBeenNthCalledWith(1, "grab");
    expect(trigger).toHaveBeenNthCalledWith(2, "release");
    expect(trigger).toHaveBeenNthCalledWith(3, "double-tap");
  });

  it("is a no-op off the native platform", () => {
    const trigger = vi.fn();
    const haptics = createComposerHandleHaptics({ trigger, isNativePlatform: false });

    haptics.onGrab();
    haptics.onMoveFrame();
    haptics.onRelease();
    haptics.onDoubleTap();

    expect(trigger).not.toHaveBeenCalled();
  });
});
