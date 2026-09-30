# fix: sidebar shortcut badge reserves its space before hover

Status: unapproved

## Provenance

- main: `a8d62ddf1` — 2026-09-28
- upstream-rebrand: `20f46ddda` — 2026-09-27
- upstream/main: 30178c4f5 — 2026-09-27

## Scope

**In scope:**

1. The shortcut badge on left-sidebar header rows (New workspace, Search) stays mounted and takes its space when the row is not hovered, drawn invisible.
2. The badge becomes visible on hover, as today.
3. The row's spoken name is composed explicitly from its label and its shortcut text, so screen readers hear the shortcut too.

**Not in scope:**

- The workspace-list shortcut badges driven by `useShowShortcutBadges`, which are not hover-based.
- The project "New workspace" ghost row, which has no shortcut badge.
- The `Shortcut` component itself and how it formats keys.
- Row padding, icon size, or label wrapping rules.

## Acceptance criteria

1. When not hovered, the New workspace and Search rows are the same width and wrap the same way as when hovered — asserted in the test by the badge being mounted with its shortcut text before any hover.
2. On hover, the shortcut badge appears as it does today.
3. When not hovered, the badge can't be seen.
4. Screen readers read the row name and its shortcut, whether or not the row is hovered.

## Goal

Hovering a left-sidebar row no longer re-wraps its label at large text sizes, and screen readers hear the row's shortcut.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                     | Edit                                                                                                                                                   | Upstream activity                                                                                      | Tag                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------- |
| `packages/app/src/components/sidebar/sidebar-header-row.tsx`             | badge always mounted with an opacity-0 style when not hovered; button label becomes `accessibilityLabel ?? (label joined with the formatted shortcut)` | 7 commits total; last `d7b7016cc` after v0.9.2, changing lines 3 away from the badge edit on each side | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/sidebar/sidebar-header-row.rambla.test.tsx` | covers criteria 1-4                                                                                                                                    | new                                                                                                    | `RAMBLA-FORK: fix:` |

**Why this shape:** 2 edits of at most 3 lines each fit placement rule 4, so both are in place; a helper file would add an import for less code than it saves.

**Branch:** none — 1 upstream file edited, work on main.

## Cause

The badge only renders while `state.hovered` is true ([sidebar-header-row.tsx:66](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L66)), so hovering adds its width to the row and the label wraps. The button's label is forced to `accessibilityLabel ?? label` ([sidebar-header-row.tsx:92](../packages/app/src/components/sidebar/sidebar-header-row.tsx#L92)), which overrides the child text, so the shortcut is never spoken; an explicit `accessibilityLabel` is the only RN-core way to guarantee the spoken name (RN concatenates Text children, but the badge's key symbols would be spoken raw). Only New workspace and Search pass `shortcutKeys` ([sidebar-nav-rows.tsx:107](../packages/app/src/components/sidebar/sidebar-nav-rows.tsx#L107), [148](../packages/app/src/components/sidebar/sidebar-nav-rows.tsx#L148)).

## Constraints

- No file outside the table changes.
- The Pressable keeps `accessible` and `accessibilityRole="button"`, so the row stays 1 screen-reader item.
- A caller that passes `accessibilityLabel` still overrides the label.
- Hide with opacity 0; the same hide-without-removing pattern is already used for hover-revealed buttons at [sidebar-workspace-list.tsx:2643](../packages/app/src/components/sidebar-workspace-list.tsx#L2643). Never unmount, `display: none`, or zero width. The badge's opacity must not gate its spoken label — the composed `accessibilityLabel` is authoritative.
- No change to the render callback's dependency list (already includes `shortcutKeys`), icon, or styles other than one hidden entry.
- The label composes with the repo's existing shortcut formatter (`src/utils/format-shortcut`, the module `ShortcutKey` already comes from), not a new formatting helper.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.

In `sidebar-header-row.tsx`, render the badge whenever `shortcutKeys` is set, adding an opacity-0 style when the row is not hovered. Change the button's label to the caller's `accessibilityLabel`, else `label` joined with the shortcut text from `formatShortcut`. Tag each edit `RAMBLA-FORK: fix: 2026-09-29-fix-sidebar-shortcut-hover-wrap.md: <clause>`. Add `sidebar-header-row.rambla.test.tsx` following the render-test pattern in `src/components/dictation-controls.rambla.test.tsx`; assert the badge is mounted with its shortcut text before any hover, and that the accessible name includes both label and shortcut. Criteria 1-4 apply. The user checks hover and a screen reader in the app before this is marked done.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/components/sidebar/sidebar-header-row.rambla.test.tsx --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/components/sidebar/sidebar-header-row.tsx` — both edits show a tag.
- In the desktop or web app at large text: hover New workspace and Search; the label does not re-wrap.
- With a screen reader, each of the two rows is one button whose name includes the shortcut.

## Risks

- On macOS the shortcut text is key symbols; `formatShortcut`'s output for them is spoken as composed, but VoiceOver's pronunciation is checked by the user's screen-reader pass.
- Settings uses `SidebarHeaderRow` at [settings-screen.tsx:1050](../packages/app/src/screens/settings-screen.tsx#L1050) and [sidebar-items.tsx:50](../packages/app/src/plugins/sidebar-items.tsx#L50) does too, both with no shortcut; their spoken label becomes their visible text, which equals the old fallback.
