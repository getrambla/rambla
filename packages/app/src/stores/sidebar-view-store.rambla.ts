import type { SidebarProjectEntry } from "@/hooks/sidebar-workspaces-view-model";

// RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: active-projects-only predicate and top-row derivation.

export function filterProjectsByActiveOnly(input: {
  projects: readonly SidebarProjectEntry[];
  activeProjectsOnly: boolean;
  resolvedProjectFilters: readonly string[];
}): SidebarProjectEntry[] {
  if (!input.activeProjectsOnly) {
    return [...input.projects];
  }
  const allowlist = new Set(input.resolvedProjectFilters);
  return input.projects.filter(
    (project) => project.workspaces.length > 0 || allowlist.has(project.viewKey),
  );
}

export function resolveProjectFilterTopRow(input: {
  activeProjectsOnly: boolean;
  projectFilterCount: number;
}): "active" | "all" | "none" {
  if (input.projectFilterCount > 0) {
    return "none";
  }
  return input.activeProjectsOnly ? "active" : "all";
}
