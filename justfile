unit := home_dir() / ".config/systemd/user/rambla.service"
desktop := home_dir() / ".local/share/applications/rambla.desktop"

# List recipes.
@list:
    just --list

format:
    npm run format

alias fmt := format

testflight:
    gh workflow run "iOS TestFlight"

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

install: install-app install-daemon

[script]
install-daemon: && install-service
    eval "$(mise env -s bash)"
    npm install
    npm run build:server

[script]
install-service: systemctl-reload && restart
    mkdir -p "$(dirname "{{unit}}")"
    echo "installing unit to: {{unit}}"
    cat > {{unit}} <<EOF
    [Unit]
    Description=Rambla daemon

    [Service]
    Type=simple
    WorkingDirectory={{justfile_dir()}}
    ExecStart={{justfile_dir()}}/packages/cli/bin/rambla daemon run
    Restart=always
    RestartSec=5

    [Install]
    WantedBy=graphical-session.target
    EOF


# # Incremental - Broken - Install dependencies, build, install rambla service unit.
# [script]
# install:
#     set -euo pipefail
#     if ! command -v mise >/dev/null 2>&1; then
#         echo "error: 'mise' is required (it pins the Node version this repo builds with)."
#         echo "  install: https://mise.jdx.dev/installing-mise.html  (then: mise install)"
#         exit 1
#     fi
#     eval "$(mise env -s bash)"

#     npm install
#     ./tsconfig/build.sh

#     if [ "$have_systemd" != "yes" ]; then
#         echo "[install] done (build only — no service installed on this platform)"
#         exit 0
#     fi

#     systemctl --user restart rambla
#     sleep 2
#     if systemctl --user is-active --quiet rambla; then
#         echo "[install] rambla.service installed and running."
#         echo "  logs:      just log"
#         echo "  rebuild:   just restart"
#     else
#         echo "error: rambla.service did not come up. Check:" >&2
#         echo "  journalctl --user -u rambla -n 50 --no-pager" >&2
#         exit 1
#     fi

# Build the desktop app.
[script]
install-app: && install-desktop
    set -euo pipefail
    eval "$(mise env -s bash)"
    # npm ci
    # SKIP linux packages with -- --dir
    npm run build:desktop -- --dir

# Write the desktop launcher (XDG .desktop entry).
[script]
install-desktop:
    set -euo pipefail
    mkdir -p "$(dirname "{{desktop}}")"
    cat > {{desktop}} <<EOF
    [Desktop Entry]
    Type=Application
    Name=Rambla
    Exec={{justfile_dir()}}/packages/desktop/release/linux-unpacked/Rambla
    Icon={{justfile_dir()}}/packages/desktop/assets/icon.png
    Categories=Development;
    Terminal=false
    EOF

# Show the daemon log tail.
daemon-log lines="40":
    tail -n {{lines}} ~/.rambla/daemon.log

logs lines="40":
    journalctl --user -n {{lines}} -u rambla
