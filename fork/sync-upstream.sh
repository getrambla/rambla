#!/usr/bin/env bash
# Sync each new upstream release tag onto upstream-rebrand as an ours-merge commit, then a rebrand commit; then land the newest tag's rebrand commit in the checked-out branch through its own merge branch once ci.yml passes. No arguments.

set -euo pipefail

# The fork owns these at upstream's paths (the logos fork/brand/generate.mjs writes, the nix hash); globs match upstream's names and ours.
# RAMBLA-FORK: feature: (no plan): the brand artwork entries keep upstream's logos from ever landing.
DELETE_LIST=(
	"fastlane/metadata/android/en-US/images/icon.png"
	"nix/npm-deps.hash"
	"packages/app/assets/images/android-icon-foreground.png"
	"packages/app/assets/images/favicon-dark-attention.png"
	"packages/app/assets/images/favicon-dark-attention.svg"
	"packages/app/assets/images/favicon-dark-running.png"
	"packages/app/assets/images/favicon-dark-running.svg"
	"packages/app/assets/images/favicon-dark.png"
	"packages/app/assets/images/favicon-dark.svg"
	"packages/app/assets/images/favicon-light-attention.png"
	"packages/app/assets/images/favicon-light-attention.svg"
	"packages/app/assets/images/favicon-light-running.png"
	"packages/app/assets/images/favicon-light-running.svg"
	"packages/app/assets/images/favicon-light.png"
	"packages/app/assets/images/favicon-light.svg"
	"packages/app/assets/images/favicon.png"
	"packages/app/assets/images/icon.png"
	"packages/app/assets/images/notification-icon.png"
	"packages/app/assets/images/splash-icon.png"
	"packages/app/public/apple-touch-icon.png"
	"packages/app/public/pwa-icon-192.png"
	"packages/app/public/pwa-icon-512.png"
	"packages/app/src/components/icons/*-logo-mask.ts"
	"packages/app/src/components/icons/*-logo.tsx"
	# RAMBLA-FORK: fix: 2026-09-30-fix-eradicate-generated-blobs.md: keeps upstream's generated webview blobs out of the fork.
	"packages/app/src/components/markdown/fence/mermaid/runtime/html.gen.ts"
	"packages/app/src/terminal/webview/terminal-emulator-webview-html.ts"
	"packages/desktop/assets/icon-dev.png"
	"packages/desktop/assets/icon.icns"
	"packages/desktop/assets/icon.ico"
	"packages/desktop/assets/icon.png"
	"packages/website/public/favicon.ico"
	"packages/website/public/favicon.svg"
	"packages/website/public/logo.svg"
)

UPSTREAM_URL="https://github.com/getpaseo/paseo.git"
BRANCH="upstream-rebrand"
# The newest tag the old sync reached; tags at or below it are never synced or checked.
FLOOR="v0.10.0-beta.1"
# CI runs the same checks, so the sync workflow turns these off.
LOCAL_SYNC="${LOCAL_SYNC:-0}"
# Turn this off once the flaky Playwright tests are fixed.
IGNORE_PLAYWRIGHT_TESTS="${IGNORE_PLAYWRIGHT_TESTS:-1}"
# CI runs the end-to-end and integration tests; locally only unit tests run.
UNIT=(-- --exclude '**/*e2e*' --exclude '**/*integration*' --exclude '**/generic-acp-agent.commands.test.ts')

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$(git rev-parse --show-toplevel)"
export LEFTHOOK=0

# Sorts versions from stdin, oldest first.
by_version() {
	# sort -V puts "~" before the end of a string, so a prerelease sorts below its release.
	sed 's/-/~/' | sort -V | sed 's/~/-/'
}

# True when version $1 is higher than version $2.
newer() {
	[ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | by_version | tail -n 1)" = "$1" ]
}

# Prints a tag's date as Unix seconds: the tagger's, or the commit's for a tag that records none.
tag_date() {
	local date=""
	if [ "$(git cat-file -t "$1")" = tag ]; then
		date="$(git cat-file tag "$1" | sed -n '/^$/q; s/^tagger .* \([0-9][0-9]*\) [-+][0-9]*$/\1/p')"
	fi
	[ -n "$date" ] || date="$(git show -s --format=%ct "$1^{commit}")"
	echo "$date"
}

# Prints a tag's date in UTC.
when() {
	node -e 'console.log(new Date(process.argv[1] * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC")' "${DATE[$1]}"
}

# Fails the run unless tag $2, the higher version, was tagged after tag $1.
require_later() {
	[ "${DATE[$2]}" -gt "${DATE[$1]}" ] && return 0
	echo "error: $2 (version ${2#v}, tagged $(when "$2")) is not tagged after $1 (version ${1#v}, tagged $(when "$1"))" >&2
	exit 1
}

# True unless switch value $1 is 0 or false.
on() {
	[ "$1" != 0 ] && [ "$1" != false ]
}

# Runs one local check in the merge branch's worktree; a failure pushes the merge branch, left on origin and in the worktree to fix, and stops the run.
check() {
	if ! (cd "$WT" && "$@"); then
		git push origin "$(git -C "$WT" rev-parse HEAD):refs/heads/$MB"
		echo "error: local check failed: $*; $MB is left on origin and in $WT to fix by hand, then run again" >&2
		exit 1
	fi
}

TARGET="$(git symbolic-ref --short HEAD)"

git config remote.upstream.url || git remote add upstream "$UPSTREAM_URL"
git fetch --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH" "+refs/heads/$TARGET:refs/remotes/origin/$TARGET"

DIRTY="$(git status --porcelain --untracked-files=no)"
if [ -n "$DIRTY" ]; then
	printf 'error: %s has uncommitted changes:\n%s\n' "$TARGET" "$DIRTY" >&2
	exit 1
fi
AHEAD="$(git log --oneline "origin/$TARGET..$TARGET")"
if [ -n "$AHEAD" ]; then
	printf 'error: %s has commits origin lacks:\n%s\n' "$TARGET" "$AHEAD" >&2
	exit 1
fi
git merge --ff-only "origin/$TARGET"
git branch -f "$BRANCH" "origin/$BRANCH"

declare -A OBJ=()
while read -r obj ref; do
	OBJ[${ref#refs/tags/}]="$obj"
done < <(git ls-remote --tags --refs upstream 'refs/tags/v*')
if [ -z "${OBJ[$FLOOR]:-}" ]; then
	echo "error: upstream has no $FLOOR tag" >&2
	exit 1
fi

TAGS=()
past_floor=""
while read -r tag; do
	if [ -n "$past_floor" ]; then TAGS+=("$tag"); fi
	if [ "$tag" = "$FLOOR" ]; then past_floor=1; fi
done < <(printf '%s\n' "${!OBJ[@]}" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$' | by_version)

git fetch --no-tags upstream "+refs/heads/main:refs/remotes/upstream/main" "refs/tags/$FLOOR" "${TAGS[@]/#/refs/tags/}"

declare -A COMMIT=() DATE=()
for tag in "$FLOOR" "${TAGS[@]}"; do
	COMMIT[$tag]="$(git rev-parse "${OBJ[$tag]}^{commit}")"
	DATE[$tag]="$(tag_date "${OBJ[$tag]}")"
done

# Commit messages are never trusted: only an ours-merge link on the first-parent history marks a tag as synced.
declare -A REBRAND_OF=()
child="" merge="" merge_tree="" merge_second=""
while read -r commit tree _ second _; do
	# Newest first, so this commit is the first parent of the one read before it.
	if [ -n "$merge_second" ] && [ -n "$child" ] && [ "$tree" = "$merge_tree" ]; then
		REBRAND_OF[$merge_second]="$child"
	fi
	child="$merge" merge="$commit" merge_tree="$tree" merge_second="${second:-}"
done < <(git log --first-parent --format='%H %T %P' "$BRANCH")

NEWEST="$FLOOR"
for tag in "${TAGS[@]}"; do
	if [ -n "${REBRAND_OF[${COMMIT[$tag]}]:-}" ]; then NEWEST="$tag"; fi
done

# Every check runs before the first commit, so a bad tag stops the run with nothing built.
PLAN=()
for tag in "${TAGS[@]}"; do
	newer "$tag" "$NEWEST" || continue
	git merge-base --is-ancestor "${COMMIT[$tag]}" upstream/main || continue
	require_later "$NEWEST" "$tag"
	NEWEST="$tag"
	if [ -n "${REBRAND_OF[${COMMIT[$tag]}]:-}" ]; then continue; fi
	REBRAND_OF[${COMMIT[$tag]}]=planned
	PLAN+=("$tag")
done

RWT=""
trap '[ -z "$RWT" ] || git worktree remove --force "$RWT" || rm -rf "$RWT"' EXIT

if [ ${#PLAN[@]} -eq 0 ]; then
	echo "$BRANCH already holds every release tag through $NEWEST"
else
	RWT="$(mktemp -d)"
	git worktree add --detach "$RWT" "$BRANCH"
fi

for tag in "${PLAN[@]}"; do
	merge="$(git -C "$RWT" commit-tree -p HEAD -p "${COMMIT[$tag]}" -m "merge upstream $tag with -s ours" 'HEAD^{tree}')"
	git -C "$RWT" read-tree -u --reset "${COMMIT[$tag]}"
	# -f because read-tree just staged the tag's copies, which git rm otherwise refuses to drop.
	git -C "$RWT" rm -r -f --ignore-unmatch -- "${DELETE_LIST[@]}"
	(cd "$RWT" && bash "$HERE/rebrand.sh")
	npm --prefix "$HERE/.." run format:files -- "$RWT"
	git -C "$RWT" add -A
	rebrand="$(git -C "$RWT" commit-tree -p "$merge" -m "rebrand upstream $tag" "$(git -C "$RWT" write-tree)")"
	git -C "$RWT" reset --soft "$rebrand"
	REBRAND_OF[${COMMIT[$tag]}]="$rebrand"
	echo "synced $tag onto $BRANCH"
done

if [ ${#PLAN[@]} -gt 0 ]; then
	TIP="$(git -C "$RWT" rev-parse HEAD)"
	git push --atomic origin "$TIP:refs/heads/$BRANCH"
	git branch -f "$BRANCH" "$TIP"
fi

TARGET_TIP="$(git rev-parse "origin/$TARGET")"
MERGES=()
for tag in "${TAGS[@]}"; do
	rebrand="${REBRAND_OF[${COMMIT[$tag]}]:-}"
	if [ -n "$rebrand" ] && ! git merge-base --is-ancestor "$rebrand" "$TARGET_TIP"; then MERGES+=("$tag"); fi
done
if [ ${#MERGES[@]} -eq 0 ]; then
	echo "$TARGET already holds every rebrand commit on $BRANCH"
	exit 0
fi
# Only the newest tag is merged; its rebrand commit carries every older one.
MERGES=("${MERGES[${#MERGES[@]}-1]}")

# A merge branch already in the target branch is spent and deleted; one that is not is the next tag's, left by a stop, and resumed.
EXISTING=""
REMOTE_MERGES="$(git ls-remote --heads origin 'refs/heads/merge-*')"
while read -r sha ref; do
	if [ -z "$ref" ]; then continue; fi
	git fetch --no-tags origin "$ref"
	if git merge-base --is-ancestor "$sha" "$TARGET_TIP"; then
		git push origin --delete "${ref#refs/heads/}"
		echo "deleted ${ref#refs/heads/}: already landed in $TARGET"
	else
		EXISTING="${ref#refs/heads/}"
	fi
done <<<"$REMOTE_MERGES"

WORKTREES="$HOME/worktrees/rambla"

# gh would pick the upstream remote over origin, so name origin's repo.
REPO="$(git remote get-url origin | sed -E 's#\.git$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')"

for tag in "${MERGES[@]}"; do
	MB="merge-$tag"
	WT="$WORKTREES/$MB"
	if [ "$MB" = "$EXISTING" ]; then
		git fetch --no-tags origin "refs/heads/$MB"
		HEAD_SHA="$(git rev-parse FETCH_HEAD)"
		echo "using $MB from origin at $HEAD_SHA"
	else
		echo "merging $tag's rebrand commit into $MB, cut from $TARGET at $TARGET_TIP"
		mkdir -p "$WORKTREES"
		git worktree add -b "$MB" "$WT" "$TARGET_TIP"
		# A conflict is listed below; any other merge failure stops the run here.
		git -C "$WT" merge --no-ff --no-commit "${REBRAND_OF[${COMMIT[$tag]}]}" || [ -n "$(git -C "$WT" ls-files --unmerged)" ]
		# The rebrand commit lacks the delete list, so the merge would otherwise take its deletions.
		KEEP="$(git -C "$WT" diff --cached --name-only "$TARGET_TIP" -- "${DELETE_LIST[@]}")"
		if [ -n "$KEEP" ]; then git -C "$WT" checkout "$TARGET_TIP" --pathspec-from-file=- <<<"$KEEP"; fi
		CONFLICTS="$(git -C "$WT" diff --name-only --diff-filter=U)"
		if [ -n "$CONFLICTS" ]; then
			printf 'error: merging %s conflicts; %s is left unpushed in %s to resolve, commit and push to origin, then run again. Conflicted paths:\n%s\n' "$tag" "$MB" "$WT" "$CONFLICTS" >&2
			exit 1
		fi
		node "$WT/fork/build-changelog.mjs"
		node "$WT/fork/build-readme.mjs"
		git -C "$WT" add CHANGELOG.md README.md
		git -C "$WT" commit -m "merge upstream $tag"
		if on "$LOCAL_SYNC"; then
			check npm ci
			check npm run build:server
			check npm run build:app-deps
			check npm run typecheck
			check npm run test:unit --workspace=packages/server "${UNIT[@]}"
			check npm run test:unit --workspace=packages/cli "${UNIT[@]}"
			for pkg in desktop client highlight plugin protocol relay; do
				check npm run test --workspace="packages/$pkg" "${UNIT[@]}"
			done
			check npm run test --workspace=packages/app "${UNIT[@]}" --project unit
		fi
		HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
		git push origin "$HEAD_SHA:refs/heads/$MB"
	fi

	RUN=""
	until [ -n "$RUN" ]; do
		RUN="$(gh run list -R "$REPO" --workflow ci.yml --branch "$MB" --commit "$HEAD_SHA" --json databaseId --jq '.[0].databaseId // empty')"
		# GitHub lists a push's run some seconds after the push.
		[ -n "$RUN" ] || sleep 10
	done
	gh run watch -R "$REPO" "$RUN"
	FAILED="$(gh run view -R "$REPO" "$RUN" --json jobs --jq '.jobs[] | select(.conclusion != "success" and .conclusion != "skipped") | .name')"
	BAD=()
	while IFS= read -r job; do
		if [ -z "$job" ]; then continue; fi
		if on "$IGNORE_PLAYWRIGHT_TESTS" && [[ "$job" =~ ^playwright\ \(shard\ [1-4]/4\)$ ]]; then
			echo "ignoring $job while IGNORE_PLAYWRIGHT_TESTS is on"
			continue
		fi
		BAD+=("$job")
	done <<<"$FAILED"
	if [ ${#BAD[@]} -gt 0 ]; then
		printf 'error: ci.yml failed on %s, left on origin to fix by hand. Failed jobs:\n' "$MB" >&2
		printf '%s\n' "${BAD[@]}" >&2
		exit 1
	fi

	if ! git push origin "$HEAD_SHA:refs/heads/$TARGET"; then
		git fetch --no-tags origin "+refs/heads/$TARGET:refs/remotes/origin/$TARGET"
		echo "error: cannot fast-forward $TARGET at $(git rev-parse "origin/$TARGET") to $MB at $HEAD_SHA; merge $TARGET into $MB by hand, push it, and run again" >&2
		exit 1
	fi
	git push origin --delete "$MB"
	if [ -d "$WT" ]; then
		git worktree remove --force "$WT"
		git branch -D "$MB"
	fi
	echo "landed $tag in $TARGET"
	TARGET_TIP="$HEAD_SHA"
done
