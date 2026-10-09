// RAMBLA-FORK: feature: 2026-10-09-merge-upstream-v0-11-1.md: Z.ai quota windows, stored-token discovery, and the GLM agent's session scope.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discover, fetchUsage } from "./usage.js";

const QUOTA_LIMIT_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

function mockFetch(handlers: Map<string, () => Response>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const key = url.toString();
    const handler = handlers.get(key);
    if (!handler) throw new Error(`Unmocked fetch: ${key}`);
    return handler();
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function recordingFetch(body: unknown): {
  fetchApi: typeof fetch;
  calls: Array<{ url: string; authorization: string | null }>;
} {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const fetchApi = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: url.toString(),
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return jsonResponse(body);
  }) as unknown as typeof fetch;
  return { fetchApi, calls };
}

function statusFetch(status: number): typeof fetch {
  return (async () => new Response(null, { status })) as unknown as typeof fetch;
}

function writeCredentials(configHome: string, token: string): string {
  const dir = join(configHome, "glm-acp-agent");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "credentials.json");
  writeFileSync(path, JSON.stringify({ z_ai_api_key: token }));
  return path;
}

const FIVE_HOUR_RESET = Date.UTC(2026, 9, 9, 18, 0, 0);
const WEEKLY_RESET = Date.UTC(2026, 9, 14, 0, 0, 0);
const TOKENS_RESET = Date.UTC(2026, 10, 1, 0, 0, 0);
const MCP_RESET = Date.UTC(2026, 10, 9, 0, 0, 0);

describe("glm usage source", () => {
  let homeDir: string;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "glm-usage-home-"));
    originalEnv = { ...process.env };
    process.env["HOME"] = homeDir;
    process.env["USERPROFILE"] = homeDir;
    process.env["XDG_CONFIG_HOME"] = join(homeDir, "xdg");
    delete process.env["ZAI_API_KEY"];
    delete process.env["GLM_API_KEY"];
  });

  afterEach(() => {
    rmSync(homeDir, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    for (const key in originalEnv) process.env[key] = originalEnv[key];
  });

  describe("fetchUsage", () => {
    it("maps all four quota limits to windows with reset times and drops unknown types", async () => {
      process.env["ZAI_API_KEY"] = "zai_raw_token";
      const { fetchApi, calls } = recordingFetch({
        data: {
          level: "pro",
          limits: [
            {
              type: "TOKENS_LIMIT",
              unit: 3,
              number: 5,
              percentage: 10,
              currentValue: 214,
              usage: 2000,
              nextResetTime: FIVE_HOUR_RESET,
            },
            {
              type: "TOKENS_LIMIT",
              unit: 6,
              number: 1,
              percentage: 33,
              currentValue: 1001,
              usage: 3000,
              nextResetTime: WEEKLY_RESET,
            },
            {
              type: "CREDIT_LIMIT",
              unit: 5,
              number: 1,
              percentage: 2,
              currentValue: 50,
              usage: 1000,
              nextResetTime: TOKENS_RESET,
            },
            {
              type: "TIME_LIMIT",
              unit: 5,
              number: 1,
              percentage: 6,
              currentValue: 13,
              usage: 200,
              nextResetTime: MCP_RESET,
            },
            { type: "SOMETHING_ELSE", percentage: 50 },
          ],
        },
      });

      const report = await fetchUsage({ store: "env", locator: "ZAI_API_KEY" }, fetchApi);

      expect(calls).toEqual([{ url: QUOTA_LIMIT_URL, authorization: "zai_raw_token" }]);
      expect(report.status).toBe("available");
      if (report.status !== "available") throw new Error("expected available");
      expect(report.planLabel).toBe("Pro");
      expect(report.windows).toEqual([
        expect.objectContaining({
          id: "five_hour",
          label: "5-hour",
          usedPct: 11,
          summary: true,
          resetsAt: new Date(FIVE_HOUR_RESET).toISOString(),
        }),
        expect.objectContaining({
          id: "weekly",
          label: "Weekly",
          usedPct: 34,
          summary: true,
          resetsAt: new Date(WEEKLY_RESET).toISOString(),
        }),
        expect.objectContaining({
          id: "tokens",
          label: "Token usage",
          usedPct: 5,
          resetsAt: new Date(TOKENS_RESET).toISOString(),
        }),
        expect.objectContaining({
          id: "mcp_monthly",
          label: "MCP (1 month)",
          usedPct: 7,
          resetsAt: new Date(MCP_RESET).toISOString(),
        }),
      ]);
      expect(report.windows[2]?.summary).toBeUndefined();
      expect(report.windows[3]?.summary).toBeUndefined();
    });

    it("reports the API's percentage when currentValue or usage is missing", async () => {
      process.env["ZAI_API_KEY"] = "zai_raw_token";
      const fetchApi = mockFetch(
        new Map([
          [
            QUOTA_LIMIT_URL,
            () =>
              jsonResponse({
                data: { limits: [{ type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 42 }] },
              }),
          ],
        ]),
      );

      const report = await fetchUsage({ store: "env", locator: "ZAI_API_KEY" }, fetchApi);

      if (report.status !== "available") throw new Error("expected available");
      expect(report.windows).toEqual([
        expect.objectContaining({ id: "five_hour", usedPct: 42, resetsAt: null }),
      ]);
    });

    it("reads the token from the stored credentials file", async () => {
      const path = writeCredentials(join(homeDir, "xdg"), "stored_token");
      const { fetchApi, calls } = recordingFetch({ data: { limits: [] } });

      const report = await fetchUsage({ store: "file", locator: path }, fetchApi);

      expect(report.status).toBe("available");
      expect(calls).toEqual([{ url: QUOTA_LIMIT_URL, authorization: "stored_token" }]);
    });

    it.each([401, 403])("reports a login rejected with HTTP %i", async (status) => {
      process.env["ZAI_API_KEY"] = "zai_raw_token";
      const report = await fetchUsage(
        { store: "env", locator: "ZAI_API_KEY" },
        statusFetch(status),
      );
      expect(report).toEqual({ status: "unavailable", problem: { kind: "rejected", status } });
    });
  });

  describe("global discovery", () => {
    it("finds ZAI_API_KEY first", async () => {
      process.env["ZAI_API_KEY"] = "a";
      process.env["GLM_API_KEY"] = "b";
      expect(await discover({ kind: "global" })).toEqual([
        { key: "default", input: { store: "env", locator: "ZAI_API_KEY" } },
      ]);
    });

    it("finds GLM_API_KEY", async () => {
      process.env["GLM_API_KEY"] = "b";
      expect(await discover({ kind: "global" })).toEqual([
        { key: "default", input: { store: "env", locator: "GLM_API_KEY" } },
      ]);
    });

    it("finds the stored credentials file with no env var", async () => {
      const path = writeCredentials(join(homeDir, "xdg"), "stored_token");
      expect(await discover({ kind: "global" })).toEqual([
        { key: "default", input: { store: "file", locator: path } },
      ]);
    });

    it("finds the stored credentials file under HOME/.config when XDG_CONFIG_HOME is unset", async () => {
      delete process.env["XDG_CONFIG_HOME"];
      const path = writeCredentials(join(homeDir, ".config"), "stored_token");
      expect(await discover({ kind: "global" })).toEqual([
        { key: "default", input: { store: "file", locator: path } },
      ]);
    });

    it("returns nothing with no env var and no credentials file", async () => {
      expect(await discover({ kind: "global" })).toEqual([]);
    });
  });

  describe("session discovery", () => {
    it("returns the file account under scope.env's XDG_CONFIG_HOME for a GLM model", async () => {
      const xdg = join(homeDir, "session-xdg");
      const path = writeCredentials(xdg, "stored_token");
      expect(
        await discover({
          kind: "session",
          provider: "acp",
          model: "glm-5.3",
          env: { XDG_CONFIG_HOME: xdg, HOME: join(homeDir, "elsewhere") },
        }),
      ).toEqual([{ key: "default", input: { store: "file", locator: path } }]);
    });

    it("returns the file account under scope.env's HOME/.config when XDG_CONFIG_HOME is unset", async () => {
      const sessionHome = join(homeDir, "session-home");
      const path = writeCredentials(join(sessionHome, ".config"), "stored_token");
      expect(
        await discover({
          kind: "session",
          provider: "acp",
          model: "glm-5.3",
          env: { HOME: sessionHome },
        }),
      ).toEqual([{ key: "default", input: { store: "file", locator: path } }]);
    });

    it("returns nothing when the session's config directory is empty", async () => {
      const xdg = join(homeDir, "empty-xdg");
      mkdirSync(xdg, { recursive: true });
      expect(
        await discover({
          kind: "session",
          provider: "acp",
          model: "glm-5.3",
          env: { XDG_CONFIG_HOME: xdg },
        }),
      ).toEqual([]);
    });

    it("never reads the daemon's stores or env vars in session scope", async () => {
      process.env["ZAI_API_KEY"] = "daemon_token";
      writeCredentials(join(homeDir, "xdg"), "daemon_stored");
      const xdg = join(homeDir, "empty-xdg");
      mkdirSync(xdg, { recursive: true });
      expect(
        await discover({
          kind: "session",
          provider: "acp",
          model: "glm-5.3",
          env: { XDG_CONFIG_HOME: xdg },
        }),
      ).toEqual([]);
    });

    it("returns nothing for provider acp with a non-GLM model", async () => {
      const xdg = join(homeDir, "session-xdg");
      writeCredentials(xdg, "stored_token");
      expect(
        await discover({
          kind: "session",
          provider: "acp",
          model: "gpt-5",
          env: { XDG_CONFIG_HOME: xdg },
        }),
      ).toEqual([]);
    });

    it("returns nothing for another provider", async () => {
      const xdg = join(homeDir, "session-xdg");
      writeCredentials(xdg, "stored_token");
      expect(
        await discover({
          kind: "session",
          provider: "claude",
          model: "glm-5.3",
          env: { XDG_CONFIG_HOME: xdg },
        }),
      ).toEqual([]);
    });
  });
});
