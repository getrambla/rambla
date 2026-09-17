# Brand assets

Every icon, favicon, and logo in this repo is drawn from one file:
`fork/brand/rambla-logo.svg`. Nothing is hand-exported.

## Redrawing everything

```bash
just logos path/to/new-design.svg   # adopt a new design and redraw
just logos                          # redraw from the stored source
```

The recipe overwrites 29 files across `packages/app`, `packages/desktop`,
`packages/website`, and `fastlane/`, then formats the one TypeScript file it
generates. Needs `rsvg-convert` (librsvg) and `magick` (ImageMagick 7).

Adopting a new design copies it over `fork/brand/rambla-logo.svg`, so the source
of truth moves with it. Commit both.

## What the source SVG has to provide

- A `viewBox`.
- A dominant hex colour that is neither `#000000` nor `#ffffff`. That colour is
  the brand colour. It keys the icon gradient, and in the app component every
  fill and stroke painted in it becomes the theme-resolved tint, so the mark
  still follows the theme and still honours a `color` prop.

Nothing else is required. The mark does not need to be centred or trimmed — the
generator rasterises it, measures the ink, and places it itself.

## What is derived, not configured

- **The gradient.** Two stops either side of the brand colour in HSL, shallow
  enough that the tile reads as one colour at 16px.
- **Placement.** The mark's longest side fills a fixed fraction of the canvas,
  centred on its ink rather than its viewBox.
- **The macOS `.icns`.** ImageMagick on Linux has no ICNS delegate, so the
  generator writes the container itself: PNG frames in typed chunks.

Two constants in `fork/brand/artwork.mjs` set the tile's corner radius and how
much of it the mark fills. They are the only dials.

## Why it survives an upstream sync

Every path the generator writes to is a path upstream owns, so a sync would
otherwise drag Paseo's artwork back in — and a conflict on a binary icon is one
nobody can read a diff of.

`fork/merge-upstream.sh` runs the generator against the `upstream-rebrand`
worktree before that branch is committed, the same way it forces the fork's
`nix/npm-deps.hash` onto that side. Both sides of the merge then hold identical
bytes and git has nothing to resolve. Upstream can redraw its logo as often as
it likes; the merge never notices.

`fork/brand/` itself is a path upstream has never had, and `fork/rebrand.sh`
skips it, so the source design and the generator are outside the collision
surface entirely.

## Not generated

`packages/website/public/og-image.png` is a screenshot composite with a Paseo
wordmark baked in. It needs redoing by hand.
