# fix: move generated webview blobs out of src

Status: approved

## Provenance

- main: `01f83a7bf` — 2026-09-30
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. New private workspace package `packages/generated` (`@getrambla/generated`); the mermaid runtime and terminal webview blobs are generated at build time into its git-ignored `dist/`.
2. The 6 app importers import the blobs from `@getrambla/generated`.
3. `git rm` the 2 tracked blobs.
4. The 2 old blob paths join `DELETE_LIST` in `fork/sync-upstream.sh`, so upstream's copies never return.
5. A CI blob-shape check.

**Not in scope:**

- A root `.ignore` file.
- Metro, tsconfig, vitest, or `.gitignore` edits.
- Other large files (`routeTree.gen.ts`, dist bundles, lockfiles, big test files).
- Docs.

## Acceptance criteria

1. `packages/generated` exists as a workspace package (`@getrambla/generated`); the 2 blobs are generated at build time into its git-ignored `dist/`; a fresh clone, `npm ci` and `npm run build:client` produce them; they survive a later `npm install` or `npm ci`; neither blob is git-tracked; `routeTree.gen.ts` is untouched.
2. CI fails on a `.ts`/`.tsx` file in `packages/*/src` over 200 KB and under 10 lines, printing its path. Generated outputs sit in git-ignored `packages/generated/dist/`, and `npm run lint` and `npm run format:check` do not check them; no `.ignore` file is created.
3. An upstream sync whose tag modifies either old blob path finishes with no conflict, and neither blob is tracked afterward.
4. The protocol validator is not moved or touched: no file under `packages/protocol/` changes except `package.json`, and the validator is still generated to its current path.
5. Manual check: the coder runs `just testflight fix/eradicate-generated-blobs`, then reminds the user to check a mermaid diagram and a terminal on the phone; the user confirms both work.

## Goal

The 2 multi-megabyte one-line webview blobs no longer live in `packages/app/src`, now or after any future upstream merge.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                                 | Edit                                                              | Upstream activity               | Tag                 |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------- | ------------------- |
| `packages/generated/package.json`                                                    | new private package; `exports` `./*` → `dist/`                    | new                             | none (JSON)         |
| `package.json`                                                                       | 1 `workspaces` line                                               | 325 commits, latest `bdc3888cf` | none (JSON)         |
| `package-lock.json`                                                                  | regenerated                                                       | 466 commits                     | none (JSON)         |
| `packages/app/package.json`                                                          | `@getrambla/generated` dependency; `build:webview-bundles` script | 337 commits                     | none (JSON)         |
| `packages/protocol/package.json`                                                     | `postbuild` runs app's `build:webview-bundles`                    | 96 commits                      | none (JSON)         |
| `packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs`               | output into `packages/generated/dist/`                            | 2 commits, latest `fa1f01ebb`   | `RAMBLA-FORK: fix:` |
| `packages/app/scripts/build-terminal-webview-html.mjs`                               | output into `packages/generated/dist/`                            | 2 commits, latest `1f7103ddf`   | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/markdown/fence/mermaid/host.native.tsx`                 | 1 import line                                                     | 2 commits                       | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/markdown/fence/mermaid/iframe-runtime.web.tsx`          | 1 import line                                                     | 1 commit                        | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/markdown/fence/mermaid/runtime/runtime.browser.test.ts` | 1 import line                                                     | 2 commits                       | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/markdown/fence/mermaid/runtime/runtime-html.test.ts`    | 1 import line                                                     | 1 commit                        | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/terminal-emulator-webview.native.tsx`                   | 1 import line                                                     | 4 commits                       | `RAMBLA-FORK: fix:` |
| `packages/app/src/terminal/webview/terminal-find.browser.test.ts`                    | 1 import line                                                     | 2 commits                       | `RAMBLA-FORK: fix:` |
| `packages/app/src/components/markdown/fence/mermaid/runtime/html.gen.ts`             | `git rm`                                                          | 3 commits                       | none (deleted)      |
| `packages/app/src/terminal/webview/terminal-emulator-webview-html.ts`                | `git rm`                                                          | 16 commits, latest `adb94c9a0`  | none (deleted)      |
| `fork/sync-upstream.sh`                                                              | 2 `DELETE_LIST` entries                                           | existing                        | `RAMBLA-FORK: fix:` |
| `fork/sync-upstream.test.mjs`                                                        | covers criterion 3                                                | existing                        | `RAMBLA-FORK: fix:` |
| `.github/workflows/ci.yml`                                                           | blob-shape check step                                             | 65 commits, latest `f83cb0787`  | `RAMBLA-FORK: fix:` |

**Why this shape:** the user chose 1 tagged import line per importer, the 3 upstream tests included, over re-export stubs at the old paths that agents would still grep. Generation hangs off protocol's `postbuild` because every app build path builds protocol first, `build:app-deps:clean` included, which a hook on root `build:client` would miss.

**Branch:** `fix/eradicate-generated-blobs` — required, 15 upstream files changed.

## Cause

[build-runtime.mjs:10](../packages/app/src/components/markdown/fence/mermaid/build-runtime.mjs#L10) and [build-terminal-webview-html.mjs:10](../packages/app/scripts/build-terminal-webview-html.mjs#L10) write 3.5 MB and 1.2 MB one-line files into `packages/app/src`, and both are committed. One grep match on either returns the whole blob into an agent's context. Upstream commits both, so every sync brings them back unless [sync-upstream.sh:196](../fork/sync-upstream.sh#L196) strips them through `DELETE_LIST`.

## Constraints

- No file changes beyond the table.
- No Metro, tsconfig, vitest, or `.gitignore` edits. Imports have no file extension.
- `build:terminal-webview` and `build:mermaid-runtime` keep their names.
- The 3 upstream tests keep their assertions; only the import line changes.
- The 2 blobs leave only via `git rm`; no history rewrite.
- Generators stay idempotent: two runs produce byte-identical output.
- The CI check stays out of the `changes` job ([ci-workflow.test.mjs:120](../scripts/ci-workflow.test.mjs#L120)) and keeps `sync-upstream-tests` the last job ([sync-upstream.test.mjs:1569](../fork/sync-upstream.test.mjs#L1569)).

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. Create `packages/generated` and add it to root `workspaces`; regenerate the lockfile. Both generators write a `.js` and a `.d.ts` per blob into `packages/generated/dist/`; app's `build:webview-bundles` runs both; protocol's `postbuild` runs it. The 6 importers import from `@getrambla/generated`; `git rm` both blobs.
   **Acceptance criteria**: plan criteria 1 and 4; `runtime-html.test.ts` passes from `packages/app`. Then criterion 5: the coder pushes the branch after step 1's commit, dispatches TestFlight, and reminds the user; step 2 waits for the user's confirmation.
2. `fork/sync-upstream.sh`: add both old blob paths to `DELETE_LIST`; extend `fork/sync-upstream.test.mjs` with an upstream tag that modifies them.
   **Acceptance criteria**: plan criterion 3, asserted by the test.
3. `.github/workflows/ci.yml`: add the blob-shape check.
   **Acceptance criteria**: plan criterion 2; the check passes on this branch and fails, naming the file, on a planted 300 KB one-line `.ts` in a `packages/*/src` folder.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- From `packages/app`: `npx vitest run src/components/markdown/fence/mermaid/runtime/runtime-html.test.ts --bail=1`
- The `fork/sync-upstream.test.mjs` test.
- `git ls-files` lists neither old blob path.
- `git grep "RAMBLA-FORK:" --` each tagged file in the table — every one must show a tag.
- Criterion 5 on the phone.

## Risks

- Docker and Nix builds were not run with the protocol `postbuild`; `nix.yml` runs only on pushes to main.
- A future upstream one-line data file over 200 KB in `src` fails the CI check.
- Web, Android and desktop exports were proved in a worktree at `a8d62ddf1`, not at current main; iOS was never exported before criterion 5.
