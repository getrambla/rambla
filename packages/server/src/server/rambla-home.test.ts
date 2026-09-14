import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

import { resolveRamblaHome } from "./rambla-home.js";
describe("resolveRamblaHome", () => {
  test("resolves RAMBLA_HOME without creating it", () => {
    const parent = mkdtempSync(path.join(tmpdir(), "rambla-home-parent-"));
    const ramblaHome = path.join(parent, "home");
    try {
      expect(resolveRamblaHome({ RAMBLA_HOME: ramblaHome })).toBe(ramblaHome);
      expect(existsSync(ramblaHome)).toBe(false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
