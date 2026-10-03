# feat: server-only Docker image published as rambla-server

Status: done

## Provenance

- main: `585ce9375` - 2026-10-02
- upstream-rebrand: `bdc3888cf` - 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) - 2026-09-28

## Goal

Publish a lean, daemon-only public image on release tags or on demand, with mise for installing tools into the data volume, that any server can track through `latest`, `beta`, or `dev`.

## Scope

**In scope:**

1. A new Dockerfile that builds an image holding only the Rambla daemon: `@getrambla/server` and the workspace packages it depends on at runtime (`client`, `protocol`, `relay`, `highlight`, `plugin`).
2. A new GitHub Actions workflow that builds that image and pushes it to the GHCR package `rambla-server` under the getrambla org.
3. A `publish-server` recipe in our `justfile` that starts a manual run of that workflow.
4. mise in the image, so users can install tools from inside the container into the data volume.
5. Upstream's runtime OS packages (`git`, `curl`, `openssh-client`, and the rest of its apt list) stay as-is. No other tools are baked in: no `gh`, no agent CLIs, no Rambla CLI.

**Not in scope:**

- Any upstream file, any existing workflow (including its triggers), and `docs/`.
- The web UI, Expo app, desktop, website, `@getrambla/cli`, and agent CLIs.
- Deploying to the server (SSH, pull, Podman or Quadlet config) and GHCR package visibility.
- Installing tools through mise, and any in-app install UI.

## Acceptance criteria

1. The workflow has no push-to-branch trigger. Pushing a release tag matching `v*` (the pattern `.github/workflows/docker.yml` and `docs/release.md` use) builds and publishes automatically.
2. A tag run builds `linux/amd64` and `linux/arm64` as 1 multi-arch image and pushes `sha-<first 12 chars of the commit>` and the version (the git tag without its leading `v`, e.g. `0.10.2`). A stable tag (no prerelease suffix, e.g. `v0.10.2`) also pushes `latest`. A prerelease tag (e.g. `v0.10.0-beta.1`) also pushes `beta` and never moves `latest`.
3. A manual run from any branch or tag ref always builds and publishes, never skips, and pushes `dev` and `sha-<commit>`; it never moves `latest` or `beta`. It has a `platforms` choice input: `linux/amd64` (default), `linux/arm64`, or both.
4. Running the image with no arguments and `RAMBLA_PASSWORD` set starts the daemon on port 6767, and `GET /api/health` returns 200.
5. The daemon in the image has the web UI disabled, and the installed server package has no `dist/server/web-ui` directory.
6. The only `@getrambla/*` packages installed in the image are `server`, `client`, `protocol`, `relay`, `highlight`, and `plugin`.
7. The image build never runs the web UI export (`build:daemon-web-ui` or `expo export`).
8. The existing `Docker` workflow and its build cache are untouched: the new workflow uses its own cache scope.
9. `git diff --name-status main` on the work branch shows no upstream file modified or deleted; outside `plans/`, it lists only the files in the mitigation table.
10. `just publish-server` starts a manual run of the new workflow on the current branch with `platforms` set to `linux/amd64`; `just publish-server <platforms>` passes the given choice instead.
11. On both image platforms, `mise --version` runs as the `rambla` user and reports the pinned release.
12. Inside the container, mise's data and config dirs resolve under `/home/rambla` (`~/.local/share/mise` and `~/.config/mise`), and the image sets neither `MISE_DATA_DIR` nor `MISE_CONFIG_DIR`.
13. The image `PATH` includes `/home/rambla/.local/share/mise/shims`, and the daemon process sees it.
14. The mise binary lives outside `/home/rambla` (e.g. `/usr/local/bin`), so a container started from a newer image with an existing `/home/rambla` volume runs that image's pinned mise.

## Merge conflict mitigation

**Files this work changes:**

| File                                       | Edit                                                 | Upstream activity                                                         | Tag                  |
| ------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------- | -------------------- |
| `fork/docker/rambla-server.Dockerfile`     | new daemon-only Dockerfile                           | new; `fork/` is ours and [rebrand.sh](../fork/rebrand.sh#L33) skips it    | `RAMBLA-FORK: feat:` |
| `.github/workflows/fork-rambla-server.yml` | new workflow: build and push `rambla-server` to GHCR | new; the `fork-` prefix cannot collide with an upstream or rebranded name | `RAMBLA-FORK: feat:` |
| `justfile`                                 | add a `publish-server` recipe                        | existing, ours (absent from `upstream-rebrand`)                           | none                 |
| `RAMBLA-CHANGELOG.md`                      | append the entry the `code` skill requires           | existing, ours (absent from `upstream-rebrand`)                           | none                 |

Read-only references, never edited: `docker/base/Dockerfile` (last upstream touch 2026-09-14), `docker/base/rootfs/usr/local/bin/rambla-docker-entrypoint` (2026-09-14), `.github/workflows/docker.yml` (2026-09-21).

**Why this shape:** no upstream file changes. The new Dockerfile mirrors upstream's 2-stage build and copies upstream's entrypoint at build time, so upstream fixes to it arrive without a merge.

## Constraints

- No file changes outside the mitigation table.
- Test-first is waived for this plan: there is no unit test. Proof is a real manual run that publishes `dev` and `sha-<commit>`; `latest` and `beta` are proven on the next stable and beta tags.
- The coder never starts the workflow and never pushes. The maintainer runs the proof run.
- mise is pinned to a release (current: `v2026.10.0`) and each platform's binary is verified against that release's published `SHASUMS256.txt` during the build. Its default dirs follow `XDG_DATA_HOME` and `XDG_CONFIG_HOME` ([mise directories](https://mise.jdx.dev/directories.html)); the shims dir is `~/.local/share/mise/shims` ([mise shims](https://mise.jdx.dev/dev-tools/shims.html)).
- Do not run the server package's [prepack](../packages/server/package.json#L78): it builds the web UI. Build the server stack with the root `build:server` script, then pack with npm's ignore-scripts option (a scratch test on npm 10.9.3 confirmed it skips `prepack`).
- Install the packed tarballs in a single global install, as upstream's Dockerfile does; `@getrambla/*` packages are not on the npm registry (`npm view` returns 404).
- The web UI defaults off in [config.ts](../packages/server/src/server/config.ts#L395), but upstream's [entrypoint](../docker/base/rootfs/usr/local/bin/rambla-docker-entrypoint#L9) defaults it on, so the image sets `RAMBLA_WEB_UI_ENABLED=false`.
- Reuse upstream's entrypoint, user setup, environment layout, volume, port, and healthcheck as-is. No new launch flags; never `--foreground`.
- The only workflow input is `platforms`. No version input, no publish toggle, no deploy step.
- Concurrency matches [docker.yml](../.github/workflows/docker.yml#L33): an in-progress run is never cancelled.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor; do not amend this plan and do not re-decide placement while coding.
   - **Acceptance criteria** no code written in this step.
1. Create `fork/docker/rambla-server.Dockerfile`, modeled on `docker/base/Dockerfile`: the build stage installs the workspace, builds the server stack, and packs only the 6 daemon packages; the runtime stage installs them globally, records the supervisor entrypoint path as upstream does, sets up the `rambla` user and directories, copies upstream's `docker/base/rootfs/`, disables the web UI, installs the checksum-verified mise binary for the target platform, and adds the mise shims dir to `PATH`. Fork tag as a header comment.
   - **Acceptance criteria** `podman build -f fork/docker/rambla-server.Dockerfile -t rambla-server:local .` from the repo root succeeds, and the local image meets criteria 4, 5, 6, 7, 11, 12, 13, and 14 (`mise doctor` as the `rambla` user shows its dirs under `/home/rambla`; `command -v mise` resolves outside `/home/rambla`; the daemon process environment contains the shims dir; build log shows no web UI export; `npm ls -g` in the container lists only the 6 `@getrambla/*` packages named in criterion 6; `/api/health` returns 200 with `RAMBLA_PASSWORD` set).
2. Create `.github/workflows/fork-rambla-server.yml`, modeled on the publish job in `.github/workflows/docker.yml`: triggers on `v*` tag pushes and on manual dispatch with the `platforms` input; tag runs use both platforms; logs in to GHCR with `GITHUB_TOKEN`; sets up QEMU when arm64 is built; builds the Dockerfile from step 1; pushes the tags from criteria 2 and 3 to `ghcr.io/<lowercased owner>/rambla-server`; uses a GitHub Actions cache scope named `rambla-server`; never cancels an in-progress run. Fork tag as a header comment.
   - **Acceptance criteria** `npm run format:files -- --check .github/workflows/fork-rambla-server.yml` passes; the file meets criteria 1, 2, 3, and 8 on reading.
3. Add a `publish-server` recipe to the `justfile`, in the style of the existing `testflight` recipe: a comment line, an optional platforms argument defaulting to `linux/amd64`, and a manual run of the new workflow on the current branch.
   - **Acceptance criteria** `just --dry-run publish-server` and `just --dry-run publish-server linux/arm64` print a dispatch of `fork-rambla-server` on the current branch with the given platforms value (criterion 10); `just --list` shows the recipe. The maintainer runs the proof run after merge: a green run, GHCR showing `dev` and `sha-<commit>` for `linux/amd64`, and `latest` unmoved.

## Verification

- `npm run format:files -- --check .github/workflows/fork-rambla-server.yml`
- `git diff --name-status main` meets criterion 9.
- `git grep "RAMBLA-FORK:" -- fork/docker/rambla-server.Dockerfile .github/workflows/fork-rambla-server.yml` shows a tag in each.
- Local: `podman build` from step 1, then `podman run` with `RAMBLA_PASSWORD` set and `-p 6767:6767`; `curl http://127.0.0.1:6767/api/health` returns 200; `podman exec` checks for criteria 11, 12, 13, and 14.
- After merge, the maintainer's proof run: `just publish-server` gives a green run, and `podman pull ghcr.io/getrambla/rambla-server:dev` works.
- Next stable tag: GHCR shows `latest`, the version, and `sha-<commit>`. Next beta tag: `beta`, the version, and `sha-<commit>`, with `latest` unmoved.

## Risks

- A manual run needs the workflow file on the default branch ([GitHub docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch)), so the workflow is first proven after merge.
- Tag runs build arm64 under QEMU, which can be much slower than native ([Docker docs](https://docs.docker.com/build/building/multi-platform/)); no arm64 build has been run, so criterion 11 on arm64 is first proven by a tag run or an arm64 manual run.
- No image has been built yet; the npm version inside `node:22-bookworm-slim` was not checked against the ignore-scripts test.
