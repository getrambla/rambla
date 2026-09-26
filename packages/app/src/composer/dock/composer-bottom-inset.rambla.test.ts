import { describe, expect, it } from "vitest";
import { getComposerBottomInset } from "./composer-bottom-inset.rambla";

describe("composer bottom inset", () => {
  it("reduces the raw 34pt safe-area inset", () => {
    expect(getComposerBottomInset(34)).toBeLessThan(34);
  });

  it("keeps a small positive clearance on a 34pt device", () => {
    expect(getComposerBottomInset(34)).toBeGreaterThan(0);
  });

  it("yields zero when the safe-area inset is zero", () => {
    expect(getComposerBottomInset(0)).toBe(0);
  });
});
