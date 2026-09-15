#!/usr/bin/env bash
# Sync upstream's newest stable release into this fork. Runs the same way
# locally and in CI.
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
# --no-tags: upstream's release tags would land in this repo's tag namespace and
# collide with the fork's own. Tag pushes also trigger the release workflows.
git -C "$REPO" fetch upstream --quiet --no-tags
git -C "$REPO" fetch origin "$BRANCH" --quiet 2>/dev/null || true
git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH" ||
	git -C "$REPO" branch "$BRANCH" "origin/$BRANCH"

# Sync from upstream's newest stable release, not from main. Release tags were
# green across every workflow; arbitrary main commits fail CI about a quarter of
# the time, almost entirely in end-to-end and Windows test jobs. Betas and the
# one release candidate carry a hyphen and are skipped.
TIP=$(git -C "$REPO" ls-remote --tags --refs upstream 'refs/tags/v*' |
	awk -F'refs/tags/' '$2 !~ /-/ {print $2}' | sort -V | tail -1)
[ -n "$TIP" ] || {
	echo "no stable upstream release tag found" >&2
	exit 1
}
TARGET=$(git -C "$REPO" ls-remote upstream "refs/tags/$TIP" | awk '{print $1}')

# A tag can be cut from a side branch that never landed; 0.7.0-beta.2 was. Those
# commits are not what upstream shipped on main, so refuse rather than merge one.
git -C "$REPO" merge-base --is-ancestor "$TARGET" upstream/main || {
	echo "$TIP is not reachable from upstream/main" >&2
	exit 1
}

# Upstream commits daily but releases every few days, so most runs stop here.
if git -C "$REPO" merge-base --is-ancestor "$TARGET" "$BRANCH"; then
	echo "already current with upstream $TIP"
	exit 0
fi

# A worktree keeps the rebrand branch off the main checkout, so a half-finished
# sync never leaves the working tree in a strange state.
WT=$(mktemp -d)
trap 'git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true' EXIT
git -C "$REPO" worktree add --quiet "$WT" "$BRANCH"

# Record that upstream has been absorbed, then throw away everything that merge
# decided about file contents and take upstream's tree outright. The `ours`
# strategy never looks at the other side, so it cannot conflict.
git -C "$WT" merge -s ours --no-commit "$TARGET" >/dev/null
git -C "$WT" read-tree -u --reset "$TARGET"

(cd "$WT" && bash "$HERE/rebrand.sh")
"$REPO/node_modules/.bin/oxfmt" "$WT" >/dev/null

git -C "$WT" add -A
# Most days upstream has not moved and there is nothing new to rebrand.
if git -C "$WT" rev-parse -q --verify MERGE_HEAD >/dev/null; then
	LEFTHOOK=0 git -C "$WT" commit -q -m "rebrand upstream through $TIP"
fi

if ! git -C "$REPO" merge "$BRANCH" --no-commit --no-ff; then
	# A merge can fail for reasons other than conflicts. Those leave the repo
	# mid-merge with nothing to resolve, so undo them rather than hand the
	# caller a half-finished state it cannot interpret. Conflicts are left in
	# place: they are the one failure a human can act on.
	if [ -z "$(git -C "$REPO" ls-files --unmerged)" ]; then
		git -C "$REPO" merge --abort || true
		echo "merge failed without conflicts; nothing was changed" >&2
		exit 1
	fi
fi

CONFLICTS=$(git -C "$REPO" diff --name-only --diff-filter=U)
if [ -n "$CONFLICTS" ]; then
	echo "conflicted files:"
	echo "$CONFLICTS"
	exit 1
fi
echo "merged upstream through $TIP with no conflicts"
