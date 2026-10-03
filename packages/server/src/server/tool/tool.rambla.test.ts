// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: tests the tool catalog and the mise wrapper against a stand-in mise.
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

import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import {
  requiredPermissionForInbound,
  requiredPermissionForOutbound,
} from "../authorization/operation-permissions.js";
import { dispatchToolMessage } from "./tool-session.rambla.js";

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
  dir = mkdtempSync(join(tmpdir(), "rambla-tool-"));
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

// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: tests the daemon.tool handlers, snapshot refresh, and permissions.
/** Dispatches tools messages, logging each snapshot refresh, warning, and emitted message in order. */
function handlerHarness(options: { refreshError?: Error } = {}) {
  const events: string[] = [];
  const emitted: SessionOutboundMessage[] = [];
  const warnings: { obj: unknown; msg?: string }[] = [];
  const snapshots = {
    refreshSettingsSnapshot: async (refresh?: { providers?: string[] }) => {
      events.push(`refresh:${(refresh?.providers ?? []).join(",")}`);
      if (options.refreshError) throw options.refreshError;
    },
  };
  const logger = {
    warn: (obj: unknown, msg?: string) => {
      events.push("warn");
      warnings.push({ obj, msg });
    },
  };
  const dispatch = (msg: SessionInboundMessage) =>
    dispatchToolMessage(
      msg,
      snapshots,
      (message) => {
        events.push(message.type);
        emitted.push(message);
      },
      logger,
    );
  return { events, emitted, warnings, dispatch };
}

describe("daemon.tool handlers", () => {
  test("list returns the mise listing", async () => {
    writeStandIn({ globalList: { claude: installed("2.0.0") } });
    const { emitted, events, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.list.request", requestId: "r1" });
    expect(emitted).toEqual([
      {
        type: "daemon.tool.list.response",
        payload: {
          requestId: "r1",
          ok: true,
          output: "",
          tools: TOOL_CATALOG.map((tool) => ({
            name: tool.name,
            pin: tool.pin,
            group: tool.group,
            providerId: tool.providerId,
            installed: tool.name === "claude" ? "2.0.0" : null,
          })),
        },
      },
    ]);
    expect(events).toEqual(["daemon.tool.list.response"]);
  });

  test("list without mise returns the not-found result", async () => {
    const { emitted, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.list.request", requestId: "r1" });
    expect(emitted).toEqual([
      {
        type: "daemon.tool.list.response",
        payload: { requestId: "r1", ok: false, output: MISE_NOT_FOUND_MESSAGE, tools: [] },
      },
    ]);
  });

  test("install returns the mise result and refreshes the provider before responding", async () => {
    writeStandIn({ stdout: "installed\n" });
    const { emitted, events, dispatch } = handlerHarness();
    await dispatch({
      type: "daemon.tool.install.request",
      requestId: "r2",
      names: ["claude"],
      version: "1.2.3",
    });
    expect(calls()).toEqual(["use --global claude@1.2.3"]);
    expect(emitted).toEqual([
      {
        type: "daemon.tool.install.response",
        payload: { requestId: "r2", ok: true, output: "installed\n" },
      },
    ]);
    expect(events).toEqual(["refresh:claude", "daemon.tool.install.response"]);
  });

  test("install passes latest through to mise", async () => {
    writeStandIn();
    const { dispatch } = handlerHarness();
    await dispatch({
      type: "daemon.tool.install.request",
      requestId: "r2",
      names: ["uv"],
      latest: true,
    });
    expect(calls()).toEqual(["use --global uv@latest"]);
  });

  test("installing the agents group refreshes all five providers", async () => {
    writeStandIn();
    const { events, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.install.request", requestId: "r2", names: ["agents"] });
    expect(events).toEqual([`refresh:${AGENTS.join(",")}`, "daemon.tool.install.response"]);
  });

  test("installing a non-provider tool refreshes nothing", async () => {
    writeStandIn();
    const { events, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.install.request", requestId: "r2", names: ["gh"] });
    expect(events).toEqual(["daemon.tool.install.response"]);
  });

  test("a failed install returns mise's output and refreshes nothing", async () => {
    const stderr = "mise ERROR failed to install claude@9.9.9\n";
    writeStandIn({ exitCode: 1, stderr });
    const { emitted, events, dispatch } = handlerHarness();
    await dispatch({
      type: "daemon.tool.install.request",
      requestId: "r2",
      names: ["claude"],
      version: "9.9.9",
    });
    expect(emitted).toEqual([
      {
        type: "daemon.tool.install.response",
        payload: { requestId: "r2", ok: false, output: stderr },
      },
    ]);
    expect(events).toEqual(["daemon.tool.install.response"]);
  });

  test("upgrade with names returns the mise result and refreshes those providers", async () => {
    writeStandIn({ stdout: "upgraded\n", globalList: { codex: installed("0.1.0") } });
    const { emitted, events, dispatch } = handlerHarness();
    await dispatch({
      type: "daemon.tool.upgrade.request",
      requestId: "r3",
      names: ["codex"],
      latest: true,
    });
    expect(calls()).toEqual(["ls --json --global", "use --global codex@latest"]);
    expect(emitted).toEqual([
      {
        type: "daemon.tool.upgrade.response",
        payload: { requestId: "r3", ok: true, output: "upgraded\n" },
      },
    ]);
    expect(events).toEqual(["refresh:codex", "daemon.tool.upgrade.response"]);
  });

  test("upgrade with no names refreshes every provider", async () => {
    writeStandIn({ globalList: { codex: installed("0.1.0") } });
    const { events, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.upgrade.request", requestId: "r3", names: [] });
    expect(events).toEqual([`refresh:${AGENTS.join(",")}`, "daemon.tool.upgrade.response"]);
  });

  test("uninstall returns the mise result and refreshes the provider before responding", async () => {
    writeStandIn({ stdout: "removed\n" });
    const { emitted, events, dispatch } = handlerHarness();
    await dispatch({ type: "daemon.tool.uninstall.request", requestId: "r4", names: ["pi"] });
    expect(calls()).toEqual(["unuse --global pi"]);
    expect(emitted).toEqual([
      {
        type: "daemon.tool.uninstall.response",
        payload: { requestId: "r4", ok: true, output: "removed\n" },
      },
    ]);
    expect(events).toEqual(["refresh:pi", "daemon.tool.uninstall.response"]);
  });

  test.each([
    {
      msg: { type: "daemon.tool.install.request", requestId: "r5", names: ["claude"] },
      responseType: "daemon.tool.install.response",
      globalList: {},
    },
    {
      msg: { type: "daemon.tool.upgrade.request", requestId: "r5", names: ["claude"] },
      responseType: "daemon.tool.upgrade.response",
      globalList: { claude: installed("0.1.0") },
    },
    {
      msg: { type: "daemon.tool.uninstall.request", requestId: "r5", names: ["claude"] },
      responseType: "daemon.tool.uninstall.response",
      globalList: {},
    },
  ] as const)(
    "$responseType keeps mise's success and logs a warning when the refresh throws",
    async ({ msg, responseType, globalList }) => {
      writeStandIn({ stdout: "done\n", globalList });
      const refreshError = new Error("refresh failed");
      const { emitted, events, warnings, dispatch } = handlerHarness({ refreshError });
      await dispatch({ ...msg, names: [...msg.names] });
      expect(emitted).toEqual([
        { type: responseType, payload: { requestId: "r5", ok: true, output: "done\n" } },
      ]);
      expect(events).toEqual(["refresh:claude", "warn", responseType]);
      expect(warnings).toEqual([
        {
          obj: { err: refreshError, providers: ["claude"] },
          msg: "Failed to refresh provider snapshots after tool change",
        },
      ]);
    },
  );

  test("other messages are left for the session", () => {
    const { dispatch } = handlerHarness();
    expect(dispatch({ type: "ping" } as SessionInboundMessage)).toBeUndefined();
  });
});

describe("daemon.tool permissions", () => {
  test("list requires daemon.read and the other three require daemon.manage", () => {
    const payload = { requestId: "r", ok: true, output: "" };
    expect(requiredPermissionForInbound("daemon.tool.list.request")).toBe("daemon.read");
    expect(requiredPermissionForInbound("daemon.tool.install.request")).toBe("daemon.manage");
    expect(requiredPermissionForInbound("daemon.tool.upgrade.request")).toBe("daemon.manage");
    expect(requiredPermissionForInbound("daemon.tool.uninstall.request")).toBe("daemon.manage");
    expect(
      requiredPermissionForOutbound({
        type: "daemon.tool.list.response",
        payload: { ...payload, tools: [] },
      }),
    ).toBe("daemon.read");
    for (const type of [
      "daemon.tool.install.response",
      "daemon.tool.upgrade.response",
      "daemon.tool.uninstall.response",
    ] as const) {
      expect(requiredPermissionForOutbound({ type, payload })).toBe("daemon.manage");
    }
  });
});
