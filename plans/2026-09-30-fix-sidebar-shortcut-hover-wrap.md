# fix: top sidebar rows truncate and fade into their shortcut on hover

Status: approved

## Provenance

- main: `01f83a7bf` — 2026-09-30
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. Every row drawn by `SidebarHeaderRow` (New workspace, History, Search, Schedules, plugin sidebar items, settings "Back to workspace") keeps its label on 1 line, truncated with an ellipsis.
2. On hover, a row with a shortcut fades its label's tail out and shows the shortcut badge over it, the way workspace rows show their three-dots menu.
3. The row's spoken name is "label, shortcut" when it has a shortcut, else only the label.
4. The three callers import the row from our copy.

**Not in scope:**

- Upstream's `sidebar-header-row.tsx`, which stays untouched.
- Workspace and project rows, and the workspace-list number badges.
- The `Shortcut`, `TrailingActionScrim`, and workspace trailing slot and overlay components themselves.
- Row padding, icon size, and hover colors.
- Touch devices, which have no hover and show no badge, as today.

## Acceptance criteria

1. No top left-sidebar row wraps. When not hovered, a long label truncates with an ellipsis.
2. On hover, the label fades out on the right the way workspace titles do, and the shortcut badge appears where the workspace row shows its three-dots menu.
3. When not hovered, the shortcut badge can't be seen and the label truncates with an ellipsis again.
4. No space is reserved for the shortcut badge when the row is not hovered.
5. Screen readers read "label, shortcut" on rows with a shortcut, whether or not the row is hovered. Rows without a shortcut read only the label, with no comma.

## Goal

Top left-sidebar rows never wrap. They truncate, and on hover the label fades into the shortcut badge the way workspace rows fade into their menu. Screen readers hear the shortcut.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                     | Edit                                                                                                                                             | Upstream activity                        | Tag                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ------------------- |
| `packages/app/src/components/sidebar/sidebar-header-row.rambla.tsx`      | copy of upstream's `SidebarHeaderRow` under a new export name, same props, with the one-line label, the hover fade, and the composed spoken name | new                                      | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/sidebar/sidebar-header-row.rambla.test.tsx` | covers criteria 1-5                                                                                                                              | new                                      | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/sidebar/sidebar-nav-rows.tsx`               | import line points at the copy                                                                                                                   | 1 commit; last `de8535c38` 2026-09-02    | `RAMBLA-FORK: fix:` |
| `packages/app/src/plugins/sidebar-items.tsx`                             | import line points at the copy                                                                                                                   | 4 commits; last `de8535c38` 2026-09-02   | `RAMBLA-FORK: fix:` |
| `packages/app/src/screens/settings-screen.tsx`                           | import line points at the copy                                                                                                                   | 127 commits; last `d7b7016cc` 2026-09-26 | `RAMBLA-FORK: fix:` |

**Why this shape:** The user chose a copy over 4 scattered edits in upstream's row. The copy never conflicts and each caller changes 1 import line; we lose upstream's future fixes to the row. The user chose to change each existing import line in place, importing the copy under upstream's name so the JSX stays untouched, over moving it to the end of the import block.

**Branch:** none — 3 upstream files edited, work on main.

## Cause

The label is a `Text` with no line limit and no shrink ([sidebar-header-row.tsx:107](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L107), style at [143](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L143)), so a long label wraps. The shortcut badge mounts only on hover and pushes right with `marginLeft: "auto"` ([sidebar-header-row.tsx:70](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L70), [151](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L151)), so hovering takes width from the label and it re-wraps. The spoken name is `accessibilityLabel ?? label` ([sidebar-header-row.tsx:87](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L87)), which never includes the shortcut.

## Constraints

- No file outside the table changes. Upstream's `sidebar-header-row.tsx` stays as it is.
- The copy is exported under a new name and keeps upstream's props, testIDs, variants, icon, and hover colors, and keeps `accessible` and `accessibilityRole="button"` on the Pressable. Only the label, the shortcut, and the spoken name differ.
- Reuse existing components. Write no new fade, slot, overlay, or badge. Follow the workspace row: its title is a one-line `Text` ([sidebar-workspace-row-content.tsx:161](../packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx#L161)), followed by `SidebarWorkspaceTrailingActionSlot` ([402](../packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx#L402)) holding `SidebarWorkspaceTrailingActionOverlay` ([437](../packages/app/src/components/sidebar/sidebar-workspace-row-content.tsx#L437)). The overlay draws `TrailingActionScrim` ([trailing-action-scrim.tsx:40](../packages/app/src/components/ui/trailing-action-scrim.tsx#L40)) and pins its child to the right edge. Put the existing `Shortcut` ([shortcut.tsx:9](../packages/app/src/components/ui/shortcut.tsx#L9)) there. The scrim's backdrop is `surfaceSidebarHover`, the hovered row color ([sidebar-header-row.tsx:140](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L140)).
- If the existing components can't meet a criterion, stop and report to the supervisor. Don't change them or write a replacement.
- The spoken shortcut is the text the badge shows, built with the same helpers `Shortcut` uses ([shortcut.tsx:20-43](../packages/app/src/components/ui/shortcut.tsx#L20)). When `Shortcut` renders nothing because shortcuts are unavailable, the spoken name is only the label.
- A caller that passes `accessibilityLabel` still overrides the spoken name.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.

Copy upstream's `SidebarHeaderRow` into `sidebar-header-row.rambla.tsx` and change 3 things. The label stays on 1 line with an ellipsis and fills the row, so the badge sits at the right edge as today. On hover, a row with `shortcutKeys` shows the badge through the workspace trailing slot and overlay, with the scrim. The spoken name becomes "label, shortcut", or only the label. Point the three callers' import lines at the copy. Tag the new file and each caller edit `RAMBLA-FORK: fix: 2026-09-30-fix-sidebar-shortcut-hover-wrap.md: <clause>`. Add `sidebar-header-row.rambla.test.tsx` following the jsdom render pattern in `src/components/dictation-controls.rambla.test.tsx`.

**Acceptance criteria:**

- Criteria 1-5.
- The test asserts: the label has a one-line limit; nothing is mounted after the label when the row is not hovered; the badge and scrim are absent before hover, present on hover, and absent after unhover; the spoken name is "New workspace, <badge text>" hovered or not; a row with no shortcut is spoken as exactly its label; a caller's `accessibilityLabel` wins.
- No file under `packages/app/src` imports upstream's `sidebar-header-row` any more.
- The copy and each caller edit carry a `RAMBLA-FORK:` tag.
- The user checks truncation, hover, and a screen reader in the app before this is marked done.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/components/sidebar/sidebar-header-row.rambla.test.tsx --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/components/sidebar/sidebar-nav-rows.tsx packages/app/src/plugins/sidebar-items.tsx packages/app/src/screens/settings-screen.tsx` — each shows a tag.
- In the desktop app with a narrow sidebar or large text: every top row stays on 1 line with an ellipsis; hovering New workspace and Search fades the label into the badge; unhovering brings the ellipsis back.
- With a screen reader: New workspace and Search read "label, shortcut"; History and Schedules read only the label.

## Risks

- Upstream fixes to `sidebar-header-row.tsx` no longer reach us. A sync that changes it needs a manual look at the copy.
- Settings' "Back to workspace" row ([settings-screen.tsx:1050](../packages/app/src/screens/settings-screen.tsx#L1050)) and plugin rows ([sidebar-items.tsx:50](../packages/app/src/plugins/sidebar-items.tsx#L50)) now truncate instead of wrapping.
- The scrim is solid only over its right 45%, about 22 px of its 48 ([trailing-action-scrim.tsx:8](../packages/app/src/components/ui/trailing-action-scrim.tsx#L8)). A wide badge such as Search's Linux `Ctrl+K` will likely let the label show through the badge's see-through background; the step then stops and reports.
- On macOS the spoken shortcut is key symbols; the user's screen-reader pass checks how VoiceOver says them.
