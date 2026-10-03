# feat: daemon-owned tool catalog and mise-backed installs

Status: approved

Prerequisite: [2026-10-02-feat-rambla-server-image.md](2026-10-02-feat-rambla-server-image.md)

## Provenance

- main: `585ce9375` - 2026-10-02
- upstream-rebrand: `bdc3888cf` - 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) - 2026-09-28

## Goal

The daemon owns its tool list and installs tools on its own host at user level through mise, so a remote server can be set up from the CLI with no manual shell work.

## Scope

**In scope:**

1. A fork-owned server tool catalog: claude, codex, copilot, opencode, pi, gh, and uv, each named by its mise registry short name with a pinned version, plus an `agents` group of the five built-in providers.
2. A server wrapper that runs mise as the daemon user to list, install, upgrade, and uninstall catalog tools.
3. Four dotted RPCs (`daemon.tool.list`, `daemon.tool.install`, `daemon.tool.upgrade`, `daemon.tool.uninstall`), gated on a new optional `server_info.features.toolInstall` flag, with permissions in the existing permission map.
4. `rambla tool ls|install|upgrade|uninstall`, working against local or remote daemons through the existing `--host` and relay paths.
5. A provider snapshot refresh after every install, upgrade, or uninstall.
6. A fork script that generates a server-side ACP provider catalog (no icons) from upstream's app catalog, run by `fork/sync-upstream.sh` in each upstream merge commit, with a staleness test.

**Prerequisite:** `plans/2026-10-02-feat-rambla-server-image.md` provides mise in the `rambla-server` image: pinned and checksum-verified, installed outside `/home/rambla`, with mise's directories taken from the image's `XDG_DATA_HOME` and `XDG_CONFIG_HOME` under `/home/rambla`, and `/home/rambla/.local/share/mise/shims` on the daemon's PATH. That plan does not set `MISE_DATA_DIR` or `MISE_CONFIG_DIR`, and neither does this one ([mise directories](https://mise.jdx.dev/directories.html)).

**Not in scope:**

- Speech and its config default.
- The 15 catalog agents that only have vendor install scripts, and any other catalog-entry install.
- App UI, i18n strings, and any edit to `packages/app`, including `packages/app/src/data/acp-provider-catalog.ts`.
- Mapping mise errors to friendlier text.
- Installing or bootstrapping mise on hosts without it.
- Pruning old tool versions from mise's data dir.
- Agent auto-update control (later plan).
- Multi-user, per-principal tool sets, and new permissions.
- Any Dockerfile, including `fork/docker/Dockerfile.server`; the prerequisite plan owns it.
- The `justfile`.
- `package.json`, upstream's `docker/base/Dockerfile`, `docs/docker.md`, and `docker/Dockerfile.agents.example`.
- glab, tea, python, and other tools not listed above.

## Acceptance criteria

1. `rambla tool ls` prints every catalog tool with its group, catalog pin, and installed version (or "not installed").
2. `rambla tool install <tool|group>...` installs each named tool at its catalog pin; `--version X` installs version X and `--latest` the newest. A group name expands to its member tools. An unknown name fails before mise runs and lists the valid names.
3. `rambla tool upgrade` with no args moves every installed catalog tool to its catalog pin; with names, only those tools. `--latest` moves them to the newest version instead. A Rambla release that bumps a pin is picked up by the next `rambla tool upgrade`.
4. `rambla tool uninstall <tool|group>...` removes each named tool, and `rambla tool ls` then shows it as not installed.
5. Installs run as the daemon user at user level; the installed tool and mise's global config live under the daemon user's home.
6. When mise exits non-zero, the CLI exits non-zero and prints mise's output unchanged. When mise exits zero, the CLI exits zero.
7. When `mise` is not on the daemon's PATH, every `tool` command fails with a message saying mise was not found on the host, and nothing runs.
8. After a successful install, upgrade, or uninstall of a provider tool, `rambla provider ls` against the same daemon shows that provider's new availability without a daemon restart or manual refresh.
9. The CLI works against a remote daemon via `--host` and via a relay pairing URL. Against a daemon without `server_info.features.toolInstall`, it prints a message telling the user to update the host and sends no tool RPC.
10. Install, upgrade, and uninstall require `daemon.manage`; list requires `daemon.read`. A session without the permission is denied.
11. An older client still parses every message from the new daemon, and the new daemon still parses every message from an older client: all new schema fields are optional or live in new message types.
12. Running `node fork/generate-acp-catalog.mjs` reproduces the committed server-side ACP catalog byte for byte; a test fails when the committed file differs from the generator's output. The generated file carries every app catalog entry's id, title, description, version, install link, command, env, and params, and no icons.
13. `fork/sync-upstream.sh` regenerates the server-side ACP catalog in the `merge-<tag>` worktree and the result lands in that tag's "merge upstream $tag" commit. No commit on `upstream-rebrand` contains a change to the generated file.
14. With the prerequisite image, a tool installed through `rambla tool install` survives replacing the container with a new one that mounts the same `/home/rambla` volume.
15. `rambla tool ls` reports only tools from mise's global config. A project mise config in the daemon's working directory never changes the listing.
16. `node fork/generate-acp-catalog.mjs` runs on plain `node` in a checkout with no `node_modules`.

## Outside facts

- mise registry short names `claude`, `codex`, `copilot`, `opencode`, `pi`, `gh`, `uv` all resolve: `mise registry <name>` on mise 2026.9.17 printed a backend for each. Registry: https://mise.jdx.dev/registry.html
- `mise use --global` writes the global config: https://mise.jdx.dev/cli/use.html. `mise unuse --global` removes from it: https://mise.jdx.dev/cli/unuse.html
- `mise ls --json` returns an object keyed by tool name, and `--global` limits it to the global config: https://mise.jdx.dev/cli/ls.html. A local run showed entries with `version`, `installed`, and `active` fields.
- mise documents no exit-code table; errors print as free text: https://mise.jdx.dev/errors.html. That mise exits zero on success and non-zero on failure is UNVERIFIED.
- mise's default directories follow `XDG_DATA_HOME` and `XDG_CONFIG_HOME`: https://mise.jdx.dev/directories.html. `MISE_DATA_DIR` and `MISE_CONFIG_DIR` override them; only the manual dev check uses them: https://mise.jdx.dev/configuration.html
- Adding mise's shims dir to PATH makes installed tools findable by command name outside a shell: https://mise.jdx.dev/dev-tools/shims.html

## Merge conflict mitigation

**Files this work changes:**

| File                                                                       | Edit                                                                                                                                                                       | Upstream activity            | Tag                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------- |
| `packages/protocol/src/tool.rambla.ts`                                     | request and response schemas for the four RPCs                                                                                                                             | new                          | `RAMBLA-FORK: feature:` |
| `packages/protocol/src/messages.ts`                                        | 1 import at end of import block; 4 request schemas in the inbound union; 4 response schemas in the outbound union; 1 optional `toolInstall` flag in `server_info.features` | 136 commits, last 2026-09-27 | `RAMBLA-FORK: feature:` |
| `packages/protocol/src/tool.rambla.test.ts`                                | schema parsing, old-shape compatibility                                                                                                                                    | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/authorization/operation-permissions.ts`        | 4 inbound and 4 outbound entries                                                                                                                                           | 17 commits, last 2026-09-23  | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/tool-catalog.rambla.ts`                   | tool and group catalog with pins                                                                                                                                           | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/mise.rambla.ts`                           | mise detection and commands                                                                                                                                                | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/tool-session.rambla.ts`                   | RPC handlers and snapshot refresh                                                                                                                                          | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/tool.rambla.test.ts`                      | catalog, mise wrapper, handlers                                                                                                                                            | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/session.ts`                                    | 1 import at end of import block; 1 dispatch call into `tool-session.rambla.ts`                                                                                             | 572 commits, last 2026-09-23 | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/websocket-server.ts`                           | `toolInstall: true` in the features block                                                                                                                                  | 237 commits, last 2026-09-27 | `RAMBLA-FORK: feature:` |
| `packages/client/src/daemon-client.ts`                                     | 4 methods in 1 contiguous block, each gated on `toolInstall`                                                                                                               | 100 commits, last 2026-09-27 | `RAMBLA-FORK: feature:` |
| `packages/cli/src/commands/tool/index.rambla.ts`                           | `tool` command group and its 4 subcommands                                                                                                                                 | new                          | `RAMBLA-FORK: feature:` |
| `packages/cli/src/commands/tool/tool.rambla.test.ts`                       | argument parsing, exit codes, output                                                                                                                                       | new                          | `RAMBLA-FORK: feature:` |
| `packages/cli/src/cli.ts`                                                  | 1 import at end of import block; 1 `addCommand`                                                                                                                            | 56 commits, last 2026-09-21  | `RAMBLA-FORK: feature:` |
| `fork/generate-acp-catalog.mjs`                                            | ACP catalog generator with a `--check` mode                                                                                                                                | new; `fork/` is ours         | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/acp-provider-catalog.generated.rambla.ts` | generated ACP catalog                                                                                                                                                      | new                          | `RAMBLA-FORK: feature:` |
| `packages/server/src/server/tool/acp-provider-catalog.rambla.test.ts`      | staleness and content check                                                                                                                                                | new                          | `RAMBLA-FORK: feature:` |
| `fork/sync-upstream.sh`                                                    | run the generator and stage its output in each merge commit                                                                                                                | existing, ours               | none                    |
| `fork/sync-upstream.test.mjs`                                              | fixture carries the generator and a stand-in catalog; assert regeneration                                                                                                  | existing, ours               | none                    |
| `RAMBLA-CHANGELOG.md`                                                      | the entry the `code` skill requires                                                                                                                                        | existing, ours               | none                    |

**Why this shape:** all logic lives in new `.rambla.` files. Upstream files get only registration lines: imports, union members, permission entries, a feature flag, one dispatch call, and client methods. Each of those is a single list every RPC must appear in; [operation-permissions.ts](../packages/server/src/server/authorization/operation-permissions.ts#L8) is typed against every inbound message type. The client methods stay in `daemon-client.ts` because they need its private request helper, as [installPluginSource](../packages/client/src/daemon-client.ts#L5377) does.

## Constraints

- No file outside the table changes. `packages/app` is untouched.
- Each step writes its tests first and sees them fail, then writes the code that passes them.
- No install, version, or update logic of our own. Every install, upgrade, uninstall, and installed-version read goes through mise. Tools are named by registry short name, with no backend prefix. Installed state comes from mise's JSON output, never from human text.
- mise always targets the global config, never a project config. The listing uses mise's global filter.
- No code this plan ships sets `MISE_DATA_DIR` or `MISE_CONFIG_DIR`; only the manual dev check's scratch environment does.
- The ACP generator runs on plain `node` with no installed packages, as `fork/build-changelog.mjs` does: in `fork/sync-upstream.sh` it runs before `npm ci`. It runs only in the `merge-<tag>` worktree, never on or into `upstream-rebrand`.
- Upgrade re-applies the catalog pin (or `latest` with `--latest`) to each installed tool through the same global `use` that install runs. Never `mise upgrade`.
- mise output reaches the user verbatim; no error mapping, no retries.
- mise detection reuses [executable-resolution.ts](../packages/server/src/executable-resolution/executable-resolution.ts).
- Snapshot refresh reuses `refreshSettingsSnapshot` in [provider-snapshot-manager.ts](../packages/server/src/server/agent/provider-snapshot-manager.ts#L302); no new refresh path.
- Wire schemas stay pure: no `.transform()`, `.catch()`, `.preprocess()`; `z.discriminatedUnion` where a literal tag is shared; the `toolInstall` flag is optional and carries a `COMPAT(toolInstall)` tag with a removal date six months out.
- The client gates once, in each new method, on `toolInstall`; no fallback.
- The client timeout for install and upgrade is at least as long as `installPluginSource`'s.
- `cli.ts` gives every top-level command except `plugin` a `-v, --version` option ([cli.ts](../packages/cli/src/cli.ts#L176)). The `tool` command resolves the clash inside `index.rambla.ts` by enabling positional options on itself, so `--version` after `install` or `upgrade` belongs to that subcommand. `cli.ts` gets no other edit. If that does not work, stop and report.
- No new launch flags on any daemon command; never `--foreground`.
- Upstream test files are not edited.
- Unit tests use a stand-in `mise` executable on PATH that records its arguments and exits with a chosen code and output. Real mise runs only in the manual checks.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor; do not amend this plan and do not re-decide placement while coding.
   - **Acceptance criteria** no code written in this step.
1. **Tool catalog and mise wrapper.** Create `tool-catalog.rambla.ts` and `mise.rambla.ts` under `packages/server/src/server/tool/`. Tools use the registry short names `claude`, `codex`, `copilot`, `opencode`, `pi`, `gh`, `uv`, each pinned to the newest version `mise ls-remote <name>` reports at coding time. Group `agents` holds the five providers. Each provider tool records its provider id.
   - **Acceptance criteria** `tool.rambla.test.ts` proves: group names expand to members; an unknown name is rejected with the valid names before mise runs; install passes `<name>@<pin>` to mise's global `use` by default, `<name>@X` with a version, and `<name>@latest` with latest; upgrade passes `<name>@<pin>` (or `@latest`) to the same global `use` for installed tools only, and only for the named ones when names are given; uninstall passes the names to mise's global `unuse`; installed versions are read from mise's JSON listing with the global filter, so a tool the stand-in reports only from a project config in the daemon's working directory does not appear (criterion 15); a missing mise yields the "mise not found on the host" result and runs nothing; a non-zero exit returns failure with mise's output unchanged. Delivers 2, 3, 4, 6, 7, 15 at the module level.
2. **Protocol.** Create `packages/protocol/src/tool.rambla.ts` with the four request and response schemas, register them in `messages.ts`, and add the optional `toolInstall` feature flag.
   - **Acceptance criteria** `packages/protocol/src/tool.rambla.test.ts` proves: the inbound union accepts each of the four requests; the outbound union accepts each response; a parsed `server_info` keeps `toolInstall: true` and still parses without it. Each of these fails before the change. `npm run typecheck` passes. Delivers 11.
3. **Daemon handlers.** Create `tool-session.rambla.ts`; wire it into `session.ts` with one dispatch call; add the eight permission entries; set `toolInstall: true` in `websocket-server.ts`. After a successful install, upgrade, or uninstall, refresh the settings snapshot for the affected provider ids before responding.
   - **Acceptance criteria** `tool.rambla.test.ts` proves each handler returns the mise result and that a successful provider install triggers a snapshot refresh for that provider. The permission map typechecks and maps list to `daemon.read` and the other three to `daemon.manage`. Delivers 5, 8, 10.
4. **Client and CLI.** Add the four methods to `daemon-client.ts`; create `packages/cli/src/commands/tool/index.rambla.ts` with `ls`, `install`, `upgrade`, `uninstall`, using the existing JSON and daemon-host options; register it in `cli.ts`.
   - **Acceptance criteria** `packages/cli/src/commands/tool/tool.rambla.test.ts` proves: `rambla tool install claude --version 1.2.3` passes `1.2.3` to install; `rambla tool --version` still prints the CLI version; `--version` and `--latest` are mutually exclusive; exit code follows mise's; mise's output prints unchanged; against a daemon without `toolInstall`, the command prints the update-the-host message and sends no tool request. Delivers 1, 2, 3, 4, 6, 7, 9. **Tom tries the CLI against a dev daemon (see Verification) before step 5.**
5. **ACP catalog generator.** Create `fork/generate-acp-catalog.mjs` with its `--check` mode, and the generated `acp-provider-catalog.generated.rambla.ts`. In `fork/sync-upstream.sh`, run the generator in the `merge-<tag>` worktree right after `node "$WT/fork/build-changelog.mjs"` and `git add CHANGELOG.md`, and stage its output for the same "merge upstream $tag" commit. Extend `fork/sync-upstream.test.mjs`: its fixture carries the generator and a stand-in app catalog, and has no `node_modules`.
   - **Acceptance criteria** `acp-provider-catalog.rambla.test.ts` is an ordinary unit test CI runs; it fails when the committed file differs from the generator output and checks every entry's fields against the app catalog. The generated file passes `npm run format:check`. `node --test fork/sync-upstream.test.mjs` passes, with new cases proving: each "merge upstream $tag" commit carries the regenerated file; no `upstream-rebrand` commit changes it; the generator succeeds with no `node_modules`. Delivers 12, 13, 16. **After this step, Tom checks the real image from the prerequisite plan: `rambla tool install agents gh uv` succeeds, and after replacing the container on the same volume `rambla tool ls` still lists them and `rambla provider ls` shows the five providers available (criterion 14).**

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/protocol/src/tool.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/tool/tool.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/tool/acp-provider-catalog.rambla.test.ts --bail=1`
- `npx vitest run packages/cli/src/commands/tool/tool.rambla.test.ts --bail=1`
- `node --test fork/sync-upstream.test.mjs`
- `git grep "RAMBLA-FORK:" -- packages/protocol/src/messages.ts packages/server/src/server/session.ts packages/server/src/server/websocket-server.ts packages/server/src/server/authorization/operation-permissions.ts packages/client/src/daemon-client.ts packages/cli/src/cli.ts` - every one shows a tag.
- Manual, dev daemon with real mise: start the dev daemon with `MISE_DATA_DIR` and `MISE_CONFIG_DIR` pointed at a scratch directory and that scratch `shims` dir first on PATH, so Tom's own mise setup is untouched. Then `npm run cli -- tool install codex`; `npm run cli -- provider ls` shows codex available; `npm run cli -- tool uninstall codex`.
- Manual, relay: `rambla tool ls` with a relay pairing URL as `--host` lists the tools.
- Manual, image from the prerequisite plan: the check at the end of step 5.

## Risks

- mise documents no exit codes and no stable output; a mise upgrade can change behavior. The prerequisite image pins mise.
- The registry picks each tool's backend, and a mise upgrade can change it. The prerequisite image's pin holds it still.
- A daemon whose PATH lacks the shims dir installs tools the providers can't find. The prerequisite image sets PATH; other hosts are out of scope.
- Criterion 14 depends on the prerequisite plan, which is unapproved; steps 1-5 do not.
