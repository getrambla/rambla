#!/usr/bin/env bash
# Sync each new upstream release tag onto upstream-rebrand as an ours-merge commit, then a rebrand commit. No arguments.

set -euo pipefail

# The fork owns these at upstream's paths (the logos fork/brand/generate.mjs writes, the nix hash); globs match upstream's names and ours.
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
	date -u -d "@${DATE[$1]}" '+%Y-%m-%d %H:%M:%S UTC'
}

# Fails the run unless tag $2, the higher version, was tagged after tag $1.
require_later() {
	[ "${DATE[$2]}" -gt "${DATE[$1]}" ] && return 0
	echo "error: $2 (version ${2#v}, tagged $(when "$2")) is not tagged after $1 (version ${1#v}, tagged $(when "$1"))" >&2
	exit 1
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

declare -A COMMIT=() DATE=() MINOR=()
for tag in "$FLOOR" "${TAGS[@]}"; do
	COMMIT[$tag]="$(git rev-parse "${OBJ[$tag]}^{commit}")"
	DATE[$tag]="$(tag_date "${OBJ[$tag]}")"
	[[ $tag =~ ^v[0-9]+\.[0-9]+ ]]
	MINOR[$tag]="${BASH_REMATCH[0]}"
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
	for other in "${TAGS[@]}"; do
		if [ "$other" = "$tag" ] || [ "${MINOR[$other]}" != "${MINOR[$tag]}" ]; then continue; fi
		if newer "$other" "$tag"; then require_later "$tag" "$other"; else require_later "$other" "$tag"; fi
	done
	NEWEST="$tag"
	if [ -n "${REBRAND_OF[${COMMIT[$tag]}]:-}" ]; then continue; fi
	REBRAND_OF[${COMMIT[$tag]}]=planned
	PLAN+=("$tag")
done

if [ ${#PLAN[@]} -eq 0 ]; then
	echo "$BRANCH already holds every release tag through $NEWEST"
	exit 0
fi

WT="$(mktemp -d)"
trap 'git worktree remove --force "$WT" || rm -rf "$WT"' EXIT
git worktree add --detach "$WT" "$BRANCH"

for tag in "${PLAN[@]}"; do
	merge="$(git -C "$WT" commit-tree -p HEAD -p "${COMMIT[$tag]}" -m "merge upstream $tag with -s ours" 'HEAD^{tree}')"
	git -C "$WT" read-tree -u --reset "${COMMIT[$tag]}"
	# -f because read-tree just staged the tag's copies, which git rm otherwise refuses to drop.
	git -C "$WT" rm -r -f --ignore-unmatch -- "${DELETE_LIST[@]}"
	(cd "$WT" && bash "$HERE/rebrand.sh")
	npm --prefix "$HERE/.." run format:files -- "$WT"
	git -C "$WT" add -A
	rebrand="$(git -C "$WT" commit-tree -p "$merge" -m "rebrand upstream $tag" "$(git -C "$WT" write-tree)")"
	git -C "$WT" reset --soft "$rebrand"
	echo "synced $tag onto $BRANCH"
done

TIP="$(git -C "$WT" rev-parse HEAD)"
git push --atomic origin "$TIP:refs/heads/$BRANCH"
git branch -f "$BRANCH" "$TIP"
