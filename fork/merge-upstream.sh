#!/usr/bin/env bash
# Sync upstream into this fork. Runs the same way locally and in CI.
#
# The fork renames Paseo to Rambla everywhere, so upstream's text and the
# fork's text disagree on almost every line that mentions the brand. Merging
# upstream directly means fighting that on every sync.
#
# upstream-rebrand is a standing branch holding upstream's tree with the rename
# applied. Because it is an ancestor of main, the merge base between them is
# always a rebranded commit, so the fork's side of a brand-only file matches
# that base and git simply takes upstream's change. Recreating this branch from
# scratch would put the merge base back on unrenamed upstream and every brand
# conflict would return. It must persist.
#
# Leaves the merge staged and uncommitted. The caller decides whether the
# result builds before committing it.
#
# Usage: fork/merge-upstream.sh

set -euo pipefail

UPSTREAM_URL="https://github.com/getpaseo/paseo.git"
BRANCH="upstream-rebrand"

REPO="$(git rev-parse --show-toplevel)"
HERE="$REPO/fork"

git -C "$REPO" remote get-url upstream >/dev/null 2>&1 ||
	git -C "$REPO" remote add upstream "$UPSTREAM_URL"
git -C "$REPO" fetch upstream --quiet
git -C "$REPO" fetch origin "$BRANCH" --quiet 2>/dev/null || true
git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH" ||
	git -C "$REPO" branch "$BRANCH" "origin/$BRANCH"

TIP=$(git -C "$REPO" rev-parse --short upstream/main)

# A worktree keeps the rebrand branch off the main checkout, so a half-finished
# sync never leaves the working tree in a strange state.
WT=$(mktemp -d)
trap 'git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true' EXIT
git -C "$REPO" worktree add --quiet "$WT" "$BRANCH"

# Record that upstream has been absorbed, then throw away everything that merge
# decided about file contents and take upstream's tree outright. The `ours`
# strategy never looks at the other side, so it cannot conflict.
git -C "$WT" merge -s ours --no-commit upstream/main >/dev/null
git -C "$WT" read-tree -u --reset upstream/main

(cd "$WT" && bash "$HERE/rebrand.sh")
"$REPO/node_modules/.bin/oxfmt" "$WT" >/dev/null

git -C "$WT" add -A
# Most days upstream has not moved and there is nothing new to rebrand.
git -C "$WT" diff --cached --quiet ||
	LEFTHOOK=0 git -C "$WT" commit -q -m "rebrand upstream through $TIP"

git -C "$REPO" merge "$BRANCH" --no-commit --no-ff || true

CONFLICTS=$(git -C "$REPO" diff --name-only --diff-filter=U)
if [ -n "$CONFLICTS" ]; then
	echo "conflicted files:"
	echo "$CONFLICTS"
	exit 1
fi
echo "merged upstream through $TIP with no conflicts"
