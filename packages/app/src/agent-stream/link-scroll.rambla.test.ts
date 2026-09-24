// RAMBLA-FORK: fix: 2026-09-24-fix-ios-link-scroll-gate.md: covers the link-scroll gate flag round-trip.
import { describe, expect, it } from "vitest";

import { isLinkScrollActive, setLinkScrollActive } from "./link-scroll.rambla";

describe("link-scroll gate", () => {
  it("defaults to inactive", () => {
    expect(isLinkScrollActive()).toBe(false);
  });

  it("round-trips set and clear", () => {
    setLinkScrollActive(true);
    expect(isLinkScrollActive()).toBe(true);
    setLinkScrollActive(false);
    expect(isLinkScrollActive()).toBe(false);
  });
});
