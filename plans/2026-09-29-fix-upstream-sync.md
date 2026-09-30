# fix: tested upstream sync; generated blobs out of src

Status: unapproved

## Provenance

- main: `a8d62ddf1` — 2026-09-28
- upstream-rebrand: `20f46ddda` — 2026-09-27
- upstream/main: `30178c4f5` (untagged) — 2026-09-27

## Scope

**In scope:**

1. New workspace `packages/generated` (`@getrambla/generated`) for generated build inputs; protocol's build writes the 2 blobs to its git-ignored `dist/`.
2. `.ignore` and a CI blob-shape check.
3. A tested `fork/sync-upstream.sh` replaces the 3 old scripts; `just sync-upstream`, `just sync-upstream-preview` (was `trial-merge`), `sync-upstream.yml`, skill `sync-upstream`.
4. Merge upstream v0.10.1 into main from CI.
5. A rebranded branch per upstream hotfix tag, for the user to review and merge by hand.

**Not in scope:**

- The usage-meter conflict in upstream's next tag (upstream #5465).
- Our logos, `fork/brand/` and `just logos`.

## Acceptance criteria

1. The entire plan is implemented on a single new branch created from main; main is untouched until final merge-back.
2. A release tag is an upstream `v*` tag reachable from upstream main, betas included. Every other upstream `v*` tag is a hotfix tag. A tag's classification is decided once, the first time it is seen; a tag already absorbed by one branch is never re-absorbed by the other.
3. upstream-rebrand is never reset. Its first run syncs every release tag after `v0.10.0-beta.1`, the newest tag it contains.
4. Each run syncs every release tag newer than the newest one on upstream-rebrand, and every hotfix tag newer than the newest one on upstream-hotfix-rebrand, oldest first. In every run, upstream-rebrand is synced before upstream-hotfix-rebrand. It reads no older tags and never syncs an untagged upstream commit.
5. Each run adds 2 commits per tag to its branch: a `-s ours` merge of the tag, then the tag's tree minus the delete list, renamed and formatted.
6. upstream-hotfix-rebrand exists, created by a separate one-time bootstrap (script or justfile recipe, never the recurring script) from the upstream-rebrand commit for the hotfix's base release tag — the newest release tag that is an ancestor of the hotfix tag in upstream history.
7. Each hotfix sync commit's `git merge-base` with the upstream-rebrand commit for its base release tag is that release commit.
8. Merging a hotfix sync commit into a branch cut from its base release commit brings only the hotfix's changes.
9. Neither branch holds a file from main or anything on the delete list (enumerated in the plan body: logo paths, `nix/npm-deps.hash`, the tracked blobs). Nothing from our main is ever copied into the rebrand branches.
10. After the rename, no "paseo" in any case remains outside the rebrand skip paths (enumerated in the plan body).
11. The merge into main, and the preview's merge, keep the target branch's copies of the deleted files.
12. The script takes no arguments. When each branch holds every tag of its class — upstream-rebrand holds every release tag and upstream-hotfix-rebrand every hotfix tag — and main contains upstream-rebrand, a run changes nothing and exits 0.
13. On a merge conflict, upstream-rebrand is still pushed, main is unchanged, and the script exits non-zero listing the conflicted paths. On any other error, no branch changes and the script exits non-zero. No temporary worktree is left.
14. `just sync-upstream` and `sync-upstream.yml` run the script from origin's branches. It pushes only the 2 upstream branches and leaves merged main as a local candidate, which they build and typecheck in a temporary worktree, then push; the push fails if main moved. Main merges only upstream-rebrand. `just sync-upstream-preview` syncs, then merges upstream-rebrand into a throwaway copy of the current branch even if main's merge would conflict; its `drop` action (removing that throwaway copy) stays. No ImageMagick or librsvg. No old script, recipe, workflow or skill name remains (old set enumerated in the plan body).
15. Every criterion in this section has an automated test, and the tests run in CI. A criterion that cannot be automated is not silently exempted: it is decomposed into testable parts, and any remainder is negotiated with the user before implementation.
16. A manual `sync-upstream.yml` (workflow_dispatch) run works on the feature branch, dispatched via the `gh` CLI (`gh workflow run sync-upstream.yml`); the run completes green (`gh run view` reports success), and the workflow does not hardcode main as its checkout ref or push context.
17. `packages/generated` exists as a workspace package (`@getrambla/generated`); all generated blobs are generated at build time into its git-ignored `dist/`; a fresh clone, `npm ci` and build produce them; they survive a later `npm install` or `npm ci`; no generated blob is git-tracked anywhere.
18. CI fails on a `.ts`/`.tsx` file in `packages/*/src` over 200 KB and under 10 lines, printing its path. Generated paths are excluded via the existing oxfmt/oxlint `ignorePatterns`; no `.ignore` file is created.

## Goal

Sync works again; blobs leave `src/`.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                                                                                                                                | Edit                                                                                                 | Upstream activity                 | Tag                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------- |
| `packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs`, `packages/app/scripts/build-terminal-webview-html.mjs`                                                      | output `.js` and `.d.ts` into `packages/generated/dist/`; delete old output                          | 1-2 touches each                  | `RAMBLA-FORK: fix:` |
| `packages/generated/package.json`                                                                                                                                                   | `exports` `./*` → `dist/`                                                                            | new                               | none (ours)         |
| root `package.json`, `package-lock.json`                                                                                                                                            | 1 `workspaces` line; lockfile regenerated                                                            | 324 and 465 touches               | none (JSON)         |
| the 6 files importing the blobs                                                                                                                                                     | 1 import line each                                                                                   | quiet, 1-4 touches                | `RAMBLA-FORK: fix:` |
| `packages/app/package.json`, `packages/protocol/package.json`                                                                                                                       | app: `build:webview-bundles` and the dependency; protocol: `postbuild` runs it                       | 300+ and 95 touches               | none (JSON)         |
| `.gitignore`                                                                                                                                                                        | `.trial-merge/` renamed for the preview                                                              | 29 touches                        | `RAMBLA-FORK: fix:` |
| `.ignore`                                                                                                                                                                           | `thinking-tone.native-pcm.ts`                                                                        | new                               | none (ours)         |
| the 2 tracked blobs                                                                                                                                                                 | `git rm`                                                                                             | 3 and 16 touches                  | none                |
| `.github/workflows/ci.yml`, `.github/workflows/nix.yml`                                                                                                                             | ci: blob-shape check, sync test in a job that installs dependencies; nix: 1 `workflow_dispatch` line | 65 and 10 touches                 | `RAMBLA-FORK: fix:` |
| `fork/sync-upstream.sh`, `fork/sync-upstream.test.mjs`; the 3 old scripts                                                                                                           | script with delete list, and tests; old scripts deleted                                              | new                               | none (ours)         |
| `justfile`, `.github/workflows/merge-upstream.yml` → `sync-upstream.yml`                                                                                                            | call the script; old recipes dropped; `provenance` reads main's last sync merge                      | ours                              | none                |
| `.agents/skills/merge/`, symlinks `.agents/skills/MERGE-SKILL.md` and `.claude/skills/merge`                                                                                        | renamed `sync-upstream`; skill covers the delete list, commands, conflicts, hotfix branches          | ours                              | none                |
| `CLAUDE.md` (our block), `docs/brand.md`, `fork/build-changelog.mjs`, `fork/brand/generate.mjs`, `.agents/skills/plan/SKILL.md` (provenance), and every other file naming old names | new names                                                                                            | 76 touches (CLAUDE.md); rest ours | none                |

**Why this shape:** upstream source files change by 1 import line each.

**Branch:** `fix/upstream-sync` — required, 16 upstream files edited and 2 removed.

## Cause

The sync ([sync-upstream-rebrand.sh:138](../fork/sync-upstream-rebrand.sh#L138)) and release mode ([merge-upstream.sh:70](../fork/merge-upstream.sh#L70)) skip tags upstream main lacks; v0.10.1 is only on `release/0.10.1`. The sync copies main's nix hash into upstream-rebrand ([sync-upstream-rebrand.sh:109](../fork/sync-upstream-rebrand.sh#L109)) and needs ImageMagick, absent in CI ([generate.mjs:34](../fork/brand/generate.mjs#L34)). Two generators commit multi-megabyte one-line files into `src/` ([build-runtime.mjs:10](../packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs#L10), [build-terminal-webview-html.mjs:10](../packages/app/scripts/build-terminal-webview-html.mjs#L10)).

## Constraints

- No Metro, tsconfig or vitest config edits. Imports have no file extension. `build:terminal-webview` stays.
- Delete-list entries are git pathspec globs matching both upstream's names and ours, in 1 block at the top of the script.
- All git work happens in temporary worktrees, with `LEFTHOOK=0`. Refs move only after every commit exists.
- The tests follow `fork/build-changelog.test.mjs` (`node:test`).

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. **Blobs.** Create `packages/generated`; both generators write into it (`mermaid-runtime`, `terminal-webview`) from protocol's build; switch the 6 importers; remove the tracked blobs.
   **Acceptance criteria**: criterion 10; 2 runs give identical output. The user checks a mermaid diagram and a terminal in the app.
2. **`.ignore` and the CI blob-shape check.**
   **Acceptance criteria**: criterion 11.
3. **Sync onto upstream-rebrand.** The delete list: the 30 logo paths `fork/brand/generate.mjs` writes (by pattern where names differ), `nix/npm-deps.hash`, and the 2 tracked blobs.
   **Acceptance criteria**: criteria 1-4, including a beta tag on a side branch and an already-synced tag.
4. **Merge into main as a local candidate.** Update `CHANGELOG.md` with `fork/build-changelog.mjs`.
   **Acceptance criteria**: criteria 5 and 6, including upstream deleting a file main changed, and main changing `nix/npm-deps.hash`.
5. **Hotfix branch.**
   **Acceptance criteria**: criterion 12; a second run creates nothing.
6. **Commands, names, docs.** The skill keeps its uncommitted edits through the rename.
   **Acceptance criteria**: criteria 7 and 8; no broken symlink under `.claude/` or `.agents/`; the skill and `docs/brand.md` never say a sync walks tags or runs the logo generator.
7. **Land and run live.** The user merges the branch, then runs `sync-upstream.yml`.
   **Acceptance criteria**: criterion 9. The user reviews the result.

## Verification

- `npm run typecheck`
- `npm run lint`
- `node --test fork/sync-upstream.test.mjs`
- `npx vitest run packages/app/src/components/markdown/fence/mermaid/runtime/runtime-html.test.ts --bail=1`
- `git grep "RAMBLA-FORK:"` finds a tag in every file the table tags.

## Risks

- A future upstream one-line data file over 200 KB fails the CI check.
