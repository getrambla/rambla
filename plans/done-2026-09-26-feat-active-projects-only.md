# feat: active-projects-only filter in the sidebar Project page

Status: done

## Provenance

- main: 7c5bffd76 — 2026-09-27
- upstream-rebrand: 7b8f99096 — 2026-09-25
- upstream/main: 513f2a9ea — 2026-09-26

## Scope

**In scope:**

1. A persisted `activeProjectsOnly: boolean` facet (default `true`) in the sidebar view store.
2. A three-state Project filter page: "Active projects" / "All projects" as a mutually
   exclusive top block, a separator, then the existing multi-select project list. Exactly
   one of the top rows is checked when no named project is selected; neither is checked
   while one or more named projects are selected.
3. Selecting Active or All clears the named-project allowlist; selecting a named project
   unchecks both top rows.
4. With Active projects on, the sidebar hides projects that have zero workspaces, except
   projects explicitly present in the resolved project allowlist.
5. Unit tests for the predicate and the top-row selection state.

**Not in scope:**

- Any daemon/server change — the whole feature is client-side.
- Agent-status-based "active" definitions (running/done buckets) — active means "has at
  least one workspace", purely structural.
- The Host and Labels filters, group modes, workspace-title source, and the pinned section.
- New i18n locales beyond `en.ts`.
- Upstream's label-filter empty-state behavior and its tests.

## Acceptance criteria

1. With no stored setting (fresh install, or persisted state written before this feature),
   Active projects is the checked top row and no project with zero workspaces shows a
   header row in the sidebar's project group mode.
2. When the named-project allowlist is empty, exactly one of "Active projects" and
   "All projects" is checked; when at least one named project is selected, neither is.
3. Named project rows remain independently multi-selectable.
4. Selecting "Active projects" or "All projects" clears all named selections; selecting a
   named project unchecks both top rows.
5. A separator divides the top block from the named-project list.
6. With Active projects on, a project explicitly present in the resolved project allowlist
   stays visible even when it has zero workspaces.
7. Switching to "All projects" immediately re-shows empty projects (header + new-workspace
   ghost row) without a restart.
8. The checked state and named selections survive an app restart; persisted state without
   the new field migrates to `activeProjectsOnly: true`.
9. Existing store and project-filter tests pass unchanged except where the new default
   changes an expected initial value, and any such change is updated in that test.

## Goal

The sidebar lists every project the daemon has registered, including projects with no
workspaces, so users with many dormant projects must scroll past header rows that offer
only "New workspace". This adds "Active projects" as the system-default answer to the
Project filter, hiding workspace-less projects until the user chooses All projects or pins
them explicitly — without deleting any project.

## Merge conflict mitigation

**Files this work changes:**

| File                                                               | Edit                                                                                                    | Upstream activity                                     | Tag                  |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | -------------------- |
| `packages/app/src/stores/sidebar-view-store.rambla.ts`             | sentinel-free predicate + three-state selection logic helpers                                           | new                                                   | `RAMBLA-FORK: feat:` |
| `packages/app/src/stores/sidebar-view-store.rambla.test.ts`        | predicate + selection-state tests                                                                       | new                                                   | `RAMBLA-FORK: feat:` |
| `packages/app/src/stores/sidebar-view-store.ts`                    | one field + setter in state interface, Zod schema, initial state, partialize (~10 scattered one-liners) | last touched 2026-09-14, 3 upstream commits this year | `RAMBLA-FORK: feat:` |
| `packages/app/src/components/sidebar/sidebar-model.tsx`            | a single call into the `.rambla.` predicate inside `filteredProjects`                                   | last touched 2026-08-26, 2 upstream commits this year | `RAMBLA-FORK: feat:` |
| `packages/app/src/components/sidebar/display-preferences/model.ts` | surface the new facet and a combined top-row select action through `SidebarDisplayPreferences`          | last touched 2026-08-20, 4 upstream commits           | `RAMBLA-FORK: feat:` |
| `packages/app/src/components/sidebar/display-preferences/menu.tsx` | top block rows + separator in `ProjectFilterPage`; selection writes through the model                   | last touched 2026-09-14, 3 upstream commits this year | `RAMBLA-FORK: feat:` |
| `packages/app/src/i18n/resources/en.ts`                            | one key `sidebar.display.projectFilter.active`                                                          | actively merging upstream (2026-09-23)                | `RAMBLA-FORK: feat:` |

**Why this shape:** the persisted boolean cannot be extracted — a zustand persisted facet
must be declared in the store itself, and the store is upstream's, so those ~10 one-line
edits are unavoidable in-place churn; everything derivable (the predicate, the top-row
state mapping, the clearing semantics) lives in the `.rambla.` module so the logic retreats
cleanly when upstream ships a real filter framework, leaving only the field declaration and
the two view sites to delete.

**Branch:** `feat/active-projects-only` — 5 upstream files edited.

## Cause

`buildWorkspaceStructureProjects`
([workspace-structure.ts:47](../packages/app/src/projects/workspace-structure.ts#L47))
builds the sidebar project list from every `ProjectDescriptor` the daemon reports;
workspaces are attached in a second pass, so a workspace-less project still produces a
`SidebarProjectEntry` with `workspaces: []` and renders a header plus the
new-workspace ghost row (`sidebar-workspace-list.tsx`, `NewWorkspaceGhostRow` renders when
`project.workspaces.length === 0`). Only deleting the project removes the row today.

## Constraints

- No file outside the mitigation table changes.
- The predicate may not consult agent status (`statusBucket`, sessions) — structural
  `workspaces.length === 0` only.
- `resolveActiveProjectFilters` and `filterWorkspacesByProjects` in upstream's
  `sidebar-project-filter.ts` may not be edited; the active-only predicate wraps them in
  the model call site instead.
- The persisted Zod schema keeps `strictObject`; the new field is `boolean.optional()` so
  old persisted state parses unchanged and `SIDEBAR_VIEW_STORE_VERSION` stays 6.
- No new abstractions, options, or error handling beyond the acceptance criteria; no
  upstream test rewritten except where criterion 9 requires it.
- Upstream doc comments in edited files are not reflowed or moved.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong,
   stop and report back to the supervisor — do not amend this plan and do not re-decide
   placement while coding.
1. Add the facet to `packages/app/src/stores/sidebar-view-store.ts`: declare
   `activeProjectsOnly: boolean` and `setActiveProjectsOnly` in the state interface
   (~line 48–73), the field in `SidebarViewPersistedState` (~75–80), `boolean.optional()`
   in `SidebarViewPersistedStateSchema` (~86–93), initial `true` (~179–183), the setter
   next to the other facet setters (~184–223), the field in `partialize` (~230–235), and
   `activeProjectsOnly: true` in `migrateSidebarViewState`'s three return objects
   (~121–156). Tag each edited block. **Acceptance criteria**:
   - the store initial state has `activeProjectsOnly === true`
   - migrate returns `true` for a parsed document without the field and for a
     schema-rejected document
   - existing tests still pass (criterion 9)
2. Create `packages/app/src/stores/sidebar-view-store.rambla.ts` with (a) the predicate:
   given projects and a resolved allowlist, drop entries whose `workspaces` array is empty
   unless their `viewKey` is in the allowlist; and (b) the top-row state derivation: given
   the two facets, return which of active/all is checked (or neither). Signature sketch:

   ```ts
   function filterProjectsByActiveOnly(input: {
     projects: readonly SidebarProjectEntry[];
     activeProjectsOnly: boolean;
     resolvedProjectFilters: readonly string[];
   }): SidebarProjectEntry[];
   function resolveProjectFilterTopRow(input: {
     activeProjectsOnly: boolean;
     projectFilterCount: number;
   }): "active" | "all" | "none";
   ```

   Create `sidebar-view-store.rambla.test.ts` covering: default drops empty projects;
   allowlisted empty project survives; `false` keeps everything; top row is
   active/all/none per criterion 2's truth table. **Acceptance criteria**:
   - the new tests pass
   - they assert through the exported functions only

3. Wire the predicate in `packages/app/src/components/sidebar/sidebar-model.tsx`: inside
   the existing `filteredProjects` memo (~119–140), subscribe to the new facet alongside
   the other store selectors (~58–61) and apply the `.rambla.` predicate there. The
   predicate itself carries the allowlist exemption: an empty project whose `viewKey` is
   in the resolved allowlist survives (criterion 6) — no separate exemption mechanism
   exists in the memo today and none is added. One contiguous tagged block.
   **Acceptance criteria**:
   - with the facet true, projects without workspaces are absent from
     `filteredProjects` unless their `viewKey` is in the resolved allowlist
   - the memo's dependency array includes the new facet
4. Rework `ProjectFilterPage` in
   `packages/app/src/components/sidebar/display-preferences/menu.tsx` (~612–652): render
   "Active projects" (new i18n key) and "All projects" as the top block using the existing
   `OptionItem` row with `selected` from the `.rambla.` derivation, then a
   `<MenuSeparator />`, then the existing per-project rows; selecting a top row writes
   both facets through the model (set flag, clear allowlist), selecting a named row goes
   through the existing toggle plus clearing the flag. The facet reaches the page through
   `SidebarDisplayPreferences` (model.ts), which gains the read field and one combined
   select action backed by the `.rambla.` logic — the menu still does not import the view
   store directly. Keep rows open on select
   (`closeOnSelect={false}`), matching today's filter rows. **Acceptance criteria**:
   - the page shows Active/All/separator/projects in order
   - the checked state matches criterion 2's truth table in the running app
   - a toggle round-trip satisfies criteria 4 and 7
5. Add `sidebar.display.projectFilter.active` ("Active projects") to
   `packages/app/src/i18n/resources/en.ts` in the `projectFilter` block (~1133–1136), one
   contiguous tagged line. **Acceptance criteria**:
   - the menu row renders the new string
   - `npm run lint` and i18n key checks (if any) pass
6. Full verification pass and commit on `feat/active-projects-only`.
   **Acceptance criteria**:
   - all plan-level criteria hold
   - verification commands below pass
   - status line updated

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/stores/sidebar-view-store.rambla.test.ts packages/app/src/stores/sidebar-view-store.test.ts packages/app/src/components/sidebar/sidebar-project-filter.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/stores/sidebar-view-store.ts packages/app/src/components/sidebar/sidebar-model.tsx packages/app/src/components/sidebar/display-preferences/menu.tsx packages/app/src/i18n/resources/en.ts` — every one must show a tag.
- In the running app: open the display menu's Project page, confirm the truth table of
  criterion 2, confirm empty projects disappear by default and reappear under All projects.

## Risks

- Making Active the default changes behavior for existing users on upgrade; accepted
  explicitly by the user ("system default for the whole app").
- The store edit is the conflict-prone file (upstream active in it); the ~10 one-liners
  are scattered, so a bad upstream merge may need manual reconciliation — bounded by the
  fork tags.
- Sidebar empty-state: a user whose every project is workspace-less sees an empty list
  under the default; the existing filter empty-state component already covers this path.
