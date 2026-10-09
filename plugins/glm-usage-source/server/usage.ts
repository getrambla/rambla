// RAMBLA-FORK: feature: 2026-10-09-merge-upstream-v0-11-1.md: Z.ai quota-limit windows with reset times, the stored glm-acp-agent token, and the GLM agent's session scope.
import type { UsageInput } from "../shared/input.js";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  unavailable,
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
  type UsageWindow,
} from "@getrambla/plugin/server/usage";

const QUOTA_LIMIT_URL = "https://api.z.ai/api/monitor/usage/quota/limit";

const QuotaLimitSchema = z
  .object({
    type: z.string(),
    unit: z.number().optional(),
    number: z.number().optional(),
    percentage: z.number().catch(0),
    currentValue: z.number().optional(),
    usage: z.number().optional(),
    nextResetTime: z.number().optional(),
  })
  .passthrough();

const QuotaResponseSchema = z.object({
  data: z
    .object({
      level: z.string().optional(),
      limits: z.array(QuotaLimitSchema).optional(),
    })
    .optional(),
});

/** Where `glm-acp-agent --setup` stores its token, under a config home. */
function credentialsPath(configHome: string): string {
  return join(configHome, "glm-acp-agent", "credentials.json");
}

function readToken(input: UsageInput): string | null {
  if (input.store === "env") return process.env[input.locator] || null;
  try {
    const parsed = JSON.parse(readFileSync(input.locator, "utf-8")) as { z_ai_api_key?: unknown };
    return typeof parsed.z_ai_api_key === "string" && parsed.z_ai_api_key.length > 0
      ? parsed.z_ai_api_key
      : null;
  } catch {
    return null;
  }
}

/** Map a quota limit entry to a display window; null for unknown types. */
function windowFor(limit: z.infer<typeof QuotaLimitSchema>): UsageWindow | null {
  let id: string;
  let label: string;
  let summary = false;
  if (limit.type === "TOKENS_LIMIT" || limit.type === "CREDIT_LIMIT") {
    if (limit.unit === 3 && limit.number === 5) {
      id = "five_hour";
      label = "5-hour";
      summary = true;
    } else if (limit.unit === 6 && limit.number === 1) {
      id = "weekly";
      label = "Weekly";
      summary = true;
    } else {
      id = "tokens";
      label = "Token usage";
    }
  } else if (limit.type === "TIME_LIMIT") {
    id = "mcp_monthly";
    label = "MCP (1 month)";
  } else {
    return null;
  }
  // The API floors `percentage` (214/2000 ships as 10%); compute and round up.
  const usedPct =
    typeof limit.currentValue === "number" && typeof limit.usage === "number" && limit.usage > 0
      ? Math.ceil((limit.currentValue / limit.usage) * 100)
      : limit.percentage;
  return windowFromUsedPct({
    id,
    label,
    summary,
    utilizationPct: usedPct,
    resetsAt:
      limit.nextResetTime && limit.nextResetTime > 0
        ? new Date(limit.nextResetTime).toISOString()
        : null,
  });
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  const token = readToken(input);
  if (!token) throw new Error("Z.ai login store no longer exists");

  // The monitor API takes the raw token — no "Bearer" prefix.
  const res = await fetchApi(QUOTA_LIMIT_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: token,
      Accept: "application/json",
      "Accept-Language": "en-US,en",
    },
  });

  if (res.status === 401 || res.status === 403)
    return unavailable({ kind: "rejected", status: res.status });
  if (!res.ok) throw new Error(`Z.ai usage API returned ${res.status}`);

  const resp = QuotaResponseSchema.parse(await res.json());
  const level = resp.data?.level;
  const windows: UsageWindow[] = [];
  for (const limit of resp.data?.limits ?? []) {
    const window = windowFor(limit);
    if (window) windows.push(window);
  }

  return {
    status: "available",
    planLabel:
      typeof level === "string" && level.length > 0
        ? level.charAt(0).toUpperCase() + level.slice(1)
        : undefined,
    windows,
    balances: [],
    details: [],
  };
}

export async function discover(scope: UsageScope): Promise<UsageAccount[]> {
  if (scope.kind === "session") return discoverSession(scope);
  const candidates: UsageInput[] = [
    { store: "env", locator: "ZAI_API_KEY" },
    { store: "env", locator: "GLM_API_KEY" },
    {
      store: "file",
      locator: credentialsPath(process.env.XDG_CONFIG_HOME || join(homedir(), ".config")),
    },
  ];
  for (const input of candidates) if (readToken(input)) return [{ key: "default", input }];
  return [];
}

/** The GLM agent is a custom ACP provider; resolve its login from its own launch env only. */
function discoverSession(scope: Extract<UsageScope, { kind: "session" }>): UsageAccount[] {
  if (scope.provider !== "acp" || !scope.model?.startsWith("glm-")) return [];
  const configHome =
    scope.env.XDG_CONFIG_HOME || (scope.env.HOME && join(scope.env.HOME, ".config"));
  if (!configHome) return [];
  const locator = credentialsPath(configHome);
  return existsSync(locator) ? [{ key: "default", input: { store: "file", locator } }] : [];
}
