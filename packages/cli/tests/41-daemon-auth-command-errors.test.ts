#!/usr/bin/env npx tsx

import assert from "node:assert";
import { runLocalRambla } from "./helpers/local-cli.ts";
import { startTestDaemon } from "./helpers/test-daemon.ts";

console.log("=== Daemon Auth Command Errors ===\n");

const daemon = await startTestDaemon({
  env: { RAMBLA_PASSWORD: "shared-secret" },
});

async function lsError(password: string, remoteClient = false) {
  const result = await runLocalRambla(["ls", "--json"], {
    RAMBLA_HOME: remoteClient ? "" : daemon.ramblaHome,
    RAMBLA_HOST: remoteClient ? `127.0.0.1:${daemon.port}` : "",
    RAMBLA_PASSWORD: password,
  });
  assert.notStrictEqual(result.exitCode, 0, "ls should fail without a valid password");
  return JSON.parse(result.stderr).error as {
    code: string;
    message: string;
    details: string;
  };
}

try {
  {
    console.log("Test 1: a client outside the daemon home needs RAMBLA_PASSWORD");
    const error = await lsError("", true);
    assert.strictEqual(error.code, "AUTH_REQUIRED");
    assert.match(error.message, /Password required/);
    assert.match(error.details, /RAMBLA_PASSWORD/);
    assert.doesNotMatch(error.details, /daemon start/);
    console.log("✓ client without the local credential is asked for RAMBLA_PASSWORD\n");
  }

  {
    console.log("Test 2: wrong password asks for RAMBLA_PASSWORD, not a daemon start");
    const error = await lsError("wrong-secret");
    assert.strictEqual(error.code, "AUTH_FAILED");
    assert.match(error.message, /Incorrect password/);
    assert.match(error.details, /RAMBLA_PASSWORD/);
    assert.doesNotMatch(error.details, /daemon start/);
    console.log("✓ wrong password points at RAMBLA_PASSWORD\n");
  }
} finally {
  await daemon.stop();
}

console.log("=== Daemon Auth Command Errors Tests Passed ===");
