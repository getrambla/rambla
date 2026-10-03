// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: the rambla tool command group for mise installs on the daemon host.
import { Command, Option } from "commander";
import type { DaemonClient } from "@getrambla/client/internal/daemon-client";
import type { DaemonToolStatus } from "@getrambla/protocol/tool.rambla";
import type {
  CommandError,
  CommandOptions,
  ListResult,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";
import { connectToDaemon } from "../../utils/client.js";

interface ToolOptions extends CommandOptions {
  version?: string;
  latest?: boolean;
}

interface ToolChangeResult {
  ok: boolean;
  output: string;
}

const toolSchema: OutputSchema<DaemonToolStatus> = {
  idField: "name",
  columns: [
    { header: "TOOL", field: "name", width: 12 },
    { header: "GROUP", field: (tool) => tool.group ?? "-", width: 10 },
    { header: "PIN", field: "pin", width: 16 },
    { header: "INSTALLED", field: (tool) => tool.installed ?? "not installed", width: 16 },
  ],
};

const changeSchema: OutputSchema<ToolChangeResult> = {
  idField: (result) => (result.ok ? "ok" : "failed"),
  columns: [],
  // withOutput appends a newline, so drop the one mise ended with to print its output unchanged.
  renderHuman: (result) => (result.type === "single" ? result.data.output.replace(/\n$/, "") : ""),
};

/** Connects to the selected daemon, runs one tools call, and closes the connection. */
async function withToolClient<T>(
  options: ToolOptions,
  run: (client: DaemonClient) => Promise<T>,
): Promise<T> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    return await run(client);
  } finally {
    await client.close().catch(() => undefined);
  }
}

/** Runs a tools change and exits non-zero when mise did. */
async function runToolChange(
  options: ToolOptions,
  run: (client: DaemonClient) => Promise<ToolChangeResult>,
): Promise<SingleResult<ToolChangeResult>> {
  const { ok, output } = await withToolClient(options, run);
  if (!ok) process.exitCode = 1;
  return { type: "single", data: { ok, output }, schema: changeSchema };
}

/** Lists catalog tools with their group, pin, and installed version. */
export async function runToolListCommand(
  options: ToolOptions,
  _command: Command,
): Promise<ListResult<DaemonToolStatus>> {
  const payload = await withToolClient(options, (client) => client.listDaemonTools());
  if (!payload.ok)
    throw { code: "TOOL_LIST_FAILED", message: payload.output } satisfies CommandError;
  return { type: "list", data: payload.tools, schema: toolSchema };
}

/** Installs the named tools or groups at their pins, a given version, or the newest. */
export async function runToolInstallCommand(
  names: string[],
  options: ToolOptions,
  _command: Command,
): Promise<SingleResult<ToolChangeResult>> {
  return runToolChange(options, (client) =>
    client.installDaemonTools({
      names,
      ...(options.version ? { version: options.version } : {}),
      ...(options.latest ? { latest: true } : {}),
    }),
  );
}

/** Moves installed tools, or only the named ones, to their pins or the newest. */
export async function runToolUpgradeCommand(
  names: string[],
  options: ToolOptions,
  _command: Command,
): Promise<SingleResult<ToolChangeResult>> {
  return runToolChange(options, (client) =>
    client.upgradeDaemonTools({ names, ...(options.latest ? { latest: true } : {}) }),
  );
}

/** Uninstalls the named tools or groups. */
export async function runToolUninstallCommand(
  names: string[],
  options: ToolOptions,
  _command: Command,
): Promise<SingleResult<ToolChangeResult>> {
  return runToolChange(options, (client) => client.uninstallDaemonTools(names));
}

/** Builds the `rambla tool` command group. */
export function createToolCommand(): Command {
  const tool = new Command("tool").description("Manage tools on the daemon host through mise");
  // cli.ts gives tool a CLI --version flag; positional options leave install's --version to install.
  tool.enablePositionalOptions();
  addJsonAndDaemonHostOptions(
    tool.command("ls").description("List catalog tools with their pins and installed versions"),
  ).action(withOutput(runToolListCommand));
  addJsonAndDaemonHostOptions(
    tool
      .command("install")
      .description("Install tools or groups at their catalog pins")
      .argument("<names...>", "Tool or group names")
      .addOption(
        new Option("--version <version>", "Install this version instead of the pin").conflicts(
          "latest",
        ),
      )
      .option("--latest", "Install the newest version instead of the pin"),
  ).action(withOutput(runToolInstallCommand));
  addJsonAndDaemonHostOptions(
    tool
      .command("upgrade")
      .description("Move installed tools to their catalog pins")
      .argument("[names...]", "Tool or group names (default: every installed tool)")
      .option("--latest", "Move to the newest version instead of the pin"),
  ).action(withOutput(runToolUpgradeCommand));
  addJsonAndDaemonHostOptions(
    tool
      .command("uninstall")
      .description("Uninstall tools or groups")
      .argument("<names...>", "Tool or group names"),
  ).action(withOutput(runToolUninstallCommand));
  return tool;
}
