unit := home_dir() / ".config/systemd/user/rambla.service"
desktop := home_dir() / ".local/share/applications/rambla.desktop"

# Stable install root: `just install-*` builds into this tree, so the daemon
# service and desktop app survive `just clean` and repo work. Dev builds never
# write here, and stable builds never read this checkout's dist/.
stable_dir := home_dir() / ".local" / "rambla"
# Dedicated clone the stable daemon is built+run from (same shape as
# deploy/remote-deploy.sh): the stable build compiles from git, never from
# this checkout's build state. A real clone, not a git worktree — a worktree
# would share the dev tree's object store and reintroduce dev/stable coupling.
stable_repo := stable_dir / "repo"

# List recipes.
@list:
    just --list

format:
    npm run format

alias fmt := format

# Redraw every brand asset — app, store, desktop, web, favicons, in-app mark.
# Pass an SVG to adopt a new design; pass nothing to redraw from the stored one.
logos svg="":
    node fork/brand/generate.mjs {{svg}}
    npm run format:files -- packages/app/src/components/icons/rambla-logo.tsx packages/app/src/components/icons/rambla-logo-mask.ts

# Dispatch an iOS TestFlight build and follow it. Ctrl-C stops watching, not
# the build. Pass any second argument (`just testflight "" quiet`) to dispatch
# and exit. The first argument is the branch or tag to build; empty builds the
# repo's default branch.
[script]
testflight ref="" quiet="":
    set -eu
    before="$(gh run list --workflow="iOS TestFlight" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
    if [ -n "{{ ref }}" ]; then
        gh workflow run "iOS TestFlight" --ref "{{ ref }}"
    else
        gh workflow run "iOS TestFlight"
    fi

    # `gh workflow run` does not report the run it created, so wait for one
    # that is not the run that was already there.
    run_id=""
    for _ in $(seq 1 30); do
        now="$(gh run list --workflow="iOS TestFlight" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
        if [ "$now" != "$before" ]; then run_id="$now"; break; fi
        sleep 2
    done
    if [ -z "$run_id" ]; then
        echo 'error: no new run appeared in 60s. Check: gh run list --workflow="iOS TestFlight"' >&2
        exit 1
    fi

    job_id=""
    for _ in $(seq 1 30); do
        job_id="$(gh run view "$run_id" --json jobs --jq '.jobs[] | select(.name == "build") | .databaseId' 2>/dev/null || true)"
        if [ -n "$job_id" ]; then break; fi
        sleep 2
    done
    if [ -n "$job_id" ]; then
        echo "Step detail:  gh run view --job=$job_id"
    fi

    if [ -n "{{ quiet }}" ]; then
        echo "Live view:    gh run watch $run_id"
        exit 0
    fi
    gh run watch "$run_id"

# Build rambla
[script]
build:
    set -euo pipefail
    if ! command -v mise >/dev/null 2>&1; then
        echo "error: 'mise' is required (it pins the Node version this repo builds with)."
        echo "  install: https://mise.jdx.dev/installing-mise.html  (then: mise install)"
        exit 1
    fi
    eval "$(mise env -s bash)"
    ./tsconfig/build.sh

# Uninstall systemd unit.
uninstall: stop systemctl-reload
    systemctl --user disable rambla.service
    rm -f "{{unit}}"

# Clean build outputs.
[script]
clean: stop
    set -euo pipefail
    rm -rf node_modules **/node_modules
    rm -rf packages/desktop/release packages/*/dist
    find . -name '*.tsbuildinfo' -not -path './node_modules/*' -delete
    rm -rf packages/app/.expo/types
    echo "cleaned: all dist outputs and build state removed"

# CI status for a branch's tip commit, per job. Answers now; does not wait for slow jobs.
[script]
ci branch="main" *args="":
    set -euo pipefail
    RED=$(tput -T xterm-256color setaf 1) YEL=$(tput -T xterm-256color setaf 3) GRN=$(tput -T xterm-256color setaf 2) OFF=$(tput -T xterm-256color sgr0)

    sha="$(git rev-parse "{{branch}}")"
    echo "Branch {{branch}} — commit ${sha:0:9} — $(git log -1 --pretty=%s "$sha")"

    runs="$(gh run list -R getrambla/rambla --commit "$sha" --limit 20 --json databaseId --jq '.[].databaseId')"
    if [ -z "$runs" ]; then
        echo "${YEL}No workflow runs for this commit yet.${OFF}"
        exit 0
    fi

    failed=0 running=0 passed=0 failed_jobs=""
    now=$(date +%s)

    # Wall time between two ISO stamps. An empty end stamp means the job is still
    # going, so measure against now; no start stamp at all means it is queued.
    duration() {
        started="$1"
        ended="$2"
        if [ -z "$started" ] || [ "$started" = "null" ]; then
            echo "queued"
            return
        fi
        began=$(date -d "$started" +%s 2>/dev/null) || { echo "?"; return; }
        if [ -z "$ended" ] || [ "$ended" = "null" ]; then
            finish=$now
        else
            finish=$(date -d "$ended" +%s 2>/dev/null) || finish=$now
        fi
        secs=$((finish - began))
        [ "$secs" -lt 0 ] && secs=0
        if [ "$secs" -ge 60 ]; then
            echo "$((secs / 60))m $((secs % 60))s"
        else
            echo "${secs}s"
        fi
    }

    finished_lines=() attention_lines=()
    for run in $runs; do
        while IFS=$'\t' read -r name conclusion job_id started_at completed_at; do
            case "$conclusion" in
                success)  passed=$((passed + 1))
                          finished_lines+=("  ${GRN}passed${OFF}   $name  $(duration "$started_at" "$completed_at")") ;;
                skipped)  ;;
                pending) running=$((running + 1))
                          attention_lines+=("  ${YEL}running${OFF}  $name  $(duration "$started_at" "")") ;;
                *)        failed=$((failed + 1)); failed_jobs="$failed_jobs $job_id"
                          attention_lines+=("  ${RED}FAILED${OFF}   $name ($conclusion)  $(duration "$started_at" "$completed_at")  run $run") ;;
            esac
        done < <(gh api "repos/getrambla/rambla/actions/runs/$run/jobs" --paginate \
            --jq '.jobs[] | [.name, (.conclusion // "pending"), (.id | tostring), (.started_at // ""), (.completed_at // "")] | @tsv')
    done

    [ ${#finished_lines[@]} -gt 0 ] && printf '%s\n' "${finished_lines[@]}"
    [ ${#attention_lines[@]} -gt 0 ] && printf '%s\n' "${attention_lines[@]}"

    echo
    echo "${GRN}$passed passed${OFF}, ${RED}$failed failed${OFF}, ${YEL}$running still running${OFF}"

    if [[ " {{args}} " == *" --workflow "* ]]; then
        echo
        echo "Upstream workflow changes not yet on origin/main (what the auto-merge would try to push):"
        git fetch upstream main -q
        if git diff --quiet origin/main...upstream/main -- .github/workflows/; then
            echo "${GRN}none — .github/workflows/ matches upstream${OFF}"
        else
            echo "${YEL}"
            git --no-pager diff origin/main...upstream/main -- .github/workflows/
            echo "${OFF}"
        fi
    fi

    if [ "$failed" -gt 0 ]; then
        echo
        echo "Error lines:"
        for job in $failed_jobs; do
            # gh refuses logs containing terminal escapes unless asked, and the
            # colour codes have to come off before grep can match anything.
            gh api "repos/getrambla/rambla/actions/jobs/$job/logs" \
                --allow-escape-sequences 2>/dev/null \
                | sed 's/\x1b\[[0-9;]*m//g; s/^[0-9T:.Z-]*Z //' \
                | grep -E 'FAIL |AssertionError|Expected:|Received:|error TS|npm error code|fatal:|^ *[0-9]+\) \[|^ *Error: ' \
                | sort -u | head -15 || true
        done
        exit 1
    fi

# Headless e2e suites (no device). Stops at the first failure.
e2e: e2e-server e2e-cli e2e-app e2e-desktop

e2e-server:
    PORT=26767 npm run test:integration -w @getrambla/server

e2e-cli:
    PORT=26768 npm run test:local -w @getrambla/cli

e2e-app:
    npm run test:e2e -w @getrambla/app

e2e-desktop:
    npm run test:e2e:renderer -w @getrambla/desktop

start:
    systemctl --user start rambla

stop:
    systemctl --user stop rambla || true

systemctl-reload:
    systemctl --user daemon-reload

restart:
    systemctl --user enable rambla
    systemctl --user restart rambla

status:
    systemctl --user status rambla

# Reinstall the stable daemon and desktop app under stable_dir.
install: install-daemon install-app

# Build the daemon from the dedicated stable clone and reinstall+restart the
# systemd user unit running from there. The stable daemon never reads this
# checkout's dist/ — it is built from git, same shape as deploy/remote-deploy.sh.
# ref: "" (default) installs the dev checkout's current branch tip (must be
#      pushed — the clone fetches from origin); a SHA/branch/tag installs
#      exactly that ref, e.g. `just install-daemon main` or `just install-daemon "" info immediate`.
# mode: "soft" (default) waits for running agent turns to finish before
#       restarting (popups are auto-denied); "immediate" restarts right away.
# fresh: pass fresh=true to wipe node_modules and npm ci from scratch (slow;
#       escape hatch if the incremental install ever drifts).
# The daemon's data directory (~/.rambla) is untouched — no migration.
[script]
install-daemon ref="" log_level="info" mode="soft" fresh="false": && install-service
    set -euo pipefail
    command -v mise >/dev/null 2>&1 || { echo "missing mise" >&2; exit 1; }

    if [ "{{mode}}" != "soft" ] && [ "{{mode}}" != "immediate" ]; then
        echo "unknown mode '{{mode}}' (use soft or immediate)" >&2
        exit 1
    fi

    # Dedicated build clone (clone into a sibling, rename only on success, so
    # stable_repo is never a half-finished checkout). origin is the dev repo
    # itself, so unpushed local commits are installable; uncommitted work is not.
    mkdir -p "{{stable_dir}}"
    if [ ! -d "{{stable_repo}}" ]; then
        rm -rf "{{stable_repo}}.incoming"
        git clone --no-hardlinks "$(git rev-parse --show-toplevel)" "{{stable_repo}}.incoming"
        mv "{{stable_repo}}.incoming" "{{stable_repo}}"
    fi

    # mise env from the dev checkout: running mise inside the clone would try
    # to install the repo's rust/java/android toolchain pins.
    eval "$(mise env -C "{{justfile_dir()}}" -s bash)"

    # Build BEFORE touching the unit, so a failed build aborts here instead of
    # restarting the daemon on stale code. Empty ref = the dev checkout's
    # current branch tip (must be pushed); otherwise install exactly that
    # SHA/branch/tag. FETCH_HEAD keeps one code path for all cases.
    ref='{{ref}}'
    if [ -z "$ref" ]; then
        ref="$(git -C "{{justfile_dir()}}" rev-parse --abbrev-ref HEAD)"
    fi
    cd "{{stable_repo}}"
    git fetch origin "$ref"
    git checkout --quiet --force FETCH_HEAD
    if [ "{{fresh}}" = "true" ] || [ ! -d node_modules ]; then
        npm ci
    else
        # Incremental: with warm node_modules this only installs the delta.
        npm install
    fi
    npm run build:server

    if [ "{{mode}}" = "soft" ]; then
        # The worker drains gracefully on SIGTERM (finishes running agent
        # turns, auto-denying popups) — give it room before systemd SIGKILLs.
        TIMEOUT_STOP_SEC=2400
    else
        TIMEOUT_STOP_SEC=90
    fi

    # The daemon runs from the clone it was built in (like remote-deploy.sh);
    # the packages keep their installed node_modules alongside dist/.
    # Render to a temp file then rename, so a failed render never leaves a
    # truncated unit.
    mkdir -p "$(dirname "{{unit}}")"
    tmp_unit="$(mktemp "{{unit}}.XXXXXX")"

    # The user manager starts this unit before the session PATH is imported,
    # so bake this shell's PATH (with mise's node) into the unit.
    # NEVER pass --foreground (or any other removed launch flag) on ExecStart:
    # the CLI hard-errors on removed flags (REMOVED_LAUNCH_FLAGS in
    # packages/cli/src/commands/daemon/local-daemon.ts) and the daemon never
    # starts. `daemon run` is already foreground — do not "make it explicit".
    cat > "$tmp_unit" <<EOF
    [Unit]
    Description=Rambla daemon

    [Service]
    Type=simple
    WorkingDirectory={{stable_repo}}/packages/server
    Environment="RAMBLA_LOG_LEVEL={{log_level}}"
    Environment="PATH=$HOME/.local/bin:$PATH"
    TimeoutStopSec=$TIMEOUT_STOP_SEC
    ExecStart={{stable_repo}}/packages/cli/bin/rambla daemon run
    Restart=always
    RestartSec=5

    [Install]
    WantedBy=graphical-session.target
    EOF

    # Disable (reads the OLD unit's [Install]) before the mv, or the old
    # symlink is orphaned.
    systemctl --user disable rambla >/dev/null 2>&1 || true
    mv "$tmp_unit" "{{unit}}"

    echo "installed daemon to {{stable_dir}}/daemon"

# Reload systemd and enable+restart the unit (kept as its own recipe because
# install-daemon's script attribute would otherwise eat the dependencies).
install-service: systemctl-reload && restart

# Build the desktop app from the stable clone directly into stable_dir/app —
# electron-builder --dir with its output directory redirected via config
# override, so the dev tree's release/ folder is never involved.
# ref/fresh: same meaning as install-daemon.
[script]
install-app ref="" fresh="false": && install-desktop
    set -euo pipefail
    command -v mise >/dev/null 2>&1 || { echo "missing mise" >&2; exit 1; }

    # Same dedicated clone as install-daemon; created here too so install-app
    # works standalone.
    mkdir -p "{{stable_dir}}"
    if [ ! -d "{{stable_repo}}" ]; then
        rm -rf "{{stable_repo}}.incoming"
        git clone --no-hardlinks "$(git rev-parse --show-toplevel)" "{{stable_repo}}.incoming"
        mv "{{stable_repo}}.incoming" "{{stable_repo}}"
    fi

    eval "$(mise env -C "{{justfile_dir()}}" -s bash)"

    ref='{{ref}}'
    if [ -z "$ref" ]; then
        ref="$(git -C "{{justfile_dir()}}" rev-parse --abbrev-ref HEAD)"
    fi
    cd "{{stable_repo}}"
    git fetch origin "$ref"
    git checkout --quiet --force FETCH_HEAD
    if [ "{{fresh}}" = "true" ] || [ ! -d node_modules ]; then
        npm ci
    else
        # Incremental: with warm node_modules this only installs the delta.
        npm install
    fi

    # desktop's own build script compiles its workspace deps first, then
    # electron-builder packs. --dir skips installers; -c directories.output
    # redirects output straight into stable_dir — no dev-tree release/.
    npm run build:desktop -- --dir -c directories.output="{{stable_dir}}/app-build"

    # --dir output lands in <output>/linux-unpacked; flatten to stable_dir/app
    # with a swap so the launcher target is never half-replaced.
    rm -rf "{{stable_dir}}/app.old"
    [ -d "{{stable_dir}}/app" ] && mv "{{stable_dir}}/app" "{{stable_dir}}/app.old"
    mv "{{stable_dir}}/app-build/linux-unpacked" "{{stable_dir}}/app"
    rm -rf "{{stable_dir}}/app-build" "{{stable_dir}}/app.old"

    echo "installed desktop app to {{stable_dir}}/app"

# Write the XDG desktop entry pointing into stable_dir/app.
[script]
install-desktop:
    set -euo pipefail
    mkdir -p "$(dirname "{{desktop}}")"
    cat > {{desktop}} <<EOF
    [Desktop Entry]
    Type=Application
    Name=Rambla
    Exec={{stable_dir}}/app/Rambla
    Icon={{stable_repo}}/packages/desktop/assets/icon.png
    Categories=Development;
    Terminal=false
    EOF

# Show the daemon log tail.
daemon-log lines="40":
    tail -n {{lines}} ~/.rambla/daemon.log

logs lines="40":
    journalctl --user -n {{lines}} -u rambla
