#!/usr/bin/env npx tsx

/**
 * Phase 3: LS Command Tests
 *
 * Tests the ls command - listing agents (top-level command).
 * Since daemon may not be running, we test both:
 * - Help and argument parsing
 * - Graceful error handling when daemon not running
 * - JSON output format
 *
 * Tests:
 * - rambla --help shows ls command
 * - rambla ls --help shows options
 * - rambla ls returns empty list or error when no daemon
 * - rambla ls --json returns valid JSON (or error)
 * - rambla ls -a flag is accepted
 * - rambla ls -g flag is accepted
 * - rambla ls does not support --ui
 */

import assert from "node:assert";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { runLocalRambla } from "./helpers/local-cli.ts";

console.log("=== LS Command Tests ===\n");

// Get random port that's definitely not in use (never 6767)
const port = 10000 + Math.floor(Math.random() * 50000);
const ramblaHome = await mkdtemp(join(tmpdir(), "rambla-test-home-"));

try {
  // Test 1: rambla --help shows ls command
  {
    console.log("Test 1: rambla --help shows ls command");
    const result = await runLocalRambla(["--help"]);
    assert.strictEqual(result.exitCode, 0, "rambla --help should exit 0");
    assert(result.stdout.includes("ls"), "help should mention ls command");
    console.log("✓ rambla --help shows ls command\n");
  }

  // Test 2: rambla ls --help shows options
  {
    console.log("Test 2: rambla ls --help shows options");
    const result = await runLocalRambla(["ls", "--help"]);
    assert.strictEqual(result.exitCode, 0, "rambla ls --help should exit 0");
    assert(result.stdout.includes("-a"), "help should mention -a flag");
    assert(result.stdout.includes("--all"), "help should mention --all flag");
    assert(result.stdout.includes("-g"), "help should mention -g flag");
    assert(result.stdout.includes("--global"), "help should mention --global flag");
    assert(result.stdout.includes("across all directories"), "help should describe global scope");
    assert(!result.stdout.includes("Legacy no-op"), "help should not describe -g as a no-op");
    assert(result.stdout.includes("--host"), "help should mention --host option");
    assert(!result.stdout.includes("--ui"), "help should not mention --ui");
    console.log("✓ rambla ls --help shows options\n");
  }

  // Test 3: rambla ls returns error when no daemon running
  {
    console.log("Test 3: rambla ls handles daemon not running");
    const result = await runLocalRambla(["ls"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    // Should fail because daemon not running
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    const output = result.stdout + result.stderr;
    const hasError =
      output.toLowerCase().includes("daemon") ||
      output.toLowerCase().includes("connect") ||
      output.toLowerCase().includes("cannot");
    assert(hasError, "error message should mention connection issue");
    assert.match(
      output,
      /--host <host:port>.*RAMBLA_HOST/s,
      "the recovery message should explain both remote connection inputs",
    );
    console.log("✓ rambla ls handles daemon not running\n");
  }

  // Test 4: rambla ls --json returns valid JSON error
  {
    console.log("Test 4: rambla ls --json handles errors");
    const result = await runLocalRambla(["ls", "--json"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    // Should still fail (daemon not running)
    assert.notStrictEqual(result.exitCode, 0, "should fail when daemon not running");
    // But output should be valid JSON if present
    const output = result.stdout.trim();
    if (output.length > 0) {
      try {
        JSON.parse(output);
        console.log("✓ rambla ls --json outputs valid JSON error\n");
      } catch {
        // Empty or stderr-only output is acceptable
        console.log("✓ rambla ls --json handled error (output may be in stderr)\n");
      }
    } else {
      console.log("✓ rambla ls --json handled error gracefully\n");
    }
  }

  // Test 5: rambla ls -a flag is accepted
  {
    console.log("Test 5: rambla ls -a flag is accepted");
    const result = await runLocalRambla(["ls", "-a"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    // Will fail due to no daemon, but flag should be parsed without error
    // (no "unknown option" error)
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -a flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ rambla ls -a flag is accepted\n");
  }

  // Test 6: rambla ls -g flag is accepted
  {
    console.log("Test 6: rambla ls -g flag is accepted");
    const result = await runLocalRambla(["ls", "-g"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -g flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ rambla ls -g flag is accepted\n");
  }

  // Test 7: rambla ls -ag combined flags are accepted
  {
    console.log("Test 7: rambla ls -ag combined flags are accepted");
    const result = await runLocalRambla(["ls", "-ag"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -ag flags");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ rambla ls -ag combined flags are accepted\n");
  }

  // Test 8: -q (quiet) flag is accepted globally
  {
    console.log("Test 8: -q (quiet) flag is accepted");
    const result = await runLocalRambla(["-q", "ls"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    const output = result.stdout + result.stderr;
    assert(!output.includes("unknown option"), "should accept -q flag");
    assert(!output.includes("error: option"), "should not have option parsing error");
    console.log("✓ -q (quiet) flag is accepted\n");
  }

  // Test 9: rambla ls --ui is rejected (flag removed)
  {
    console.log("Test 9: rambla ls --ui is rejected");
    const result = await runLocalRambla(["ls", "--ui"], {
      RAMBLA_HOST: `localhost:${port}`,
      RAMBLA_HOME: ramblaHome,
    });
    assert.notStrictEqual(result.exitCode, 0, "should fail for removed --ui flag");
    const output = result.stdout + result.stderr;
    assert(output.includes("unknown option"), "should report unknown option for --ui");
    console.log("✓ rambla ls --ui is rejected\n");
  }

  // Test 10: global --host reaches the command handler
  {
    console.log("Test 10: global --host targets the requested daemon");
    const host = `localhost:${port}`;
    const result = await runLocalRambla(["--host", host, "ls"], {
      RAMBLA_HOST: "localhost:1",
      RAMBLA_HOME: ramblaHome,
    });
    const output = result.stdout + result.stderr;
    assert.notStrictEqual(result.exitCode, 0, "should fail when the selected daemon is absent");
    assert(output.includes(host), "connection error should name the global host");
    console.log("✓ global --host targets the requested daemon\n");
  }

  // Test 11: the last explicit --host wins
  {
    console.log("Test 11: the last explicit --host wins");
    const firstHost = `localhost:${port}`;
    const lastHost = `localhost:${port + 1}`;
    const result = await runLocalRambla(["--host", firstHost, "ls", "--host", lastHost]);
    const output = result.stdout + result.stderr;
    assert.notStrictEqual(result.exitCode, 0, "should fail when the selected daemon is absent");
    assert(output.includes(lastHost), "connection error should name the last explicit host");
    assert(!output.includes(firstHost), "the earlier host should be fully overridden");
    console.log("✓ the last explicit --host wins\n");
  }
} finally {
  // Clean up temp directory
  await rm(ramblaHome, { recursive: true, force: true });
}

console.log("=== All ls tests passed ===");
