import { useCallback, useMemo } from "react";
import {
  useAppSettings,
  type SidebarWorkspaceTrailing,
  type WorkspaceTitleSource,
} from "@/hooks/use-settings";
import {
  useSidebarViewStore,
  type SidebarGroupMode,
  type SidebarLabelFilter,
} from "@/stores/sidebar-view-store";
import { DEFAULT_SIDEBAR_CHECKS_DISPLAY, type SidebarChecksDisplay } from "./checks-display";
import { DEFAULT_SIDEBAR_ROW_ITEMS, type SidebarRowItem, type SidebarRowItems } from "./row-items";

/** The trailing slot holds one thing, so these are a choice rather than toggles. */
export type SidebarTrailingChoice = Exclude<SidebarWorkspaceTrailing, "none">;

export interface SidebarDisplayPreferences {
  grouping: SidebarGroupMode;
  setGrouping: (mode: SidebarGroupMode) => void;
  titleSource: WorkspaceTitleSource;
  setTitleSource: (source: WorkspaceTitleSource) => void;
  rowItems: SidebarRowItems;
  toggleRowItem: (item: SidebarRowItem) => void;
  checksDisplay: SidebarChecksDisplay;
  setChecksDisplay: (display: SidebarChecksDisplay) => void;
  trailing: SidebarWorkspaceTrailing;
  /** Picking the choice that is already showing clears the slot. */
  toggleTrailing: (choice: SidebarTrailingChoice) => void;
  hostFilters: readonly string[];
  toggleHostFilter: (serverId: string) => void;
  clearHostFilters: () => void;
  /** Raw stored selection. For anything the user sees, use the model's resolved list instead. */
  projectFilters: readonly string[];
  toggleProjectFilter: (viewKey: string) => void;
  clearProjectFilters: () => void;
  // RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: surfaces the facet and the combined top-row select action.
  activeProjectsOnly: boolean;
  selectProjectFilterTopRow: (row: "active" | "all") => void;
  setActiveProjectsOnly: (activeProjectsOnly: boolean) => void;
  labelFilter: SidebarLabelFilter;
  toggleLabelFilter: (name: string) => void;
  clearLabelFilter: () => void;
}

/**
 * Every decision the sidebar's display-preferences menu can make, behind one interface.
 *
 * Grouping and host filters live in a local zustand store while the title source and row items
 * are synced app settings — a split that exists for good reasons (a filter is transient view
 * state; a preference follows you) and that the menu has no business knowing about. Callers ask
 * this for a value and set it; where it lands is this module's problem.
 */
export function useSidebarDisplayPreferences(): SidebarDisplayPreferences {
  const grouping = useSidebarViewStore((state) => state.groupMode);
  const setGrouping = useSidebarViewStore((state) => state.setGroupMode);
  const hostFilters = useSidebarViewStore((state) => state.hostFilters);
  const toggleHostFilter = useSidebarViewStore((state) => state.toggleHostFilter);
  const clearHostFilters = useSidebarViewStore((state) => state.clearHostFilters);
  const projectFilters = useSidebarViewStore((state) => state.projectFilters);
  const toggleProjectFilter = useSidebarViewStore((state) => state.toggleProjectFilter);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  // RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: subscribes to the facet.
  const activeProjectsOnly = useSidebarViewStore((state) => state.activeProjectsOnly);
  const setActiveProjectsOnly = useSidebarViewStore((state) => state.setActiveProjectsOnly);
  const labelFilter = useSidebarViewStore((state) => state.labelFilter);
  const toggleLabelFilter = useSidebarViewStore((state) => state.toggleLabelFilter);
  const clearLabelFilter = useSidebarViewStore((state) => state.clearLabelFilter);

  const {
    settings: {
      workspaceTitleSource,
      sidebarWorkspaceTrailing,
      sidebarRowItems,
      sidebarChecksDisplay,
    },
    updateSettings,
  } = useAppSettings();

  const setTitleSource = useCallback(
    (source: WorkspaceTitleSource) => {
      void updateSettings({ workspaceTitleSource: source });
    },
    [updateSettings],
  );

  const toggleRowItem = useCallback(
    (item: SidebarRowItem) => {
      void updateSettings({
        sidebarRowItems: { ...sidebarRowItems, [item]: !sidebarRowItems[item] },
      });
    },
    [updateSettings, sidebarRowItems],
  );

  const setChecksDisplay = useCallback(
    (display: SidebarChecksDisplay) => {
      void updateSettings({ sidebarChecksDisplay: display });
    },
    [updateSettings],
  );

  const toggleTrailing = useCallback(
    (choice: SidebarTrailingChoice) => {
      void updateSettings({
        sidebarWorkspaceTrailing: sidebarWorkspaceTrailing === choice ? "none" : choice,
      });
    },
    [updateSettings, sidebarWorkspaceTrailing],
  );

  // RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: combined top-row select sets the flag and clears the allowlist.
  const selectProjectFilterTopRow = useCallback(
    (row: "active" | "all") => {
      setActiveProjectsOnly(row === "active");
      clearProjectFilters();
    },
    [setActiveProjectsOnly, clearProjectFilters],
  );

  return useMemo(
    () => ({
      grouping,
      setGrouping,
      titleSource: workspaceTitleSource,
      setTitleSource,
      rowItems: sidebarRowItems,
      toggleRowItem,
      checksDisplay: sidebarChecksDisplay,
      setChecksDisplay,
      trailing: sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      // RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: exposes the facet and the combined action.
      activeProjectsOnly,
      selectProjectFilterTopRow,
      setActiveProjectsOnly,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    }),
    [
      grouping,
      setGrouping,
      workspaceTitleSource,
      setTitleSource,
      sidebarRowItems,
      toggleRowItem,
      sidebarChecksDisplay,
      setChecksDisplay,
      sidebarWorkspaceTrailing,
      toggleTrailing,
      hostFilters,
      toggleHostFilter,
      clearHostFilters,
      projectFilters,
      toggleProjectFilter,
      clearProjectFilters,
      // RAMBLA-FORK: feature: 2026-09-26-feat-active-projects-only.md: memo dependencies for the new facet and action.
      activeProjectsOnly,
      selectProjectFilterTopRow,
      setActiveProjectsOnly,
      labelFilter,
      toggleLabelFilter,
      clearLabelFilter,
    ],
  );
}

/**
 * Just the row items, for the row renderers. They re-render per workspace, so they subscribe to
 * the one field they use rather than to every preference in the menu.
 */
export function useSidebarRowItems(): SidebarRowItems {
  const {
    settings: { sidebarRowItems },
  } = useAppSettings();
  return sidebarRowItems ?? DEFAULT_SIDEBAR_ROW_ITEMS;
}

/**
 * Everything the line under a workspace title needs to know, in one read. The two settings are
 * answered together by `selectMetaRowItems`, so asking for them separately would only mean two
 * subscriptions per row for one decision.
 */
export function useSidebarMetaPreferences(): {
  rowItems: SidebarRowItems;
  checksDisplay: SidebarChecksDisplay;
} {
  const {
    settings: { sidebarRowItems, sidebarChecksDisplay },
  } = useAppSettings();
  return useMemo(
    () => ({
      rowItems: sidebarRowItems ?? DEFAULT_SIDEBAR_ROW_ITEMS,
      checksDisplay: sidebarChecksDisplay ?? DEFAULT_SIDEBAR_CHECKS_DISPLAY,
    }),
    [sidebarRowItems, sidebarChecksDisplay],
  );
}
