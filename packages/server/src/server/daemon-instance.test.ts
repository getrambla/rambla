import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, uptime } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { readDaemonInstance, stopDaemonInstance } from "./daemon-instance.js";
import { acquirePidLock, getPidLockInfo, isLocked, type PidLockInfo } from "./pid-lock.js";

// A process cannot have started before the machine booted, so a lock stamped
// before this boot names a PID that some unrelated process now holds.
function bootedAt(): number {
  return Date.now() - uptime() * 1000;
}

async function writeLock(ramblaHome: string, lock: PidLockInfo): Promise<void> {
  await writeFile(join(ramblaHome, "rambla.pid"), JSON.stringify(lock));
}

function lockFor(pid: number, startedAt: Date): PidLockInfo {
  return {
    pid,
    startedAt: startedAt.toISOString(),
    hostname: "old-host",
    uid: process.getuid?.() ?? 0,
    listen: "127.0.0.1:6767",
    desktopManaged: true,
    heartbeat: true,
  };
}

describe("daemon instance identity across a reboot", () => {
  let ramblaHome: string;
  let bystander: ChildProcess | undefined;

  beforeEach(async () => {
    ramblaHome = await mkdtemp(join(tmpdir(), "rambla-daemon-instance-"));
  });

  afterEach(async () => {
    bystander?.kill("SIGKILL");
    bystander = undefined;
    await rm(ramblaHome, { recursive: true, force: true });
  });

  test("a lock stamped before this boot has no running owner", async () => {
    await writeLock(ramblaHome, lockFor(process.pid, new Date(bootedAt() - 60 * 60_000)));

    expect(await readDaemonInstance(ramblaHome)).toBeNull();
    expect(await isLocked(ramblaHome)).toMatchObject({ locked: false });
  });

  test("a supervisor started during this boot still holds the lock", async () => {
    await writeLock(ramblaHome, lockFor(process.pid, new Date()));

    expect(await readDaemonInstance(ramblaHome)).toMatchObject({ pid: process.pid });
    expect(await isLocked(ramblaHome)).toMatchObject({ locked: true });
  });

  test("a new supervisor takes over a lock stamped before this boot", async () => {
    await writeLock(ramblaHome, lockFor(process.pid, new Date(bootedAt() - 60 * 60_000)));

    await acquirePidLock(ramblaHome, null, { ownerPid: process.pid + 10_000 });

    expect(await getPidLockInfo(ramblaHome)).toMatchObject({ pid: process.pid + 10_000 });
  });

  test("stopping a lock stamped before this boot leaves the process holding that pid alone", async () => {
    // Records delivery rather than dying of it, so a signal cannot be missed by arriving late.
    const signalMarker = join(ramblaHome, "bystander-signalled");
    bystander = spawn(
      process.execPath,
      [
        "-e",
        `process.on("SIGTERM", () => require("node:fs").writeFileSync(${JSON.stringify(signalMarker)}, "SIGTERM"));` +
          `setTimeout(() => {}, 120_000);`,
      ],
      { stdio: "ignore" },
    );
    const bystanderPid = bystander.pid;
    if (bystanderPid === undefined) throw new Error("bystander process did not start");
    let exited = false;
    bystander.once("exit", () => {
      exited = true;
    });

    await writeLock(ramblaHome, lockFor(bystanderPid, new Date(bootedAt() - 60 * 60_000)));

    expect(await stopDaemonInstance(ramblaHome)).toMatchObject({ action: "not_running" });

    expect(existsSync(signalMarker)).toBe(false);
    expect(exited).toBe(false);
    await expect(readFile(join(ramblaHome, "rambla.pid"), "utf-8")).rejects.toThrow(/ENOENT/);
  });
});
