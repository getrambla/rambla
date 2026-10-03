// RAMBLA-FORK: feature: 2026-10-02-feat-server-tool-install.md: handles the daemon.tool RPCs and refreshes provider snapshots after changes.
import type { Logger } from "pino";
import type { ProviderSnapshotManager } from "../agent/provider-snapshot-manager.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../messages.js";
import {
  type MiseResult,
  installTools,
  listTools,
  uninstallTools,
  upgradeTools,
} from "./mise.rambla.js";
import { TOOL_CATALOG, resolveToolNames } from "./tool-catalog.rambla.js";

type ProviderSnapshots = Pick<ProviderSnapshotManager, "refreshSettingsSnapshot">;
type Emit = (msg: SessionOutboundMessage) => void;
type Warn = Pick<Logger, "warn">;
type ChangeResponseType =
  | "daemon.tool.install.response"
  | "daemon.tool.upgrade.response"
  | "daemon.tool.uninstall.response";

/** Returns the provider ids of the named tools, or of the whole catalog when no names are given. */
function affectedProviderIds(names: string[]): string[] {
  const resolved = names.length > 0 ? resolveToolNames(names) : { ok: true, tools: TOOL_CATALOG };
  if (!resolved.ok) return [];
  return resolved.tools.flatMap((tool) => (tool.providerId ? [tool.providerId] : []));
}

/** Runs a tools change, refreshes the affected providers on success, then emits mise's result. */
async function runChange(
  type: ChangeResponseType,
  requestId: string,
  names: string[],
  change: Promise<MiseResult>,
  snapshots: ProviderSnapshots,
  emit: Emit,
  logger: Warn,
): Promise<void> {
  const result = await change;
  const providers = affectedProviderIds(names);
  if (result.ok && providers.length > 0) {
    // mise already changed the host, so a refresh failure must not turn its success into an error.
    try {
      await snapshots.refreshSettingsSnapshot({ providers });
    } catch (err) {
      logger.warn({ err, providers }, "Failed to refresh provider snapshots after tool change");
    }
  }
  emit({ type, payload: { requestId, ...result } });
}

/** Handles a daemon.tool request, or returns undefined for any other message. */
export function dispatchToolMessage(
  msg: SessionInboundMessage,
  snapshots: ProviderSnapshots,
  emit: Emit,
  logger: Warn,
): Promise<void> | undefined {
  switch (msg.type) {
    case "daemon.tool.list.request":
      return listTools().then((result) => {
        const payload = result.ok
          ? { requestId: msg.requestId, ok: true, output: "", tools: result.tools }
          : { requestId: msg.requestId, ok: false, output: result.output, tools: [] };
        emit({ type: "daemon.tool.list.response", payload });
        return undefined;
      });
    case "daemon.tool.install.request":
      return runChange(
        "daemon.tool.install.response",
        msg.requestId,
        msg.names,
        installTools(msg.names, { version: msg.version, latest: msg.latest }),
        snapshots,
        emit,
        logger,
      );
    case "daemon.tool.upgrade.request":
      return runChange(
        "daemon.tool.upgrade.response",
        msg.requestId,
        msg.names,
        upgradeTools(msg.names, { latest: msg.latest }),
        snapshots,
        emit,
        logger,
      );
    case "daemon.tool.uninstall.request":
      return runChange(
        "daemon.tool.uninstall.response",
        msg.requestId,
        msg.names,
        uninstallTools(msg.names),
        snapshots,
        emit,
        logger,
      );
    default:
      return undefined;
  }
}
