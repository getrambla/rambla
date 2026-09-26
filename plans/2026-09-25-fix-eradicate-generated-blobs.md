# fix: eradicate generated webview/validator blobs from source trees

Status: Unapproved

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `b7138f60a` — 2026-09-24
- upstream/main: `28507224d` (untagged) — 2025-09-25

## Scope

**In scope:**

1. Retarget the three generators (mermaid runtime, terminal webview HTML, WS-outbound AOT validator) to emit into per-package nested node_modules packages: `packages/app/node_modules/@getrambla/webview-bundles/` and `packages/protocol/node_modules/@getrambla/protocol-validators/`.
2. Each generator deletes its legacy output file if it still exists after emitting.
3. Switch every import site (8: the 4 app/protocol production consumers, the 4 test files) to bare-specifier imports of the new packages.
4. `git rm` the two committed blobs (mermaid `html.gen.ts`, terminal webview HTML).
5. `rambla/fork/sync-upstream-rebrand.sh` gains a permanent pre-delete list: after taking upstream's tree, it deletes the two blob paths plus the AOT output path from the worktree before commit, so upstream's copies can never enter our branch again.
6. `rambla/fork/rebrand.sh` delete list gains the two committed blob paths (future forks never see them).
7. `.gitignore` documents the two generated node_modules package dirs; the AOT src gitignore line is dropped.
8. Update `packages/protocol/src/generated/validation/README.md` to point at the new output path.
9. Root `.ignore` file covering Tier-2 text monsters (`dist/`, `release/`, `.dev/`, `android/app/.cxx/`, `.expo/`, `coverage/`, `test-results/`).
10. CI invariant: fail on any `packages/*/src` `.ts`/`.tsx` file over 100K with fewer than 10 lines (the one-line blob shape), warn on raw size over 500K.

**Not in scope:**

- Anything upstream-facing; we never upstream.
- Tier-2 blobs beyond the `.ignore` entries (dist bundles, chromium licenses, lockfiles, big test files, mockup images).
- Changes to `metro.config.cjs` (resolution already works — verified by probe).
- Metro/bundler output size optimization.
- Deleting the `src/generated/validation/` directory (README stays there).

## Goal

Generated multi-megabyte artifacts no longer exist anywhere greppable in `packages/*/src`, permanently — including on every future upstream merge — so agent greps cannot hit them.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                                 | Edit                                                                                           | Upstream activity                            | Tag                                                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------- | ------------------- |
| `packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs`               | output path → node_modules package; delete legacy file if present                              | 2 touches, latest #4107 (viewer, months old) | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/scripts/build-terminal-webview-html.mjs`                               | same                                                                                           | 2 touches, rebrand + origin commit           | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/scripts/generate-validation-aot.mjs`                              | same                                                                                           | 1 touch (#1895)                              | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/components/markdown/fence/mermaid/iframe-runtime.web.tsx`          | 1 import line                                                                                  | 3 touches, quiet since #4107                 | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/components/markdown/fence/mermaid/host.native.tsx`                 | 1 import line                                                                                  | quiet since #4107                            | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/components/terminal-emulator-webview.native.tsx`                   | 1 import line                                                                                  | 4 touches, quiet since #4650                 | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/terminal/webview/terminal-find.browser.test.ts`                    | 1 import line                                                                                  | 2 touches                                    | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/components/markdown/fence/mermaid/runtime/runtime-html.test.ts`    | 1 import line                                                                                  | quiet                                        | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/src/components/markdown/fence/mermaid/runtime/runtime.browser.test.ts` | 1 import line                                                                                  | quiet                                        | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/src/validation/ws-outbound.ts`                                    | 1 import line                                                                                  | 1 touch (#1895)                              | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/tests/validation/ws-outbound.test.ts`                             | 2 lines: import + path assertion                                                               | quiet since #1895                            | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/package.json`                                                          | prepend webview build to typecheck/test/dev/build scripts; update eas-build-post-install       | release-churn only (version bumps)           | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/package.json`                                                     | (none expected — pre-hooks already generate; only touch if probe fails)                        | release-churn only                           | `RAMBLA-FORK: fix:`                                                                                                   |
| `package.json` (root)                                                                | add `build:webviews`; prepend to `build:app-deps`, `build:web`, `build:desktop`                | release-churn only                           | `RAMBLA-FORK: fix:`                                                                                                   |
| `.gitignore`                                                                         | add 2 self-documenting lines; drop the AOT src line                                            | occasional, fork-owned                       | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/src/generated/validation/README.md`                               | point at new output path                                                                       | untouched since #1895                        | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/protocol/codegen/README.md`                                                | point at new output path                                                                       | untouched since #1895                        | `RAMBLA-FORK: fix:`                                                                                                   |
| `docs/protocol-validation.md`                                                        | point at new output path                                                                       | fork docs, quiet                             | `RAMBLA-FORK: fix:`                                                                                                   |
| `fork/sync-upstream-rebrand.sh`                                                      | permanent pre-delete list after `read-tree` (the 3 legacy paths), plus one-time `git rm -f ... |                                              | true`of the 2 tracked blobs at the top of`advance()` so reappearing upstream copies are removed on worktree and index | fork-only | `RAMBLA-FORK: fix:` |
| `fork/rebrand.sh`                                                                    | add a delete pass for the 2 committed blob paths (none exists today — the script only renames) | fork-only                                    | `RAMBLA-FORK: fix:`                                                                                                   |
| `.ignore` (new, root)                                                                | Tier-2 text-monster exclusions for rg sweeps                                                   | new                                          | `RAMBLA-FORK: fix:`                                                                                                   |
| `.github/workflows/ci.yml`                                                           | blob-shape invariant step (fail >100K & <10 lines; warn >500K)                                 | occasional, fork-owned                       | `RAMBLA-FORK: fix:`                                                                                                   |
| `packages/app/node_modules/@getrambla/webview-bundles/*`                             | generated: package.json, mermaid-html.ts, terminal-html.ts, index.d.ts                         | generated, gitignored                        | generated — no tag                                                                                                    |
| `packages/protocol/node_modules/@getrambla/protocol-validators/*`                    | generated: package.json, ws-outbound.aot.ts                                                    | generated, gitignored                        | generated — no tag                                                                                                    |

The generator node_modules packages are never committed (inside `node_modules/`, already root-ignored); a missing one fails loudly as an unresolvable import — that is the design. Every fresh clone, CI run, and dev session regenerates them; generation is part of the build, not a migration.

**Why this shape:** the 8 import edits are 1 line each (1 file takes 2) in calm, low-churn upstream files — cheaper than shim files and honest in diffs. The sync-script pre-delete is the permanent guarantee: since we never commit upstream's tree, deleting its blob paths right after `read-tree` means the files can never reach a commit on our branch, and `git rm -f ... || true` also clears worktree copies that survived via stash/checkout of old branches.

**Branch:** `fix/eradicate-generated-blobs` — 21 upstream files edited.

## Cause

Three generators write multi-megabyte TypeScript artifacts into `packages/*/src`: [build-runtime.mjs:10](../packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs#L10) writes a 3.5 MB one-line file, [build-terminal-webview-html.mjs:10](../packages/app/scripts/build-terminal-webview-html.mjs#L10) a 1.2 MB one-line file, and [generate-validation-aot.mjs:9](../packages/protocol/scripts/generate-validation-aot.mjs#L9) a 4.7 MB 17.5K-line file. Two are git-tracked (`html.gen.ts`, `terminal-emulator-webview-html.ts`); the third is gitignored (`.gitignore:90`) but lives in src, so plain greps hit all three. One grep match on a one-line file returns the entire blob as a tool result — full context death; these killed 6–9 subagents on 2026-09-25 alone. Fix: generation becomes a build step emitting into nested node_modules packages (invisible to greps of src, resolved by both NodeNext and Metro — verified by probe), and the sync script guarantees upstream's committed copies never re-enter.

## Constraints

- No file may change beyond the mitigation table.
- Metro config untouched; `.js` extensions in new imports stay (NodeNext-style, load-bearing).
- No abstractions: no shared generator-helper module, no config file for paths, no options, no error handling beyond the specified legacy-file deletion.
- Upstream tests (`runtime-html.test.ts`, `runtime.browser.test.ts`, `terminal-find.browser.test.ts`) keep asserting the same decoded exports — only their import line changes.
- Do not delete `src/generated/validation/` (README remains) or alter the validators' runtime behavior.
- The two committed blobs leave history only via `git rm`; no history rewrite.
- Generators must stay idempotent: two consecutive runs produce byte-identical output.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. Create branch `fix/eradicate-generated-blobs`.
2. `build-runtime.mjs`: change `output` (line 10) to the `@getrambla/webview-bundles/mermaid-html.ts` path under `packages/app/node_modules` (mkdir -p the package dir); write minimal `package.json` and `index.d.ts` there alongside; after writing, delete `runtime/html.gen.ts` if it exists. Tag the edited block.
3. `build-terminal-webview-html.mjs`: same shape — `terminal-html.ts` in the same bundle package, same package.json/d.ts handling (skip if step 2 already wrote them), delete the legacy terminal HTML file if present. Tag.
4. `generate-validation-aot.mjs`: retarget `output` (line 9) to `packages/protocol/node_modules/@getrambla/protocol-validators/ws-outbound.aot.ts`; ensure the package dir and minimal `package.json` exist; `runtimeImportPath` (line 88) already derives from `dirname(output)` and follows; after writing, delete `src/generated/validation/ws-outbound.aot.ts` if present. Tag.
5. Switch the 8 import sites listed in the table to bare-specifier imports of the two new packages (the mermaid/terminal bundle module names from steps 2–3, and the protocol validator module from step 4, each with the `.js` extension), one tagged line each; the protocol regression test also updates its path assertion to the new location.
6. `git rm -f` the two committed blobs (fallback `|| true` shape so reruns never fail); update the generated-validation README to the new path.
7. `.gitignore`: add the two `packages/*/node_modules/@getrambla/*` lines under a one-line comment; remove the now-dead `.gitignore:90` AOT line.
8. Root `.ignore` with the Tier-2 list from scope item 9.
9. `fork/sync-upstream-rebrand.sh`: in `advance()`, immediately after `read-tree` (line 103), add a permanent pre-delete of the three legacy paths (`git rm -rf --ignore-unmatch` or `rm -f` + index update — must succeed when absent, on worktree AND index); also a one-time `git rm -f ... || true` guard for the two tracked blobs so any reappearance is caught. Tag.
10. `fork/rebrand.sh`: add a delete pass for the two committed blob paths — the script has none today, it only renames — so future forks never track them. Tag.
11. Wiring: root `package.json` gets `build:webviews` (both app webview builds); prepend it to `build:app-deps`, `build:web`, `build:desktop`. App `package.json`: prepend `build:webviews` to `typecheck`, `test`, and the dev scripts (`android:development`, `ios`, `web`) so fresh clones generate before any dev build resolves the new imports. Protocol needs nothing (pre-hooks already run).
12. `ci.yml`: add the blob-shape invariant step (fail if any `packages/*/src` .ts/.tsx is >100K and <10 lines; warn above 500K, printing offending paths).
13. Generate everything, run full verification below.

## Verification

- `git ls-files` shows neither committed blob; `git status` clean after fresh generation.
- `grep -rn notificationsEnabled packages/app/src` → zero hits.
- `rm -rf` both node_modules package dirs → `npm run build:webviews`, protocol pre-hooks, app `typecheck` + `test` (incl. `runtime-html.test.ts`, `runtime.browser.test.ts`, `terminal-find.browser.test.ts`), root `typecheck` — all green.
- `expo export --platform web` embeds a mermaid-internal string in the dist bundle; `npm run android:development` assembles.
- Two consecutive generator runs → byte-identical outputs.
- Sync rehearsal: fake upstream bump touching both old paths → sync script deletes them; no conflict, no blob in `git show HEAD:<path>`.
- CI invariant step green on clean tree; a 600K one-line `.ts` planted in a src tree fails it with the filename.
- `git grep "RAMBLA-FORK:" -- <each upstream file in the table>` shows a tag in each.

## Risks

- EAS/ iOS builds build in a clean checkout; if any build path skips `build:webviews`, the app build fails loudly (desired, but blocks release until fixed) — mitigated by wiring it into `build:app-deps` and `eas-build-post-install`.
- Another tool globbing `packages/*/src` (Metro crawler, tsconfig include) could silently miss the moved artifacts if bare-specifier resolution regresses; the probe covered NodeNext + Metro but not every bundler path (e.g. future Expo runtime changes).
- CI size invariant can false-positive if upstream lands a legit one-line table/data file >100K in src; warn threshold exists but the hard fail is shape-based, so a data-table false positive is possible.
