// BUG A (incident wks_b49b662d5bde5789): an optimistic archiving marker whose
// archive request never reached the daemon is never cleared, so the sidebar row
// is locked forever. A pending marker older than the grace period (30s) must no
// longer count as archiving-in-progress. No staleness logic exists yet — these
// tests fail until it does.
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  clearWorkspaceArchivePending,
  isWorkspaceArchivePending,
  markWorkspaceArchivePending,
  shouldSuppressWorkspaceForLocalArchive,
} from "@/contexts/session-workspace-upserts";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const SERVER_ID = "incident-server";
const WORKSPACE_ID = "wks_b49b662d5bde5789";
const ARCHIVING_AT = "2026-09-27T08:53:20.220Z";
const ARCHIVE_PENDING_GRACE_MS = 30_000;

function workspace(input?: Partial<WorkspaceDescriptor>): WorkspaceDescriptor {
  return {
    id: WORKSPACE_ID,
    projectId: "prj_244f906daf78b2e8",
    projectDisplayName: "Project",
    projectRootPath: "/repo/project",
    workspaceDirectory: "/repo/project/workspace-1",
    projectKind: "git",
    workspaceKind: "worktree",
    name: "workspace-1",
    status: "done",
    archivingAt: ARCHIVING_AT,
    statusEnteredAt: null,
    diffStat: null,
    scripts: [],
    ...input,
  };
}

afterEach(() => {
  clearWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
  vi.useRealTimers();
});

describe("stale optimistic archive markers", () => {
  // Skipped: fails until the stuck archive marker bug is fixed.
  it.skip("isWorkspaceArchivePending returns false once the marker is older than the grace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ARCHIVING_AT).getTime());
    markWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });

    vi.setSystemTime(new Date(ARCHIVING_AT).getTime() + ARCHIVE_PENDING_GRACE_MS + 1);

    expect(isWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID })).toBe(
      false,
    );
  });

  it("isWorkspaceArchivePending stays true within the grace period", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ARCHIVING_AT).getTime());
    markWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });

    vi.setSystemTime(new Date(ARCHIVING_AT).getTime() + ARCHIVE_PENDING_GRACE_MS - 1);

    expect(isWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID })).toBe(
      true,
    );
  });

  // Skipped: fails until the stuck archive marker bug is fixed.
  it.skip("shouldSuppressWorkspaceForLocalArchive stops suppressing a stale marker", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ARCHIVING_AT).getTime());
    markWorkspaceArchivePending({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });

    vi.setSystemTime(new Date(ARCHIVING_AT).getTime() + ARCHIVE_PENDING_GRACE_MS + 1);

    expect(
      shouldSuppressWorkspaceForLocalArchive({
        serverId: SERVER_ID,
        workspace: workspace(),
      }),
    ).toBe(false);
  });
});
