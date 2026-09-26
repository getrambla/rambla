#!/usr/bin/env bash
# Merge the rebranded upstream into main. This is the unsafe half of the
# upstream sync — it stages a merge into the checked-out branch and leaves it
# uncommitted, so the caller decides whether the result builds before
# committing. fork/sync-upstream-rebrand.sh is the safe half: advancing and
# rebranding the upstream-rebrand branch, safe to run anytime.
#
# Two modes, exactly one required:
#
#   --release  merge upstream's newest release tag, beta or stable. First advances
#       upstream-rebrand to that tag (same mechanics as the sync script).
#       Release tags were green across every workflow; arbitrary main commits
#       fail CI about a quarter of the time, which is why automation merges
#       releases, not main. Bails out quietly (exit 0) when no new release
#       exists.
#
#   --main     merge upstream's current main as it stands right now, for
#       expediting upstream between releases. Checks that upstream-rebrand is
#       current first and runs the sync if it is not.
#
# Both modes exit 1 listing the conflicted files if the merge conflicts.
#
# Usage: fork/merge-upstream.sh --release | --main

set -euo pipefail

UPSTREAM_URL="https://github.com/getpaseo/paseo.git"
BRANCH="upstream-rebrand"

case "${1:-}" in
	--release) MODE=release ;;
	--main) MODE=main ;;
	*)
		echo "usage: fork/merge-upstream.sh --release | --main" >&2
		exit 1
		;;
esac

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

if [ "$MODE" = release ]; then
	# Sync from upstream's newest release tag, not from main. Release tags were
	# green across every workflow; arbitrary main commits fail CI about a quarter of
	# the time, almost entirely in end-to-end and Windows test jobs. Betas count as
	# releases here: upstream goes weeks between stable tags, and waiting that long
	# makes every merge bigger than the one before it. The tilde swap is there
	# because `sort -V` alone orders v0.9.0 ahead of v0.9.0-beta.2; `~` sorts below
	# everything, which restores semver order. Tags cut from side branches that
	# never landed are caught by the ancestry check below.
	TIP=$(git -C "$REPO" ls-remote --tags --refs upstream 'refs/tags/*' |
		awk -F'refs/tags/' '{print $2}' | grep -E '^v?[0-9]+([.][0-9]+)+([-][0-9A-Za-z.]+)?$' | sed 's/-/~/' | sort -V | tail -1 | sed 's/~/-/')
	[ -n "$TIP" ] || {
		echo "no upstream release tag found" >&2
		exit 1
	}
	TARGET=$(git -C "$REPO" ls-remote upstream "refs/tags/$TIP^{}" | awk '{print $1}')

	# A tag can be cut from a side branch that never landed; 0.7.0-beta.2 was. Those
	# commits are not what upstream shipped on main, so refuse rather than merge one.
	git -C "$REPO" merge-base --is-ancestor "$TARGET" upstream/main || {
		echo "$TIP is not reachable from upstream/main" >&2
		exit 1
	}

	# Upstream commits daily but releases every few days, so most runs stop here.
	# The signal is main, not the branch: the daily sync keeps the branch ahead
	# of releases on purpose, so the branch always contains them. Main contains
	# the release commit only if the release was actually merged.
	if git -C "$REPO" merge-base --is-ancestor "$TARGET" main; then
		echo "already current with upstream $TIP"
		exit 0
	fi

	# One implementation of the advance, in the sync script. The daily sync
	# usually has the branch sitting at or past the tag already, in which case
	# this is a no-op.
	bash "$HERE/sync-upstream-rebrand.sh" "$TARGET"

	# Merge the release, not the branch tip. The daily sync keeps the tip at
	# upstream's main, so merging it would ship whatever main held today and
	# throw away the reason for waiting on a tag. The release is carried by the
	# oldest rebrand commit that contains the tag — upstream's own commits are
	# on the branch too, via the `ours` merges, but their trees are unrebranded,
	# so `--not upstream/main` drops them and leaves only this fork's.
	MERGE_REF=$(git -C "$REPO" rev-list --first-parent "$BRANCH" --not upstream/main |
		while read -r c; do
			git -C "$REPO" merge-base --is-ancestor "$TARGET" "$c" && echo "$c"
		done | tail -1)
	[ -n "$MERGE_REF" ] || {
		echo "no rebrand commit on $BRANCH contains $TIP" >&2
		exit 1
	}
else
	# The merge is only as good as the rebrand branch is current; bring it up to
	# upstream's main first. The sync is a no-op when the branch is current.
	bash "$HERE/sync-upstream-rebrand.sh"

	TARGET=$(git -C "$REPO" rev-parse upstream/main)
	TIP=$(git -C "$REPO" rev-parse --short "$TARGET")

	# The question is whether main has the commit, not whether the branch has
	# it. The sync above just put it on the branch, so testing the branch would
	# always say yes and the merge below would never run.
	if git -C "$REPO" merge-base --is-ancestor "$TARGET" main; then
		echo "already current with upstream $TIP; nothing to merge"
		exit 0
	fi
	# Expediting main is the whole point of this mode, so take the tip.
	MERGE_REF="$BRANCH"
fi

if ! git -C "$REPO" merge "$MERGE_REF" --no-commit --no-ff; then
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
