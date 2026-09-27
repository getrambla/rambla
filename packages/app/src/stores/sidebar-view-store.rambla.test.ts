import { describe, expect, it } from "vitest";
import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";
import {
  filterProjectsByActiveOnly,
  resolveProjectFilterTopRow,
} from "./sidebar-view-store.rambla";

// RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: predicate and top-row tests.

function makeProject(viewKey: string, workspaceCount: number): SidebarProjectEntry {
  return {
    viewKey,
    projectName: viewKey,
    projectKind: "unknown",
    iconWorkingDir: `/tmp/${viewKey}`,
    hosts: [],
    workspaces: Array.from({ length: workspaceCount }, (_, index) => ({
      workspaceKey: `${viewKey}-ws-${index}`,
      serverId: "server-a",
      workspaceId: `${viewKey}-ws-${index}`,
      projectViewKey: viewKey,
      projectName: viewKey,
      projectKind: "unknown" as const,
      workspaceKind: "checkout" as const,
      name: `${viewKey}-ws-${index}`,
    })),
  };
}

describe("filterProjectsByActiveOnly", () => {
  it("drops projects with no workspaces by default", () => {
    const projects = [makeProject("busy", 1), makeProject("dormant", 0)];

    expect(
      filterProjectsByActiveOnly({
        projects,
        activeProjectsOnly: true,
        resolvedProjectFilters: [],
      }),
    ).toEqual([projects[0]]);
  });

  it("keeps an allowlisted project that has no workspaces", () => {
    const projects = [makeProject("busy", 1), makeProject("dormant", 0)];

    expect(
      filterProjectsByActiveOnly({
        projects,
        activeProjectsOnly: true,
        resolvedProjectFilters: ["dormant"],
      }),
    ).toEqual(projects);
  });

  it("keeps everything when the facet is off", () => {
    const projects = [makeProject("busy", 1), makeProject("dormant", 0)];

    expect(
      filterProjectsByActiveOnly({
        projects,
        activeProjectsOnly: false,
        resolvedProjectFilters: [],
      }),
    ).toEqual(projects);
  });
});

describe("resolveProjectFilterTopRow", () => {
  it("checks Active projects when the allowlist is empty and the facet is on", () => {
    expect(resolveProjectFilterTopRow({ activeProjectsOnly: true, projectFilterCount: 0 })).toBe(
      "active",
    );
  });

  it("checks All projects when the allowlist is empty and the facet is off", () => {
    expect(resolveProjectFilterTopRow({ activeProjectsOnly: false, projectFilterCount: 0 })).toBe(
      "all",
    );
  });

  it("checks neither row when at least one named project is selected", () => {
    expect(resolveProjectFilterTopRow({ activeProjectsOnly: true, projectFilterCount: 1 })).toBe(
      "none",
    );
    expect(resolveProjectFilterTopRow({ activeProjectsOnly: false, projectFilterCount: 2 })).toBe(
      "none",
    );
  });
});
