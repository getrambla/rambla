// RAMBLA-FORK: feature: 2026-10-02-feat-server-tools-install.md: tests the tool catalog and the mise wrapper against a stand-in mise.
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { TOOL_CATALOG, resolveToolNames } from "./tool-catalog.rambla.js";
import {
  MISE_NOT_FOUND_MESSAGE,
  installTools,
  listTools,
  uninstallTools,
  upgradeTools,
} from "./mise.rambla.js";

const AGENTS = ["claude", "codex", "copilot", "opencode", "pi"];

let dir: string;
let logPath: string;
let originalPath: string | undefined;

interface StandIn {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  globalList?: Record<string, unknown>;
  projectList?: Record<string, unknown>;
}

/** Shell single-quotes a value for the stand-in script. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Writes a stand-in mise that logs its arguments and replies as told; uses shell builtins only. */
function writeStandIn(options: StandIn = {}): void {
  const globalList = JSON.stringify(options.globalList ?? {});
  const allList = JSON.stringify({ ...options.globalList, ...options.projectList });
  const script = [
    "#!/bin/sh",
    'if [ "$1" = "--version" ]; then printf "2026.9.17\\n"; exit 0; fi',
    `printf '%s\\n' "$*" >> ${quote(logPath)}`,
    'if [ "$1" = "ls" ]; then',
    `  case " $* " in *" --global "*) printf '%s' ${quote(globalList)} ;; *) printf '%s' ${quote(allList)} ;; esac`,
    "  exit 0",
    "fi",
    `printf '%s' ${quote(options.stdout ?? "")}`,
    `printf '%s' ${quote(options.stderr ?? "")} >&2`,
    `exit ${options.exitCode ?? 0}`,
  ].join("\n");
  const misePath = join(dir, "mise");
  writeFileSync(misePath, `${script}\n`);
  chmodSync(misePath, 0o755);
}

/** Returns each recorded mise invocation's argument line. */
function calls(): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
}

/** Returns the catalog pin for a tool name. */
function pin(name: string): string {
  const tool = TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) throw new Error(`no catalog entry ${name}`);
  return tool.pin;
}

/** Builds a mise JSON listing entry for an installed version. */
function installed(version: string): unknown[] {
  return [{ version, installed: true, active: true }];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rambla-tools-"));
  logPath = join(dir, "calls.log");
  originalPath = process.env.PATH;
  // Only the stand-in dir: the host's real mise must never be found.
  process.env.PATH = dir;
});

afterEach(() => {
  process.env.PATH = originalPath;
  rmSync(dir, { recursive: true, force: true });
});

describe("tool catalog", () => {
  test("lists the seven tools with pins, and the five agents carry their provider id", () => {
    expect(TOOL_CATALOG.map((tool) => tool.name)).toEqual([...AGENTS, "gh", "uv"]);
    for (const tool of TOOL_CATALOG) {
      expect(tool.pin).toMatch(/^\d+\.\d+\.\d+$/);
    }
    for (const name of AGENTS) {
      const tool = TOOL_CATALOG.find((entry) => entry.name === name);
      expect(tool?.group).toBe("agents");
      expect(tool?.providerId).toBe(name);
    }
  });

  test("a group name expands to its members", () => {
    const result = resolveToolNames(["agents", "gh"]);
    expect(result.ok && result.tools.map((tool) => tool.name)).toEqual([...AGENTS, "gh"]);
  });

  test("an unknown name is rejected with the valid names", () => {
    const result = resolveToolNames(["claude", "nope"]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("nope");
    for (const name of ["agents", ...AGENTS, "gh", "uv"]) {
      expect(result.error).toContain(name);
    }
  });
});

describe("mise wrapper", () => {
  test("install passes name@pin to mise's global use by default", async () => {
    writeStandIn({ stdout: "installed\n" });
    const result = await installTools(["claude", "gh"], {});
    expect(result).toEqual({ ok: true, output: "installed\n" });
    expect(calls()).toEqual([`use --global claude@${pin("claude")} gh@${pin("gh")}`]);
  });

  test("install passes name@X with a version", async () => {
    writeStandIn();
    await installTools(["claude"], { version: "1.2.3" });
    expect(calls()).toEqual(["use --global claude@1.2.3"]);
  });

  test("install passes name@latest with latest", async () => {
    writeStandIn();
    await installTools(["uv"], { latest: true });
    expect(calls()).toEqual(["use --global uv@latest"]);
  });

  test("install of a group installs every member", async () => {
    writeStandIn();
    await installTools(["agents"], {});
    expect(calls()).toEqual([
      `use --global ${AGENTS.map((name) => `${name}@${pin(name)}`).join(" ")}`,
    ]);
  });

  test("an unknown name fails with the valid names before mise runs", async () => {
    writeStandIn();
    const result = await installTools(["nope"], {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain("claude");
    expect(calls()).toEqual([]);
  });

  test("upgrade with no names re-applies the pin to every installed tool only", async () => {
    writeStandIn({ globalList: { codex: installed("0.1.0"), uv: installed("0.0.1") } });
    const result = await upgradeTools([], {});
    expect(result.ok).toBe(true);
    expect(calls()).toEqual([
      "ls --json --global",
      `use --global codex@${pin("codex")} uv@${pin("uv")}`,
    ]);
  });

  test("upgrade with names touches only the named installed tools", async () => {
    writeStandIn({
      globalList: { codex: installed("0.1.0"), uv: installed("0.0.1"), gh: installed("2.0.0") },
    });
    await upgradeTools(["uv", "claude"], {});
    expect(calls()).toEqual(["ls --json --global", `use --global uv@${pin("uv")}`]);
  });

  test("upgrade with latest passes name@latest", async () => {
    writeStandIn({ globalList: { gh: installed("2.0.0") } });
    await upgradeTools([], { latest: true });
    expect(calls()).toEqual(["ls --json --global", "use --global gh@latest"]);
  });

  test("upgrade rejects an unknown name before mise runs", async () => {
    writeStandIn();
    const result = await upgradeTools(["nope"], {});
    expect(result.ok).toBe(false);
    expect(calls()).toEqual([]);
  });

  test("uninstall passes the names to mise's global unuse", async () => {
    writeStandIn({ stdout: "removed\n" });
    const result = await uninstallTools(["gh", "uv"]);
    expect(result).toEqual({ ok: true, output: "removed\n" });
    expect(calls()).toEqual(["unuse --global gh uv"]);
  });

  test("uninstall rejects an unknown name before mise runs", async () => {
    writeStandIn();
    const result = await uninstallTools(["nope"]);
    expect(result.ok).toBe(false);
    expect(calls()).toEqual([]);
  });

  test("list reads installed versions from the global JSON listing only", async () => {
    writeStandIn({
      globalList: { claude: installed("2.0.0") },
      projectList: { gh: installed("2.50.0") },
    });
    const result = await listTools();
    expect(calls()).toEqual(["ls --json --global"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tools.map((tool) => [tool.name, tool.group, tool.pin, tool.installed])).toEqual(
      TOOL_CATALOG.map((tool) => [
        tool.name,
        tool.group,
        tool.pin,
        tool.name === "claude" ? "2.0.0" : null,
      ]),
    );
  });

  test("a missing mise yields the not-found result and runs nothing", async () => {
    expect(await installTools(["claude"], {})).toEqual({
      ok: false,
      output: MISE_NOT_FOUND_MESSAGE,
    });
    expect(await upgradeTools([], {})).toEqual({ ok: false, output: MISE_NOT_FOUND_MESSAGE });
    expect(await uninstallTools(["claude"])).toEqual({ ok: false, output: MISE_NOT_FOUND_MESSAGE });
    expect(await listTools()).toEqual({ ok: false, output: MISE_NOT_FOUND_MESSAGE });
    expect(MISE_NOT_FOUND_MESSAGE).toBe("mise not found on the host");
    expect(calls()).toEqual([]);
  });

  test("a non-zero exit returns failure with mise's output unchanged", async () => {
    const stderr = "mise ERROR failed to install claude@9.9.9\n  caused by: 404 — not found\n";
    writeStandIn({ exitCode: 3, stderr });
    const result = await installTools(["claude"], { version: "9.9.9" });
    expect(result).toEqual({ ok: false, output: stderr });
  });
});
