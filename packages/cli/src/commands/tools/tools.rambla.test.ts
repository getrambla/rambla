// RAMBLA-FORK: feature: 2026-10-02-feat-server-tools-install.md: tests the rambla tools CLI through a real client on a stand-in daemon.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonClient, type DaemonTransport } from "@getrambla/client/internal/daemon-client";

type SentMessage = { type: string } & Record<string, unknown>;

const daemon = {
  features: {} as Record<string, boolean>,
  result: { ok: true, output: "" },
  sent: [] as SentMessage[],
  tools: [
    { name: "claude", pin: "2.0.1", group: "agents", providerId: "claude", installed: "2.0.1" },
    { name: "gh", pin: "2.80.0", group: null, providerId: null, installed: null },
  ],
};

/** Connects a real DaemonClient to an in-memory daemon that records requests and answers tools RPCs. */
async function connectStandIn(): Promise<DaemonClient> {
  let onMessage: (data: unknown) => void = () => {};
  let onOpen: () => void = () => {};
  const reply = (message: unknown) => onMessage(JSON.stringify({ type: "session", message }));
  const transport: DaemonTransport = {
    send: (data) => {
      if (typeof data !== "string") return;
      const frame = JSON.parse(data) as { type?: string; message?: SentMessage };
      if (frame.type === "ping") {
        onMessage(JSON.stringify({ type: "pong" }));
        return;
      }
      if (frame.type !== "session" || !frame.message) return;
      const message = frame.message;
      daemon.sent.push(message);
      if (!message.type.startsWith("daemon.tools.")) return;
      const type = message.type.replace(/\.request$/, ".response");
      const payload = { requestId: message.requestId, ...daemon.result };
      reply({
        type,
        payload:
          type === "daemon.tools.list.response" ? { ...payload, tools: daemon.tools } : payload,
      });
    },
    close: () => {},
    onMessage: (handler) => {
      onMessage = (data) => handler(data, false);
      return () => {};
    },
    onOpen: (handler) => {
      onOpen = handler;
      return () => {};
    },
    onClose: () => () => {},
    onError: () => () => {},
  };
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_tools_test",
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    reconnect: { enabled: false },
    transportFactory: () => transport,
  });
  const connected = client.connect();
  onOpen();
  reply({
    type: "status",
    payload: {
      status: "server_info",
      serverId: "srv_tools_test",
      hostname: null,
      version: null,
      features: daemon.features,
    },
  });
  await connected;
  return client;
}

vi.mock("../../utils/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils/client.js")>()),
  connectToDaemon: vi.fn(async () => connectStandIn()),
}));

import { createCli } from "../../cli.js";
import { resolveCliVersion } from "../../version.js";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`exit ${code}`);
  }
}

/** Runs `rambla tools <args>` and captures stdout, stderr, and the exit code. */
async function runTools(args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
    vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new ExitSignal(Number(code ?? 0));
    }),
  ];
  process.exitCode = undefined;
  let exitCode: number;
  try {
    await createCli().parseAsync(["tools", ...args], { from: "user" });
    exitCode = Number(process.exitCode ?? 0);
  } catch (error) {
    if (!(error instanceof ExitSignal)) throw error;
    exitCode = error.code;
  } finally {
    for (const spy of spies) spy.mockRestore();
    process.exitCode = undefined;
  }
  return { stdout: stdout.join(""), stderr: stderr.join(""), exitCode };
}

/** Returns the tools requests the stand-in daemon received. */
function toolsRequests(): SentMessage[] {
  return daemon.sent.filter((message) => message.type.startsWith("daemon.tools."));
}

const HOST = ["--host", "example.test:12345"];

describe("rambla tools", () => {
  beforeEach(() => {
    daemon.features = { toolsInstall: true };
    daemon.result = { ok: true, output: "" };
    daemon.sent = [];
  });

  it("passes --version after install to the install request", async () => {
    const run = await runTools(["install", "claude", "--version", "1.2.3", ...HOST]);

    expect(run.exitCode).toBe(0);
    expect(toolsRequests()).toEqual([
      expect.objectContaining({
        type: "daemon.tools.install.request",
        names: ["claude"],
        version: "1.2.3",
      }),
    ]);
  });

  it("installs at the catalog pin by default and at the newest with --latest", async () => {
    await runTools(["install", "agents", "gh", ...HOST]);
    await runTools(["install", "uv", "--latest", ...HOST]);

    const [pinned, latest] = toolsRequests();
    expect(pinned).toMatchObject({ names: ["agents", "gh"] });
    expect(pinned).not.toHaveProperty("version");
    expect(pinned).not.toHaveProperty("latest");
    expect(latest).toMatchObject({ names: ["uv"], latest: true });
  });

  it("still prints the CLI version for tools --version", async () => {
    const run = await runTools(["--version"]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(`${resolveCliVersion()}\n`);
    expect(daemon.sent).toEqual([]);
  });

  it("rejects --version together with --latest before contacting the daemon", async () => {
    const run = await runTools(["install", "claude", "--version", "1.2.3", "--latest", ...HOST]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("cannot be used with");
    expect(daemon.sent).toEqual([]);
  });

  it("prints mise's output unchanged and exits zero when mise succeeds", async () => {
    daemon.result = { ok: true, output: "mise claude@2.0.1 ✓ installed\n" };

    const run = await runTools(["install", "claude", ...HOST]);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe("mise claude@2.0.1 ✓ installed\n");
  });

  it("prints mise's output unchanged and exits non-zero when mise fails", async () => {
    daemon.result = { ok: false, output: "mise ERROR no such version 9.9.9 for claude\n" };

    const run = await runTools(["install", "claude", "--version", "9.9.9", ...HOST]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stdout).toBe("mise ERROR no such version 9.9.9 for claude\n");
  });

  it("upgrades every installed tool with no names and only the named ones otherwise", async () => {
    await runTools(["upgrade", ...HOST]);
    await runTools(["upgrade", "claude", "--latest", ...HOST]);

    expect(toolsRequests()).toEqual([
      expect.objectContaining({ type: "daemon.tools.upgrade.request", names: [] }),
      expect.objectContaining({
        type: "daemon.tools.upgrade.request",
        names: ["claude"],
        latest: true,
      }),
    ]);
  });

  it("uninstalls the named tools and groups", async () => {
    const run = await runTools(["uninstall", "agents", "uv", ...HOST]);

    expect(run.exitCode).toBe(0);
    expect(toolsRequests()).toEqual([
      expect.objectContaining({ type: "daemon.tools.uninstall.request", names: ["agents", "uv"] }),
    ]);
  });

  it("lists every tool with its group, pin, and installed version", async () => {
    const run = await runTools(["ls", ...HOST]);

    expect(run.exitCode).toBe(0);
    expect(toolsRequests()).toEqual([
      expect.objectContaining({ type: "daemon.tools.list.request" }),
    ]);
    const claude = run.stdout.split("\n").find((line) => line.startsWith("claude"));
    const gh = run.stdout.split("\n").find((line) => line.startsWith("gh"));
    expect(claude?.trim().split(/\s+/)).toEqual(["claude", "agents", "2.0.1", "2.0.1"]);
    expect(gh).toMatch(/^gh\s+-\s+2\.80\.0\s+not installed\s*$/);
  });

  it("lists tools as JSON with --json", async () => {
    const run = await runTools(["ls", "--json", ...HOST]);

    expect(JSON.parse(run.stdout)).toEqual(daemon.tools);
  });

  it("prints the list failure and exits non-zero when mise is missing", async () => {
    daemon.result = { ok: false, output: "mise was not found on the host." };

    const run = await runTools(["ls", ...HOST]);

    expect(run.exitCode).not.toBe(0);
    expect(run.stderr).toContain("mise was not found on the host.");
  });

  it.each([["ls"], ["install", "claude"], ["upgrade"], ["uninstall", "claude"]])(
    "tells the user to update the host for `tools %s` and sends no tools request",
    async (...args) => {
      daemon.features = {};

      const run = await runTools([...args, ...HOST]);

      expect(run.exitCode).not.toBe(0);
      expect(run.stderr).toContain("Update the host");
      expect(toolsRequests()).toEqual([]);
    },
  );
});
