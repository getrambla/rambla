#!/usr/bin/env bash
# Advance the standing upstream-rebrand branch to the tip of upstream's main
# and rebrand it. Safe to run anywhere at any time — daily by hand, from CI, or
# before a trial merge. Main is never touched.
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
# Deleted upstream files come along: the whole tree is replaced, not merged.
# The merge into main lives in fork/merge-upstream.sh.
#
# The branch has two writers, this machine and the CI bot, and every advance is
# a new commit even for the same upstream tip. So each writer reconciles with
# origin before advancing and pushes straight after. Skipping either half is
# what silently forked the branch in September 2026 and put an unrebranded
# upstream commit back in the merge base.
#
# Usage: fork/sync-upstream-rebrand.sh [<upstream-ref>]   (default upstream/main)

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

# Publish whenever local is ahead, including on the days there was nothing to
# advance. A push left undone is the divergence, one run later.
publish() {
	git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH" &&
		[ "$(git -C "$REPO" rev-parse "$BRANCH")" = "$(git -C "$REPO" rev-parse "origin/$BRANCH")" ] &&
		return 0
	git -C "$REPO" push --quiet origin "$BRANCH" && return 0
	# The push raced another writer, or there is no network. Either way the
	# local commit stays and the next run reconciles it — say so and stop
	# short of pretending the branch is published.
	echo "warning: $BRANCH advanced locally but was not pushed to origin" >&2
	echo "warning: the next sync will reconcile it; push it sooner if you can" >&2
	return 0
}

# Reconcile with origin before touching anything. Behind fast-forwards.
# Diverged records origin's history without taking its files — the advance
# below overwrites the tree with upstream's anyway, so no content is at stake
# and nothing main may already have merged loses its place in the ancestry.
RELINK=""
if ! git -C "$REPO" show-ref --verify --quiet "refs/heads/$BRANCH"; then
	git -C "$REPO" branch "$BRANCH" "origin/$BRANCH"
elif git -C "$REPO" show-ref --verify --quiet "refs/remotes/origin/$BRANCH" &&
	! git -C "$REPO" merge-base --is-ancestor "origin/$BRANCH" "$BRANCH"; then
	if git -C "$REPO" merge-base --is-ancestor "$BRANCH" "origin/$BRANCH"; then
		git -C "$REPO" branch -f "$BRANCH" "origin/$BRANCH"
	else
		RELINK="origin/$BRANCH"
		echo "reconciling $BRANCH with origin/$BRANCH"
	fi
fi

TARGET=$(git -C "$REPO" rev-parse "${1:-upstream/main}")
TIP=$(git -C "$REPO" rev-parse --short "$TARGET")

# Upstream commits daily but releases every few days, so most runs stop here.
# A pending relink still has to be recorded, so it overrides the shortcut.
if [ -z "$RELINK" ] && git -C "$REPO" merge-base --is-ancestor "$TARGET" "$BRANCH"; then
	echo "already current with upstream $TIP"
	publish
	exit 0
fi

# One stop on the way to the target: absorb an upstream commit, replace the
# tree with its files, rebrand, commit. $2 names the stop in the message, $3 is
# an extra head to record alongside it (the relink, on the first stop only).
advance() {
	local stop=$1 label=$2 extra=${3:-}

	# A worktree keeps the rebrand branch off the main checkout, so a
	# half-finished sync never leaves the working tree in a strange state.
	local WT
	WT=$(mktemp -d)
	trap 'git -C "$REPO" worktree remove --force "$WT" 2>/dev/null || true' EXIT
	git -C "$REPO" worktree add --quiet "$WT" "$BRANCH"

	# Record that upstream has been absorbed, then throw away everything that merge
	# decided about file contents and take upstream's tree outright. The `ours`
	# strategy never looks at the other side, so it cannot conflict.
	git -C "$WT" merge -s ours --no-commit "$stop" ${extra:+"$extra"} >/dev/null
	git -C "$WT" read-tree -u --reset "$stop"
	# Upstream's tree carries upstream's npm dependency hash, main carries the
	# fork's, and both differ from the base every sync, so the merge conflicts on
	# that one line every single time. Put main's value on this side so the two
	# agree and git has nothing to resolve. The value is right either way: the Nix
	# Update Hash workflow recomputes it on push.
	git -C "$REPO" show HEAD:nix/npm-deps.hash >"$WT/nix/npm-deps.hash"

	(cd "$WT" && bash "$HERE/rebrand.sh")
	# Same trick as the dependency hash above, for artwork. Upstream owns the paths
	# every icon lives at, so redraw ours onto this side of the merge. Both sides
	# then hold identical bytes and git has nothing to resolve — no conflict on a
	# binary file nobody can diff, and no chance of Paseo's mark shipping.
	node "$HERE/brand/generate.mjs" --out "$WT"
	"$REPO/node_modules/.bin/oxfmt" "$WT" >/dev/null

	git -C "$WT" add -A
	# Most days upstream has not moved and there is nothing new to rebrand.
	if git -C "$WT" rev-parse -q --verify MERGE_HEAD >/dev/null; then
		LEFTHOOK=0 git -C "$WT" commit -q -m "rebrand upstream through $label"
	fi

	# Release the branch before publishing it: publishing moves the ref, and git
	# refuses to move a ref another worktree has checked out.
	git -C "$REPO" worktree remove --force "$WT"
	trap - EXIT
	echo "upstream-rebrand advanced to $label"
}

# Pause at every stable release between here and the target. Without a stop the
# tag is swallowed mid-jump and no rebrand commit ever holds exactly that
# release, which is the one thing a release merge needs. Betas and the single
# release candidate carry a hyphen and are skipped. Tags are read over the wire
# rather than fetched: upstream's tag namespace would collide with the fork's
# and tag pushes trigger the release workflows.
while read -r name sha; do
	git -C "$REPO" rev-parse -q --verify "$sha^{commit}" >/dev/null || continue
	git -C "$REPO" merge-base --is-ancestor "$sha" "$TARGET" || continue
	git -C "$REPO" merge-base --is-ancestor "$sha" "$BRANCH" && continue
	advance "$sha" "$name" "$RELINK"
	RELINK=""
done < <(git -C "$REPO" ls-remote --tags --refs upstream 'refs/tags/v*' |
	awk -F'refs/tags/' '$2 !~ /-/ {print $2, $1}' | sort -V)

# Then on to the target itself, unless a tag stop already reached it.
if [ -n "$RELINK" ] || ! git -C "$REPO" merge-base --is-ancestor "$TARGET" "$BRANCH"; then
	advance "$TARGET" "$TIP" "$RELINK"
fi

publish
