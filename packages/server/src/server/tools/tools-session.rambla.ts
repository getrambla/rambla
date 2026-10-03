// RAMBLA-FORK: feature: 2026-10-02-feat-server-tools-install.md: handles the daemon.tools RPCs and refreshes provider snapshots after changes.
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
type ChangeResponseType =
  | "daemon.tools.install.response"
  | "daemon.tools.upgrade.response"
  | "daemon.tools.uninstall.response";

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
): Promise<void> {
  const result = await change;
  const providers = affectedProviderIds(names);
  if (result.ok && providers.length > 0) await snapshots.refreshSettingsSnapshot({ providers });
  emit({ type, payload: { requestId, ...result } });
}

/** Handles a daemon.tools request, or returns undefined for any other message. */
export function dispatchToolsMessage(
  msg: SessionInboundMessage,
  snapshots: ProviderSnapshots,
  emit: Emit,
): Promise<void> | undefined {
  switch (msg.type) {
    case "daemon.tools.list.request":
      return listTools().then((result) => {
        const payload = result.ok
          ? { requestId: msg.requestId, ok: true, output: "", tools: result.tools }
          : { requestId: msg.requestId, ok: false, output: result.output, tools: [] };
        emit({ type: "daemon.tools.list.response", payload });
        return undefined;
      });
    case "daemon.tools.install.request":
      return runChange(
        "daemon.tools.install.response",
        msg.requestId,
        msg.names,
        installTools(msg.names, { version: msg.version, latest: msg.latest }),
        snapshots,
        emit,
      );
    case "daemon.tools.upgrade.request":
      return runChange(
        "daemon.tools.upgrade.response",
        msg.requestId,
        msg.names,
        upgradeTools(msg.names, { latest: msg.latest }),
        snapshots,
        emit,
      );
    case "daemon.tools.uninstall.request":
      return runChange(
        "daemon.tools.uninstall.response",
        msg.requestId,
        msg.names,
        uninstallTools(msg.names),
        snapshots,
        emit,
      );
    default:
      return undefined;
  }
}
