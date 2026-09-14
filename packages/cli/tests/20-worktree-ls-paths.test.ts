#!/usr/bin/env npx tsx

import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveRamblaHomePath, resolveRamblaWorktreesDir } from "../src/commands/worktree/ls.js";

console.log("=== Worktree LS Path Helper Tests ===\n");

const originalRamblaHome = process.env.RAMBLA_HOME;

try {
  {
    console.log("Test 1: resolves explicit RAMBLA_HOME when set");
    process.env.RAMBLA_HOME = "/tmp/paseo-explicit-home";

    assert.strictEqual(resolveRamblaHomePath(), "/tmp/paseo-explicit-home");
    assert.strictEqual(resolveRamblaWorktreesDir(), "/tmp/paseo-explicit-home/worktrees");
    console.log("\u2713 explicit RAMBLA_HOME is respected\n");
  }

  {
    console.log("Test 2: falls back to homedir/.rambla when RAMBLA_HOME is unset");
    delete process.env.RAMBLA_HOME;

    assert.strictEqual(resolveRamblaHomePath(), join(homedir(), ".rambla"));
    assert.strictEqual(resolveRamblaWorktreesDir(), join(homedir(), ".rambla", "worktrees"));
    console.log("\u2713 fallback home path is derived from os.homedir()\n");
  }
} finally {
  if (originalRamblaHome === undefined) {
    delete process.env.RAMBLA_HOME;
  } else {
    process.env.RAMBLA_HOME = originalRamblaHome;
  }
}

console.log("=== All worktree ls path helper tests passed ===");
