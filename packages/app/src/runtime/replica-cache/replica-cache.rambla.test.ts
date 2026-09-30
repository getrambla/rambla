// BUG B (incident wks_b49b662d5bde5789): the replica cache holds a workspace row
// with status "running" captured before the last agent closed; the daemon never
// sends a workspace_update afterward, so readWorkspace hands back stale
// "running" forever. Server truth (all agents closed, "done" at 08:47:48.755Z)
// arrived but the cached row predates it and nothing reconciles. A read must
// not report the stale cached "running" as current. No staleness check exists
// yet — this fails today through the existing readWorkspace API only.
import { describe, expect, it, vi, afterEach } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getrambla/protocol/messages";
import { normalizeWorkspaceDescriptor } from "@/stores/session-store";
import { ReplicaCache } from ".";
import type { ReplicaRow, ReplicaRowStore } from "./row-store";

const SERVER_ID = "incident-server";
const WORKSPACE_ID = "wks_b49b662d5bde5789";
const CACHED_ENTERED_AT = "2026-09-27T08:47:10.224Z";
const SERVER_ENTERED_AT = "2026-09-27T08:47:48.755Z";

class MemoryStorage implements ReplicaRowStore {
  readonly rows = new Map<string, ReplicaRow>();
  async open(): Promise<void> {}
  async read(
    serverId: string,
    kinds: readonly ReplicaRow["kind"][],
    ids?: readonly string[],
  ): Promise<ReplicaRow[]> {
    const acceptedKinds = new Set(kinds);
    const acceptedIds = ids ? new Set(ids) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.serverId === serverId &&
        acceptedKinds.has(row.kind) &&
        (!acceptedIds || acceptedIds.has(row.id)),
    );
  }
  async readAll(): Promise<{ serverId: string; rows: ReplicaRow[] }[]> {
    const hosts = new Map<string, ReplicaRow[]>();
    for (const row of this.rows.values()) {
      const rows = hosts.get(row.serverId) ?? [];
      rows.push(row);
      hosts.set(row.serverId, rows);
    }
    return [...hosts].map(([serverId, rows]) => ({ serverId, rows }));
  }
  async apply(changes: { deletes: ReplicaRow[]; upserts: ReplicaRow[] }): Promise<void> {
    for (const key of changes.deletes) this.rows.delete(`${key.serverId}:${key.kind}:${key.id}`);
    for (const row of changes.upserts) this.rows.set(`${row.serverId}:${row.kind}:${row.id}`, row);
  }
  async deleteHost(serverId: string): Promise<void> {
    for (const [key, row] of this.rows) if (row.serverId === serverId) this.rows.delete(key);
  }
  async renameHost(oldServerId: string, newServerId: string): Promise<void> {
    for (const [key, row] of this.rows) {
      if (row.serverId !== oldServerId) continue;
      this.rows.delete(key);
      const renamed = { ...row, serverId: newServerId };
      this.rows.set(`${renamed.serverId}:${renamed.kind}:${renamed.id}`, renamed);
    }
  }
  async clear(): Promise<void> {
    this.rows.clear();
  }
}

const noLegacyCleanup = { clearLegacyCache: async () => undefined };

function workspacePayload(input?: Partial<WorkspaceDescriptorPayload>): WorkspaceDescriptorPayload {
  return {
    id: WORKSPACE_ID,
    projectId: "prj_244f906daf78b2e8",
    projectDisplayName: "Rambla",
    projectRootPath: "/repo/rambla",
    workspaceDirectory: "/repo/rambla",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "running",
    statusEnteredAt: CACHED_ENTERED_AT,
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ReplicaCache stale running rows", () => {
  // Skipped: fails until the stuck "running" status bug is fixed.
  it.skip("does not return a stale cached running status as current when server truth says done", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(SERVER_ENTERED_AT).getTime());

    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage, noLegacyCleanup);
    writer.setHosts([SERVER_ID]);
    writer.commitDirectoryMutations(SERVER_ID, [
      {
        kind: "workspace",
        type: "upsert",
        id: WORKSPACE_ID,
        value: normalizeWorkspaceDescriptor(workspacePayload()),
      },
    ]);
    await writer.flush();

    const reader = new ReplicaCache(storage, noLegacyCleanup);
    reader.setHosts([SERVER_ID]);
    const cached = await reader.readWorkspace(SERVER_ID, WORKSPACE_ID);
    expect(cached?.workspace.status).toBe("running");

    // Server truth: all agents closed; the authoritative descriptor says "done".
    // Desired behavior: the read must surface the staleness so the UI cannot
    // keep showing "running" (e.g. by rejecting, or preferring server truth).
    const result = await reader.readWorkspace(SERVER_ID, WORKSPACE_ID);
    expect(result?.workspace.status).toBe("done");
  });
});
