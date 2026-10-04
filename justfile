unit := home_dir() / ".config/systemd/user/rambla.service"
desktop := home_dir() / ".local/share/applications/rambla.desktop"
is_macos := if os() == "macos" { "true" } else { "false" }

# Stable install root: `just install-*` builds into this tree; dev builds never write here.
stable_dir := home_dir() / ".local" / "rambla"
# Dedicated clone the stable daemon is built+run from (same shape as deploy/remote-deploy.sh); a real clone, not a worktree.
stable_repo := stable_dir / "repo"

# List recipes.
@list:
    just --list

format:
    npm run format

alias fmt := format

# Redraw every brand asset; pass an SVG to adopt a new design, nothing to redraw from the stored one.
logos svg="":
    node fork/brand/generate.mjs {{ svg }}
    npm run format:files -- packages/app/src/components/icons/rambla-logo.tsx packages/app/src/components/icons/rambla-logo-mask.ts

# Dispatch an iOS TestFlight build and follow it; first arg is the branch/tag to build, empty builds the default branch.
[script]
testflight ref="" quiet="":
    set -eu
    before="$(gh run list --workflow="iOS TestFlight" --limit 1 --json databaseId --jq '.[0].databaseId // 0')"
    if [ -n "{{ ref }}" ]; then
        gh workflow run "iOS TestFlight" --ref "{{ ref }}"
    else
        gh workflow run "iOS TestFlight"
    fi

    # `gh workflow run` does not report the run it created; wait for a new one.
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

# Dispatch a rambla-server image build on the current branch; arg is the platforms choice: linux/amd64 (default), linux/arm64, or linux/amd64,linux/arm64.
docker-server platforms="linux/amd64":
    gh workflow run docker-server.rambla.yml --ref "$(git rev-parse --abbrev-ref HEAD)" -f platforms="{{ platforms }}"

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

[script]
uninstall: stop
    if {{ is_macos }}; then
        rm -f "$HOME/Library/LaunchAgents/rambla.plist"
    else
        systemctl --user disable rambla.service
        rm -f "{{ unit }}"
        just _systemctl-reload
    fi

# Print the provenance at HEAD
[script]
provenance:
    # 1. main — what the plan is written against
    git log -1 --format='- main: %h — %cs' main

    # 2. upstream-rebrand — the rebrand commit main last merged
    r=$(git merge-base main upstream-rebrand)
    git log -1 --format='- upstream-rebrand: %h — %cs' "$r"

    # 3. upstream/main — the tag it was built from: the second parent of its ours-merge parent
    u=$(git rev-parse "$r^^2")
    tag=$(git ls-remote --tags upstream 'refs/tags/v*' | awk -v u="$u" '$1 == u { sub(/^refs\/tags\//, "", $2); sub(/\^\{\}$/, "", $2); print $2 }')
    git log -1 --format="- upstream/main: %h ($tag) — %cs" "$u"

# Create branch <branch> off HEAD in ~/worktrees/rambla/<branch with / as ->, then npm ci and build:server.
[script]
worktree branch:
    set -eu
    dir="$HOME/worktrees/rambla/$(echo "{{ branch }}" | tr / -)"
    git worktree add "$dir" -b "{{ branch }}"
    cd "$dir"
    npm ci
    npm run build:server
    echo "ready: $dir"

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

    sha="$(git rev-parse "{{ branch }}")"
    echo "Branch {{ branch }} — commit ${sha:0:9} — $(git log -1 --pretty=%s "$sha")"

    if [[ " {{ args }} " == *" --watch "* ]]; then
        gh run list -R getrambla/rambla --commit "$sha" --limit 20 --json databaseId,status --jq '.[] | select(.status != "completed") | .databaseId' | while read -r run; do gh run watch "$run" -R getrambla/rambla --compact --exit-status --interval 3; done
        watched=1
    fi

    runs="$(gh run list -R getrambla/rambla --commit "$sha" --limit 20 --json databaseId --jq '.[].databaseId')"
    if [ -z "$runs" ]; then
        echo "${YEL}No workflow runs for this commit yet.${OFF}"
        exit 0
    fi

    failed=0 running=0 passed=0 failed_jobs=""
    now=$(date +%s)

    # Wall time between two ISO stamps; empty end = still going (measure vs now), no start = queued.
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

    if [[ " {{ args }} " == *" --workflow "* ]]; then
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
        [ -z "${watched:-}" ] && {
            echo "Error lines:"
            for job in $failed_jobs; do
                # gh refuses logs containing terminal escapes; strip colour codes before grep.
                gh api "repos/getrambla/rambla/actions/jobs/$job/logs" \
                    --allow-escape-sequences 2>/dev/null \
                    | sed 's/\x1b\[[0-9;]*m//g; s/^[0-9T:.Z-]*Z //' \
                    | grep -E 'FAIL |AssertionError|Expected:|Received:|error TS|npm error code|fatal:|^ *[0-9]+\) \[|^ *Error: ' \
                    | sort -u | head -15 || true
            done
        }
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

[script]
_stop name:
    if {{ is_macos }}; then
        launchctl bootout gui/"$(id -u)" "$HOME/Library/LaunchAgents/{{ name }}.plist" || true
    elif systemctl --user is-active {{ name }}; then
        systemctl --user stop {{ name }}
    fi

[script]
_start name:
    if {{ is_macos }}; then
        launchctl bootstrap gui/"$(id -u)" "$HOME/Library/LaunchAgents/{{ name }}.plist"
    else
        systemctl --user enable {{ name }}
        systemctl --user start {{ name }}
    fi

_restart name: (_stop name) (_start name)

stop-dev-server: (_stop "rambla-dev")

start: stop-dev-server (_start "rambla")

stop: (_stop "rambla")

_systemctl-reload:
    systemctl --user daemon-reload

restart: (_restart "rambla")

[script]
_status name:
    if {{ is_macos }}; then
        launchctl print gui/"$(id -u)"/{{ name }} | sed -n '1,20p'
    else
        systemctl --user status {{ name }}
    fi

status: (_status "rambla")

# Build and run Rambla Debug desktop
dev-desktop:
    npm ci
    npm run build:desktop -- --dir
    npm run dev:desktop

# Build this checkout's server, then stop the installed daemon and run this one detached; the installed daemon restarts when it exits or fails.
[script]
dev-server log_level="debug":
    set -euo pipefail
    eval "$(mise env -C "{{ justfile_dir() }}" -s bash)"
    npm run build:server
    if {{ is_macos }}; then
        just _install-plist rambla-dev "{{ justfile_directory() }}" {{ log_level }} false
        just (_start "rambla-dev")
    else
        systemd-run --user --collect --unit=rambla-dev \
            --working-directory="{{ justfile_dir() }}" \
            --setenv=PATH="$PATH" --setenv=RAMBLA_LOG_LEVEL={{ log_level }} \
            --property=ExecStopPost="systemctl --user start rambla" \
            "$(command -v just)" _dev-server-run
    fi

[script]
_dev-server-run:
    set -euo pipefail
    systemctl --user stop rambla
    cd packages/server
    exec ../cli/bin/rambla daemon run

# Show the dev server's logs; extra args go to journalctl, e.g. -f or -n 100.
[script]
dev-server-logs lines="40" *args:
    if {{ is_macos }}; then
        tail -n {{ lines }} "$HOME/.rambla/rambla-dev.log"
    else
        journalctl --user -n {{ lines }} -u rambla-dev {{ args }}
    fi

# Reinstall the stable daemon and desktop app under stable_dir.
install: install-server install-app

# Build the daemon from the dedicated stable clone and reinstall+restart the systemd user unit. ref: "" = current branch tip (must be pushed), or a SHA/branch/tag. mode: "soft" (default) waits for running turns, "immediate" restarts now. fresh=true wipes node_modules.
[script]
install-server ref="" fresh="false": && install-unit
    set -euo pipefail
    command -v mise >/dev/null 2>&1 || { echo "missing mise" >&2; exit 1; }

    # Dedicated build clone (clone into a sibling, rename only on success); origin is the dev repo itself.
    mkdir -p "{{ stable_dir }}"
    if [ ! -d "{{ stable_repo }}" ]; then
        rm -rf "{{ stable_repo }}.incoming"
        git clone --no-hardlinks "$(git rev-parse --show-toplevel)" "{{ stable_repo }}.incoming"
        mv "{{ stable_repo }}.incoming" "{{ stable_repo }}"
    fi

    # mise env from the dev checkout; running mise inside the clone would install the repo's toolchain pins.
    eval "$(mise env -C "{{ justfile_dir() }}" -s bash)"

    # Build BEFORE touching the unit, so a failed build aborts before restarting the daemon. FETCH_HEAD keeps one code path.
    ref='{{ ref }}'
    if [ -z "$ref" ]; then
        ref="$(git -C "{{ justfile_dir() }}" rev-parse --abbrev-ref HEAD)"
    fi
    cd "{{ stable_repo }}"
    git fetch origin "$ref"
    git checkout --quiet --force FETCH_HEAD
    npm ci
    npm run build:server

    echo "installed daemon to {{ stable_dir }}/daemon"

    # launchd runs outside any shell; mise must trust the clone's .tool-versions itself.
    if {{ is_macos }}; then
        mise trust "{{ stable_repo }}/.tool-versions" || true
    fi

[script]
install-unit: && restart
    if {{ is_macos }}; then
        just _install-plist rambla "{{ stable_repo }}" info true
    else
        just _install-systemd-unit
    fi

# Render a launchd plist for the daemon. name=rambla runs the stable clone; name=rambla-dev runs this checkout.
[script]
_install-plist name path log_level keep_alive:
    set -euo pipefail
    mkdir -p "$HOME/Library/LaunchAgents"
    tmp="$HOME/Library/LaunchAgents/{{ name }}.plist.tmp"
    cat > "$tmp" <<EOF
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Label</key><string>{{ name }}</string>
      <key>ProgramArguments</key>
      <array>
        <string>{{ path }}/packages/cli/bin/rambla</string>
        <string>daemon</string>
        <string>run</string>
      </array>
      <key>WorkingDirectory</key><string>{{ path }}/packages/server</string>
      <key>EnvironmentVariables</key>
      <dict>
        <key>RAMBLA_LOG_LEVEL</key><string>{{ log_level }}</string>
        <key>PATH</key><string>$HOME/.local/share/mise/shims:/usr/bin:/bin:/usr/sbin:/sbin</string>
      </dict>
      <key>StandardOutPath</key><string>$HOME/.rambla/{{ name }}.log</string>
      <key>StandardErrorPath</key><string>$HOME/.rambla/{{ name }}.log</string>
      <key>KeepAlive</key><{{ keep_alive }}/>
      <key>RunAtLoad</key><true/>
      <key>ThrottleInterval</key><integer>5</integer>
    </dict>
    </plist>
    EOF
    plutil -lint "$tmp"
    mv "$tmp" "$HOME/Library/LaunchAgents/{{ name }}.plist"

# Reload systemd and enable+restart the unit (own recipe because install-server's script attribute eats dependencies).
[script]
_install-systemd-unit: && _systemctl-reload
    mkdir -p "$(dirname "{{ unit }}")"
    tmp_unit="$(mktemp "{{ unit }}.XXXXXX")"

    echo "writing unit file"
    cat > "$tmp_unit" <<EOF
    [Unit]
    Description=Rambla daemon

    [Service]
    Type=simple
    WorkingDirectory={{ stable_repo }}/packages/server
    Environment="RAMBLA_LOG_LEVEL=info"
    Environment="PATH=$HOME/.local/bin:$PATH"
    EnvironmentFile=-%h/.rambla/daemon.env
    TimeoutStopSec=15
    # AGENTS: ExecStart MUST be exactly "rambla daemon run" with NO FLAGS. Do NOT add --foreground; it crashes the daemon (removed flag; REMOVED_LAUNCH_FLAGS in packages/cli/src/commands/daemon/local-daemon.ts).
    # If you touch this line, re-run the recipe to prove the daemon starts.
    ExecStart={{ stable_repo }}/packages/cli/bin/rambla daemon run
    Restart=always
    RestartSec=5

    [Install]
    WantedBy=graphical-session.target
    EOF
    echo "wrote unit file"


    # Disable (reads the OLD unit's [Install]) before the mv, or the old symlink is orphaned.
    systemctl --user disable rambla >/dev/null 2>&1 || true
    mv "$tmp_unit" "{{ unit }}"

# Build the desktop app from the stable clone into stable_dir/app; --dir with output redirected so the dev tree's release/ is never involved.
[script]
install-app ref="" fresh="false": && install-desktop
    set -euo pipefail
    command -v mise >/dev/null 2>&1 || { echo "missing mise" >&2; exit 1; }

    # Same dedicated clone as install-server; created here too so install-app works standalone.
    mkdir -p "{{ stable_dir }}"
    if [ ! -d "{{ stable_repo }}" ]; then
        rm -rf "{{ stable_repo }}.incoming"
        git clone --no-hardlinks "$(git rev-parse --show-toplevel)" "{{ stable_repo }}.incoming"
        mv "{{ stable_repo }}.incoming" "{{ stable_repo }}"
    fi

    eval "$(mise env -C "{{ justfile_dir() }}" -s bash)"

    ref='{{ ref }}'
    if [ -z "$ref" ]; then
        ref="$(git -C "{{ justfile_dir() }}" rev-parse --abbrev-ref HEAD)"
    fi
    cd "{{ stable_repo }}"
    git fetch origin "$ref"
    git checkout --quiet --force FETCH_HEAD

    # desktop's own build script compiles its workspace deps first, then electron-builder packs; --dir skips installers.
    if {{ is_macos }}; then
        # No signing identity in CI-less local installs; ad-hoc enough to launch locally.
        npm run build:desktop -- --dir -c.directories.output="{{ stable_dir }}/app-build" -c.mac.notarize=false
    else
        npm run build:desktop -- --dir -c.directories.output="{{ stable_dir }}/app-build"
    fi

    # --dir output lands in <output>/<platform>-unpacked; flatten to stable_dir/app with a swap so the target is never half-replaced.
    if {{ is_macos }}; then
        unpacked="{{ stable_dir }}/app-build/mac-arm64"
        [ -d "$unpacked" ] || unpacked="{{ stable_dir }}/app-build/mac"
    else
        unpacked="{{ stable_dir }}/app-build/linux-unpacked"
    fi
    rm -rf "{{ stable_dir }}/app.old"
    [ -d "{{ stable_dir }}/app" ] && mv "{{ stable_dir }}/app" "{{ stable_dir }}/app.old"
    mv "$unpacked" "{{ stable_dir }}/app"
    rm -rf "{{ stable_dir }}/app-build" "{{ stable_dir }}/app.old"

    echo "installed desktop app to {{ stable_dir }}/app"

# Write the XDG desktop entry pointing into stable_dir/app.
[script]
install-desktop:
    set -euo pipefail
    if {{ is_macos }}; then
        # macOS install = copy the .app bundle into /Applications (swap, never half-replace).
        rm -rf "/Applications/Rambla.app.old"
        [ -d "/Applications/Rambla.app" ] && mv "/Applications/Rambla.app" "/Applications/Rambla.app.old"
        cp -R "{{ stable_dir }}/app/Rambla.app" /Applications/
        rm -rf "/Applications/Rambla.app.old"
        echo "installed Rambla.app to /Applications"
        exit 0
    fi
    mkdir -p "$(dirname "{{ desktop }}")"
    cat > {{ desktop }} <<EOF
    [Desktop Entry]
    Type=Application
    Name=Rambla
    Exec={{ stable_dir }}/app/Rambla
    Icon={{ stable_repo }}/packages/desktop/assets/icon.png
    Categories=Development;
    Terminal=false
    EOF

# Show the stable daemon log tail.
daemon-log lines="40":
    tail -n {{ lines }} ~/.rambla/rambla.log

[script]
_logs name lines:
    if {{ is_macos }}; then
        tail -n {{ lines }} "$HOME/.rambla/{{ name }}.log"
    else
        journalctl --user -n {{ lines }} -u {{ name }}
    fi

logs lines="40": (_logs "rambla" lines)

# Sync each new upstream release tag onto upstream-rebrand, then land it in the checked-out branch through its own merge branch once the local checks and ci.yml pass.
sync-upstream:
    bash fork/sync-upstream.sh
