#!/usr/bin/env npx tsx

/**
 * Regression: `rambla daemon stop` must stop supervised dev daemons
 * without allowing the supervisor entrypoint to respawn a new worker process.
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "zx";
import { getAvailablePort } from "./helpers/network.ts";

$.verbose = false;

const pollIntervalMs = 100;
const testEnv = {
  RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD: process.env.RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD ?? "0",
  RAMBLA_DICTATION_ENABLED: process.env.RAMBLA_DICTATION_ENABLED ?? "0",
  RAMBLA_VOICE_MODE_ENABLED: process.env.RAMBLA_VOICE_MODE_ENABLED ?? "0",
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface PidLockState {
  pid: number | null;
}

async function readPidLockState(ramblaHome: string): Promise<PidLockState> {
  const pidPath = join(ramblaHome, "rambla.pid");

  try {
    const content = await readFile(pidPath, "utf-8");
    const parsed = JSON.parse(content) as { pid?: unknown };
    const pid =
      typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
        ? parsed.pid
        : null;
    return { pid };
  } catch {
    return { pid: null };
  }
}

interface DaemonStatus {
  localDaemon: string | null;
  pid: number | null;
}

async function readDaemonStatus(ramblaHome: string): Promise<DaemonStatus> {
  const result =
    await $`RAMBLA_HOME=${ramblaHome} RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD} RAMBLA_DICTATION_ENABLED=${testEnv.RAMBLA_DICTATION_ENABLED} RAMBLA_VOICE_MODE_ENABLED=${testEnv.RAMBLA_VOICE_MODE_ENABLED} npx rambla daemon status --home ${ramblaHome} --json`.nothrow();
  if (result.exitCode !== 0) {
    return { localDaemon: null, pid: null };
  }

  try {
    const parsed = JSON.parse(result.stdout) as { localDaemon?: unknown; pid?: unknown };
    const localDaemon = typeof parsed.localDaemon === "string" ? parsed.localDaemon : null;
    const pid =
      typeof parsed.pid === "number" && Number.isInteger(parsed.pid) && parsed.pid > 0
        ? parsed.pid
        : null;
    return { localDaemon, pid };
  } catch {
    return { localDaemon: null, pid: null };
  }
}

async function readCapturedSupervisorLogs(ramblaHome: string, recentLogs: string): Promise<string> {
  const durableLogs = await readFile(join(ramblaHome, "daemon.log"), "utf8").catch(() => "");
  return `${recentLogs}\n${durableLogs}`;
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  async function poll(): Promise<void> {
    if (await check()) return;
    if (Date.now() >= deadline) throw new Error(message);
    await sleep(pollIntervalMs);
    return poll();
  }

  return poll();
}

console.log("=== Daemon Stop (supervisor regression) ===\n");

const port = await getAvailablePort();
const ramblaHome = await mkdtemp(join(tmpdir(), "rambla-stop-supervisor-"));
const cliRoot = join(import.meta.dirname, "..");

let supervisorProcess: ChildProcess | null = null;
let recentSupervisorLogs = "";

try {
  console.log("Test 1: start supervisor-entrypoint in dev mode with isolated RAMBLA_HOME");

  supervisorProcess = spawn(
    process.execPath,
    ["--import", "tsx", "../server/scripts/supervisor-entrypoint.ts", "--dev"],
    {
      cwd: cliRoot,
      env: {
        ...process.env,
        ...testEnv,
        RAMBLA_HOME: ramblaHome,
        RAMBLA_LISTEN: `127.0.0.1:${port}`,
        RAMBLA_RELAY_ENABLED: "false",
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  supervisorProcess.stdout?.on("data", (chunk) => {
    recentSupervisorLogs = (recentSupervisorLogs + chunk.toString()).slice(-8000);
  });
  supervisorProcess.stderr?.on("data", (chunk) => {
    recentSupervisorLogs = (recentSupervisorLogs + chunk.toString()).slice(-8000);
  });

  await waitFor(
    async () => {
      const status = await readDaemonStatus(ramblaHome);
      return (
        status.localDaemon === "running" && status.pid !== null && isProcessRunning(status.pid)
      );
    },
    120000,
    "daemon did not become running in time",
  );

  const statusBeforeStop = await readDaemonStatus(ramblaHome);
  const daemonPid = statusBeforeStop.pid;
  assert.strictEqual(
    statusBeforeStop.localDaemon,
    "running",
    "daemon should be running before stop",
  );
  assert(daemonPid !== null, "daemon pid should exist once daemon starts");
  assert(isProcessRunning(daemonPid), "daemon process should be running");
  const pidLockBeforeStop = await readPidLockState(ramblaHome);
  assert.strictEqual(pidLockBeforeStop.pid, daemonPid, "pid lock should match status pid");
  assert.strictEqual(
    daemonPid,
    supervisorProcess.pid,
    "pid lock pid should be the supervisor-entrypoint process",
  );
  console.log(`✓ dev daemon started with daemon pid ${daemonPid}\n`);

  console.log("Test 2: `rambla daemon stop` should stop without respawn");
  const stopResult =
    await $`RAMBLA_HOME=${ramblaHome} RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD} RAMBLA_DICTATION_ENABLED=${testEnv.RAMBLA_DICTATION_ENABLED} RAMBLA_VOICE_MODE_ENABLED=${testEnv.RAMBLA_VOICE_MODE_ENABLED} npx rambla daemon stop --home ${ramblaHome} --json`.nothrow();
  assert.strictEqual(stopResult.exitCode, 0, `stop should succeed: ${stopResult.stderr}`);
  const stopJson = JSON.parse(stopResult.stdout) as { action?: unknown };
  assert.strictEqual(stopJson.action, "stopped", "stop should report stopped action");

  await waitFor(
    async () => {
      const status = await readDaemonStatus(ramblaHome);
      return status.localDaemon === "stopped";
    },
    15000,
    "daemon status did not transition to stopped after stop",
  );

  if (supervisorProcess.pid) {
    await waitFor(
      () => !isProcessRunning(supervisorProcess!.pid ?? -1),
      15000,
      "supervisor-entrypoint process remained running after stop",
    );
  }

  await sleep(1000);

  const pidAfterStop = await readPidLockState(ramblaHome);
  const respawned = pidAfterStop.pid !== null && isProcessRunning(pidAfterStop.pid);
  assert.strictEqual(
    respawned,
    false,
    `daemon respawned after stop (pid: ${pidAfterStop.pid ?? "unknown"})`,
  );

  const statusAfterStop = await readDaemonStatus(ramblaHome);
  assert.strictEqual(
    statusAfterStop.localDaemon,
    "stopped",
    "daemon should remain stopped after stop command",
  );
  const capturedSupervisorLogs = await readCapturedSupervisorLogs(ramblaHome, recentSupervisorLogs);
  assert(
    capturedSupervisorLogs.includes('"msg":"Worker requested shutdown"') &&
      capturedSupervisorLogs.includes('"reason":"client_shutdown_rpc"'),
    `stop should log lifecycle shutdown reason from daemon worker, logs:\n${capturedSupervisorLogs}`,
  );
  assert(
    capturedSupervisorLogs.includes('"msg":"Supervisor requesting graceful worker shutdown"'),
    `stop should log the graceful worker shutdown request, logs:\n${capturedSupervisorLogs}`,
  );
  assert(
    capturedSupervisorLogs.includes("Server closed"),
    `stop should run daemon cleanup before the worker exits, logs:\n${capturedSupervisorLogs}`,
  );
  assert(
    !capturedSupervisorLogs.includes("cli_shutdown"),
    `supervisor logs should not route shutdown by reason string:\n${capturedSupervisorLogs}`,
  );
  console.log("✓ stop leaves supervised daemon stopped (no respawn)\n");
} finally {
  if (supervisorProcess?.pid && isProcessRunning(supervisorProcess.pid)) {
    supervisorProcess.kill("SIGTERM");
    await waitFor(
      () => !isProcessRunning(supervisorProcess!.pid ?? -1),
      5000,
      "supervisor cleanup timed out",
    ).catch(() => {
      supervisorProcess?.kill("SIGKILL");
    });
  }

  await $`RAMBLA_HOME=${ramblaHome} RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD=${testEnv.RAMBLA_LOCAL_SPEECH_AUTO_DOWNLOAD} RAMBLA_DICTATION_ENABLED=${testEnv.RAMBLA_DICTATION_ENABLED} RAMBLA_VOICE_MODE_ENABLED=${testEnv.RAMBLA_VOICE_MODE_ENABLED} npx rambla daemon stop --home ${ramblaHome} --force`.nothrow();
  await rm(ramblaHome, { recursive: true, force: true });
}

if (recentSupervisorLogs.trim().length === 0) {
  // Keep output stable while still surfacing that logs were captured when needed.
  console.log("(no supervisor logs captured)");
}

console.log("=== Supervisor stop regression test passed ===");
