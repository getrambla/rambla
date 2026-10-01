# Sidebar hover behavior locations (2026-09-30)

Source: read of files under /home/tom/rambla-work/rambla/packages/app/src/components. No file read is over 2000 lines except as flagged. No minified files touched.

## (a) Workspace row in lower list

Flag: `sidebar-workspace-list.tsx` is 2802 lines (over 2000).

- `sidebar-workspace-list.tsx:1050` `WorkspaceRowInner`. Hover state comes from `SidebarWorkspaceRowFrame` render-prop `{ isHovered, ... hoverHandlers }` (~line 1116). It passes `isHovered` to `SidebarWorkspaceRowContent` (~1173) and `WorkspaceRowRightGroup` (~1183).
- `sidebar-workspace-list.tsx:602` `WorkspaceRowRightGroup`. Calls `resolveTrailingActionVisibility` and renders `SidebarWorkspaceTrailingActionSlot` > `SidebarWorkspaceTrailingActionBase` (diff stat) + `SidebarWorkspaceTrailingActionOverlay` (kebab, `SidebarWorkspaceMenu`).
- `sidebar/sidebar-workspace-row-content.tsx` (547 lines):
  - 160-164 title row: `<Text style={workspaceBranchTextStyle} numberOfLines={1}>` then `<View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>`. Ellipsis comes from `numberOfLines={1}`.
  - 172-178 `showShortcutBadge && shortcutNumber !== null` renders `SidebarWorkspaceShortcutBadge` (badge defined ~339, style `shortcutBadge` 296).
  - 369-398 `resolveTrailingActionVisibility`. Quotes: `showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut`; `showScrim: showKebab && isHovered`; `reserveSlotWidth: hasContent || (hasArchiveAction && isTouchPlatform)`. Comment 354-356: "The trailing content survives the kebab on hover and fades under the scrim instead of blinking out."
  - 400-420 `SidebarWorkspaceTrailingActionSlot` (style `trailingActionSlot` 316 / `trailingActionSlotReserved` 323).
  - 422-436 `SidebarWorkspaceTrailingActionBase` (`hidden: { opacity: 0 }` at 314).
  - 438-456 `SidebarWorkspaceTrailingActionOverlay`: renders `TrailingActionScrim` (testID `sidebar-workspace-trailing-scrim`) then `<View style={trailingActionOverlay}>` (absolute, top 0, right 0, line 331).
  - Comment 394-397: "Everywhere else the width goes back to the title and the kebab fades in over its tail."
  - Styles: `workspaceBranchText` (~516-524: `opacity: 0.76, flex: 1, minWidth: 0`), `workspaceBranchTextHovered` (`opacity: 1`), `rowRight` (289: `flexShrink: 0`), `workspaceTitleRow` (472).
- `ui/trailing-action-scrim.tsx` (67 lines): the fade toward the right. `SCRIM_WIDTH = 48` (line 8), `SCRIM_SOLID_OFFSET = "55%"` (9). SVG horizontal gradient stops at lines 16-18: stopOpacity 0 at 0%, 1 at 55%, 1 at 100%. Style `scrim` (61-67): `position: "absolute", top:0, bottom:0, right:0, width: SCRIM_WIDTH`. Color from `backdrop` prop (`SurfaceBackdrop`), computed via `sidebar/sidebar-row-backdrop.ts` (`getSidebarRowBackdrop`, called at sidebar-workspace-list.tsx ~1125).
- Kebab trigger icon: `sidebar-workspace-list.tsx:163` `ThemedMoreVertical`; workspace menu in `sidebar/sidebar-workspace-menu.tsx`; visibility hook `sidebar/use-open-kebab-menu-visibility.ts`.
- Diff stat content: `SidebarWorkspaceTrailingContent` / `useSidebarWorkspaceTrailing` (defined under `sidebar/workspace-trailing/index.tsx`; internals not read).
- Project (not workspace) rows have separate hover logic: `sidebar-workspace-list.tsx` ~408-450 (`actionsVisible`, `projectKebabButtonHidden` 2663), title at ~958 `numberOfLines={1}`.

## (b) Top header rows

- `sidebar/sidebar-nav-rows.tsx` (178 lines): `SidebarNavRows` renders `BUILTIN_ROWS` (line ~172-177): `new-workspace` -> `SidebarNewWorkspaceRow` (69, icon Plus, `shortcutKeys` from `builtinSidebarNavShortcutAction("new-workspace")`), `history` -> `SidebarHistoryRow` (no shortcut), `search` -> `SidebarSearchRow` (134, shortcut), `schedules` -> `SidebarSchedulesRow` (no shortcut). All use `variant="compact"`. Plugin rows come via `plugins/sidebar-items.tsx` (not read).
- Used in `left-sidebar.tsx` (988 lines) at lines 558 (`closeSidebar` variant) and 754.
- `sidebar/sidebar-header-row.tsx` (154 lines) `SidebarHeaderRow`:
  - 70-72 shortcut badge only on hover: `{shortcutKeys && Boolean(state.hovered) ? (<Shortcut chord={shortcutKeys} style={styles.shortcut} />) : null}`.
  - 96-108 `SidebarHeaderRowLabel`: `<Text style={labelStyle}>{label}</Text>` - no `numberOfLines`, no `flex`/`flexShrink` on label, so it wraps.
  - 127-139 `button` style: `flexDirection: "row", alignItems: "center", gap: spacing[2], minHeight: 28, paddingVertical: spacing[1]`.
  - 143-150 `label` style: fontSize base, no width constraints.
  - 151-153 `shortcut: { marginLeft: "auto" }`.
  - Hover background: `buttonHovered` (140) via Pressable `hovered` state (53-57).
- `ui/shortcut.tsx`: `Shortcut` component (line 9), formats via `formatShortcut` (line 43).
