// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: runs mise as the daemon user to list, install, upgrade, and uninstall catalog tools.
import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { spawnProcess } from "../../utils/spawn.js";
import { type CatalogTool, TOOL_CATALOG, resolveToolNames } from "./tool-catalog.rambla.js";

export const MISE_NOT_FOUND_MESSAGE = "mise not found on the host";

export interface MiseResult {
  ok: boolean;
  output: string;
}

export interface ToolStatus extends CatalogTool {
  installed: string | null;
}

export type ListToolsResult = { ok: true; tools: ToolStatus[] } | { ok: false; output: string };

interface MiseRun {
  exitCode: number | null;
  stdout: string;
  output: string;
}

type MiseListing = Record<string, { version: string; installed: boolean }[]>;

/** Runs mise with the given arguments, keeping stdout and stdout+stderr in arrival order. */
function runMise(misePath: string, args: string[]): Promise<MiseRun> {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(misePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let output = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      output += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({ exitCode, stdout, output }));
  });
}

/** Runs one mise command and reports success with mise's output untouched. */
async function runMiseCommand(misePath: string, args: string[]): Promise<MiseResult> {
  const run = await runMise(misePath, args);
  return { ok: run.exitCode === 0, output: run.output };
}

/** Reads the installed version of each tool in mise's global config. */
async function readGlobalVersions(
  misePath: string,
): Promise<{ ok: true; versions: Map<string, string> } | { ok: false; output: string }> {
  // --global keeps a project mise config in the daemon's working directory out of the listing.
  const run = await runMise(misePath, ["ls", "--json", "--global"]);
  if (run.exitCode !== 0) return { ok: false, output: run.output };
  const listing = JSON.parse(run.stdout) as MiseListing;
  const versions = new Map<string, string>();
  for (const [name, entries] of Object.entries(listing)) {
    const entry = entries.find((candidate) => candidate.installed);
    if (entry) versions.set(name, entry.version);
  }
  return { ok: true, versions };
}

/** Lists every catalog tool with its installed version from mise's global config. */
export async function listTools(): Promise<ListToolsResult> {
  const misePath = await findExecutable("mise");
  if (!misePath) return { ok: false, output: MISE_NOT_FOUND_MESSAGE };
  const read = await readGlobalVersions(misePath);
  if (!read.ok) return read;
  const tools = TOOL_CATALOG.map((tool) => ({
    ...tool,
    installed: read.versions.get(tool.name) ?? null,
  }));
  return { ok: true, tools };
}

/** Installs the named tools at their pin, a given version, or latest, in mise's global config. */
export async function installTools(
  names: string[],
  options: { version?: string; latest?: boolean },
): Promise<MiseResult> {
  const resolved = resolveToolNames(names);
  if (!resolved.ok) return { ok: false, output: resolved.error };
  const misePath = await findExecutable("mise");
  if (!misePath) return { ok: false, output: MISE_NOT_FOUND_MESSAGE };
  const spec = (tool: CatalogTool) => (options.latest ? "latest" : (options.version ?? tool.pin));
  const specs = resolved.tools.map((tool) => `${tool.name}@${spec(tool)}`);
  return runMiseCommand(misePath, ["use", "--global", ...specs]);
}

/** Re-applies the pin, or latest, to installed catalog tools, limited to the named ones if given. */
export async function upgradeTools(
  names: string[],
  options: { latest?: boolean },
): Promise<MiseResult> {
  const resolved =
    names.length > 0 ? resolveToolNames(names) : { ok: true as const, tools: [...TOOL_CATALOG] };
  if (!resolved.ok) return { ok: false, output: resolved.error };
  const misePath = await findExecutable("mise");
  if (!misePath) return { ok: false, output: MISE_NOT_FOUND_MESSAGE };
  const read = await readGlobalVersions(misePath);
  if (!read.ok) return read;
  const specs = resolved.tools
    .filter((tool) => read.versions.has(tool.name))
    .map((tool) => `${tool.name}@${options.latest ? "latest" : tool.pin}`);
  if (specs.length === 0) return { ok: true, output: "" };
  return runMiseCommand(misePath, ["use", "--global", ...specs]);
}

/** Removes the named tools from mise's global config. */
export async function uninstallTools(names: string[]): Promise<MiseResult> {
  const resolved = resolveToolNames(names);
  if (!resolved.ok) return { ok: false, output: resolved.error };
  const misePath = await findExecutable("mise");
  if (!misePath) return { ok: false, output: MISE_NOT_FOUND_MESSAGE };
  return runMiseCommand(misePath, [
    "unuse",
    "--global",
    ...resolved.tools.map((tool) => tool.name),
  ]);
}
