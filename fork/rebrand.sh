#!/usr/bin/env bash
# Rename Paseo to Rambla across a checkout: three case-sensitive passes, nothing else.
# Run from inside the target git repo. Run `npm run format` afterwards.
#
# Only tracked files are touched, so .git, node_modules and dist are out of scope.
# Binary files are skipped; they carry branding as images, not text, and are
# replaced from the fork's own assets rather than edited.

set -euo pipefail

# *.paseo.test.ts keeps its upstream name, and so does every mention of it.
sub() {
	sed -e 's/\.paseo\.test\./@@SKIP-REBRAND@@/g' \
		-e 's/PASEO/RAMBLA/g' \
		-e 's/Paseo/Rambla/g' \
		-e 's/paseo/rambla/g' \
		-e 's/@@SKIP-REBRAND@@/.paseo.test./g'
}

# Give them the prefix here, not on main. Git records no rename: it re-derives one at
# merge time by pairing a deleted path against an added one, so renaming on main holds
# only while nothing occupies the old path. The day main writes its own CHANGELOG.md
# there is nothing left to pair and upstream's edits merge into the fork's file.
for old in CHANGELOG.md README*.md; do
	[ -e "$old" ] || continue
	git mv "$old" "PASEO-$old"
done

# Root-level files the fork keeps as upstream wrote them, under a PASEO-
# prefix. Byte-identical on both sides of a merge means they never conflict.
SKIP='^(PASEO-|fork/|\.github/workflows/merge-upstream\.yml)|\.paseo\.test\.ts$'

# Paths first, deepest first so a renamed parent never invalidates a queued child.
git ls-files -z | grep -zi paseo | grep -zEv "$SKIP" | sort -zr | while IFS= read -r -d '' old; do
	new=$(printf '%s' "$old" | sub)
	[ "$old" = "$new" ] && continue
	mkdir -p "$(dirname "$new")"
	git mv "$old" "$new"
done

# Then contents, only in tracked text files that actually contain the string.
git grep -lIi paseo -- . | grep -Ev "$SKIP" | while IFS= read -r f; do
	sub <"$f" >"$f.rebrand.tmp"
	mv "$f.rebrand.tmp" "$f"
done

echo "remaining case-insensitive paseo hits: $(git grep -lIi paseo -- . | grep -Ev "$SKIP" | wc -l)"
