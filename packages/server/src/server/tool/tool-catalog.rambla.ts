// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: the server tool catalog, named by mise registry short name with pinned versions.
export interface CatalogTool {
  name: string;
  pin: string;
  group: string | null;
  providerId: string | null;
}

export const TOOL_CATALOG: readonly CatalogTool[] = [
  { name: "claude", pin: "2.1.287", group: "agents", providerId: "claude" },
  { name: "codex", pin: "0.160.0", group: "agents", providerId: "codex" },
  { name: "copilot", pin: "1.0.91", group: "agents", providerId: "copilot" },
  { name: "opencode", pin: "1.18.34", group: "agents", providerId: "opencode" },
  { name: "pi", pin: "1.0.0", group: "agents", providerId: "pi" },
  { name: "gh", pin: "2.102.0", group: null, providerId: null },
  { name: "uv", pin: "0.12.22", group: null, providerId: null },
];

export type ResolveToolNamesResult =
  | { ok: true; tools: CatalogTool[] }
  | { ok: false; error: string };

/** Expands tool and group names into catalog tools, or names the valid choices on an unknown one. */
export function resolveToolNames(names: string[]): ResolveToolNamesResult {
  const tools: CatalogTool[] = [];
  for (const name of names) {
    const matches = TOOL_CATALOG.filter((tool) => tool.name === name || tool.group === name);
    if (matches.length === 0) {
      const groups = new Set(TOOL_CATALOG.flatMap((tool) => (tool.group ? [tool.group] : [])));
      const valid = [...groups, ...TOOL_CATALOG.map((tool) => tool.name)].join(", ");
      return { ok: false, error: `Unknown tool "${name}". Valid names: ${valid}` };
    }
    for (const tool of matches) {
      if (!tools.includes(tool)) tools.push(tool);
    }
  }
  return { ok: true, tools };
}
