import { describe, expect, it } from "vitest";

// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: unit tests for the pure composer height bounds function.

import { computeComposerHeightBounds } from "./composer-height-bounds.rambla";

describe("composer height bounds min", () => {
  it("scales min with the font setting", () => {
    const min10 = computeComposerHeightBounds({
      fontSize: 10,
      verticalPadding: 12,
      borderWidth: 1,
      usableAreaTop: 400,
    }).min;
    const min15 = computeComposerHeightBounds({
      fontSize: 15,
      verticalPadding: 12,
      borderWidth: 1,
      usableAreaTop: 400,
    }).min;
    const min21 = computeComposerHeightBounds({
      fontSize: 21,
      verticalPadding: 12,
      borderWidth: 1,
      usableAreaTop: 400,
    }).min;
    expect(min10).toBe(10 * 1.4 + 12 * 2 + 1 * 2);
    expect(min15).toBe(15 * 1.4 + 12 * 2 + 1 * 2);
    expect(min21).toBe(21 * 1.4 + 12 * 2 + 1 * 2);
    expect(min10).toBeLessThan(min15);
    expect(min15).toBeLessThan(min21);
  });

  it("scales min with the wrapper's resolved vertical padding and border", () => {
    const base = computeComposerHeightBounds({
      fontSize: 15,
      verticalPadding: 12,
      borderWidth: 1,
      usableAreaTop: 400,
    }).min;
    const morePadding = computeComposerHeightBounds({
      fontSize: 15,
      verticalPadding: 20,
      borderWidth: 1,
      usableAreaTop: 400,
    }).min;
    const thickerBorder = computeComposerHeightBounds({
      fontSize: 15,
      verticalPadding: 12,
      borderWidth: 3,
      usableAreaTop: 400,
    }).min;
    expect(morePadding).toBe(base + 8 * 2);
    expect(thickerBorder).toBe(base + 2 * 2);
  });
});

describe("composer height bounds max", () => {
  it("equals exactly the measured usable-area top", () => {
    const bounds = computeComposerHeightBounds({
      fontSize: 15,
      verticalPadding: 12,
      borderWidth: 1,
      usableAreaTop: 437,
    });
    expect(bounds.max).toBe(437);
  });
});
