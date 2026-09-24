# feat: composer height set by dragging the top handle

**Revision 4 — full rewrite from stock (revert commit `5a36aa28b`). Supersedes
revisions 1–3 entirely; no code from them survives.**

## Wrong turns

1. **R1 (grow-only ceiling, `46d8b9515`):** store held a growth ceiling floored
   at 160px while the native box is content-sized, so raising the ceiling was
   invisible on short drafts and lowering was impossible. Device: exactly 2
   visible sizes, drags did nothing. Root cause: a ceiling is not a height;
   unobservable state.
2. **R2 (explicit height, `0ba83473b`):** pinned min=max was correct
   rendering-wise, but drag deltas quantized against the pinned height itself,
   so once the pin hit its floor every upward delta clamped straight back —
   the box could never grow. Haptic tick fired every gesture update (no
   last-tick-line ref), felt as constant buzz. Device: stuck at minimum,
   constant buzz.
3. **R3 (live dragHeight, `30f159644`):** the drag branch of the renderer
   discarded `dragHeight` and returned `minHeight: 1 line, maxHeight: window`
   (researcher-confirmed at `resolveComposerHeightArgs`, recovered from
   `30f159644`), so the intrinsic content-driven mode won and the finger moved
   nothing; a tap still ran the full grab→pin/toggle cycle; three different
   viewport bounds coexisted across store, handle, and renderer; quantization
   added 6 coupled moving parts whose base disagreed with the rendered value.
   Device: touch collapsed the box, drag enlarged nothing, release pinned a
   junk value.

Lessons applied in this revision: the rendered value must BE the dragged
value; quantization is dropped (raw pixels); one bound definition; tap does
nothing; the state is one nullable height + one non-persisted live height,
nothing more.

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (v0.9.1) — 2026-09-21

## Scope

**In scope:**

1. Dragging the handle sets the composer's height in real time: while held,
   the box is exactly as tall as the finger position (raw pixels, no
   quantization), with text scrolling inside. The dragged value is what
   renders — every frame.
2. On release, that height is pinned and persists per device. While pinned,
   the box does NOT size to content — typing grows the text, which scrolls
   inside the fixed box.
3. Bounds: minimum 2 text lines, maximum the window top. One definition of
   that bound, used by store, handle, and renderer alike.
4. Default behavior for EVERYONE: a fixed 3-line height — no content auto-grow
   anywhere in this feature. The box never sizes to content; text scrolls
   inside. Double-tap returns to this default.
5. Feedback: one haptic tick on grab, one on release; the handle row shows a
   pressed state while held.
6. Double-tap on the handle restores the default 3-line height, with a
   haptic tick. Single tap still does nothing.
7. Works while composing and while live dictation is running, mobile and web.

**Not in scope:**

- Double-tap _toggle_ between default/other cycles (out of scope — only
  restore-default-on-double-tap is in scope, Scope item 6).
- Quantization to text lines (dropped — see Wrong turns 3).
- Per-workspace height, settings entry, keyboard-inset behavior.
- Android-specific tuning (same code ships; only iOS is device-tested now).

## Goal

The user defines the composer's size by dragging; the box stays exactly where
put, at any text length.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is
merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                   | Edit                                                                                                                                                                                                                                               | Upstream activity          | Tag                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`      | new store: persisted `pinnedHeight` (null = default 3 lines) + non-persisted `liveHeight` (set during drag, cleared on release); clamped to [MIN_PINNED_HEIGHT, window height]; exposes DEFAULT_PINNED_HEIGHT = 3 lines                            | new (fresh, post-revert)   | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts` | pin/live/clamp round-trip, default-height passthrough, persistence excludes live, garbage-tolerant load                                                                                                                                            | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`      | grabber row: pan drives `liveHeight` = drag-start box height + (−translationY), raw pixels; release pins; haptic on grab and release; pressed state; single tap does nothing; double-tap restores default 3 lines                                  | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/input.rambla.tsx`                     | render: live → `minHeight = maxHeight = liveHeight`; pinned → `minHeight = maxHeight = pinnedHeight`; null (default) → `minHeight = maxHeight = DEFAULT_PINNED_HEIGHT` (3 lines, fixed — auto-grow removed); handle row as container's first child | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |

**Why this shape:** the researcher confirmed equal `minHeight`/`maxHeight`
fully pins the box on BOTH platforms with zero new machinery — native's
intrinsic style cannot render any other size, and web's measured mode
self-clamps every recompute into the equal bounds. So the whole feature is one
nullable number plus one transient number, rendered as min=max; no new height
mode, no line-height plumbing, no quantizer. The dragged value is rendered
directly, which is the exact defect that killed R3.

**The bound:** the window top is `useWindowDimensions().height`, read once in
`input.rambla.tsx` (which already subscribes to window dimensions) and passed
into the store as an argument — the store owns no window query. The single
clamp site is where the store computes what to render: the render resolution
re-clamps `pinnedHeight` against the current window bound (so rotation shrinks
a too-tall pin), while `liveHeight` is transient and rendered as-is (rotation
mid-drag is irrelevant). One definition, one clamp site, in the file that
knows the window.

**The minimum:** one named constant in the store, `MIN_PINNED_HEIGHT = 60`
(justification: roughly 2 rendered text lines at the composer's stock 16px
font/1.4 line-height ≈ 45px, plus vertical padding ≈ 15px — a deliberate,
stated pixel constant, not a per-platform derivation).

**Branch:** none — 0 upstream files edited, work on `fixes-2026-09-24`.

## Cause

The composer sizes itself to content (native intrinsic mode). The user needs a
user-defined fixed height — content-independent — for accessibility; content
auto-grow pushes the box to the window top and hides the chat. Fixed height is
achievable through the existing props by rendering min=max=H (researcher
verified on both height.native.ts and height.web.ts), which no prior revision
did while dragging.

## Constraints

- No file outside the table changes — including height.native.ts,
  height.types.ts, height.web.ts, upstream input.tsx.
- The drag value must appear in the render in the same frame it updates: the
  store's live value flows straight into minHeight/maxHeight with no
  intervening clamps, rounding, or alternate bounds.
- No line-height derivation, no quantization, no lineHeight prop.
- Haptics: exactly 2 per drag (grab, release) via the
  `use-long-press-drag-interaction.ts` pattern (selectionAsync, `.catch`-
  guarded). No ticks during movement. Double-tap adds one haptic outside a
  drag.
- Content auto-grow is REMOVED for everyone: no render state sizes to content.
  Null pin = fixed default (DEFAULT_PINNED_HEIGHT, 3 lines).
- Tap (translation under ~8px) as a SINGLE tap mutates nothing; two taps
  within ~300ms are the restore-default gesture (Scope item 4).
- Persistence: validated storage; any stored value that fails the schema
  loads as null and never crashes.
- Simplicity is a requirement: if a step needs helper machinery beyond the
  table's shapes, stop and report.

## Steps

0. Read the `code` skill first. If a step is wrong, stop and report.
1. Create `composer-height-store.rambla.ts`: constants `MIN_PINNED_HEIGHT`
   (60) and `DEFAULT_PINNED_HEIGHT` (3 lines ≈ 90px); `pinnedHeight:
number | null` (persisted, zod-validated, garbage → null = default),
   `liveHeight: number | null` (not persisted), `setLiveHeight(h)`,
   `pinLiveHeight()`, `restoreDefault()` (clears pin); setters clamp to
   `[MIN_PINNED_HEIGHT, windowHeightArg]` using the window height passed in
   from the caller (the store owns no window query); the store also exposes
   `resolveRenderBounds(windowHeight)` which returns `{ minHeight, maxHeight }`
   for the three states — live (min=max=live), pinned (min=max=pinned,
   re-clamped to the current windowHeightArg so rotation shrinks a stale
   pin), or null (min=max=DEFAULT_PINNED_HEIGHT). That resolution is the
   single clamp site.
2. Create `composer-height-store.rambla.test.ts`: clamps, pin round-trip,
   rotation re-clamp of a stale pin, live-not-persisted, garbage-tolerant
   load, null = default 3 lines, and the double-tap path:
   `restoreDefault()` returns to null/default, and is a no-op when already
   default.
3. Create `composer-drag-handle.rambla.tsx`: RNGH pan, `failOffsetX([-24,24])`
   / `activeOffsetY([-6,6])`; on activation haptic + record drag start =
   the composer's current rendered height, passed in as a prop
   (`dragStartHeight`) from input.rambla.tsx, with a fallback of
   `MIN_PINNED_HEIGHT` when no measurement exists yet; on update
   `setLiveHeight(start − translationY)`; on end: if translation ≥ 8px
   `pinLiveHeight()` + haptic, else `clearLiveHeight()` (single tap mutates
   nothing); two taps within ~300ms → `restoreDefault()` + haptic; pressed
   row style while active.
4. Edit `input.rambla.tsx`: feed the store's `resolveRenderBounds(windowHeight)`
   into the existing `useComposerHeight` call (replacing the stock
   auto-grow arguments — the composer height is now always user-or-default
   fixed); pass the current
   measured composer height (already surfaced by the existing
   `onHeightChange`/`handleComposerLayout` path at
   [input.rambla.tsx:1250](../packages/app/src/composer/input/input.rambla.tsx#L1250)) down to the handle as `dragStartHeight`;
   mount the handle row as the container's first child
   ([input.rambla.tsx:1842](../packages/app/src/composer/input/input.rambla.tsx#L1842), before MessageInputAutoFocus). Tag every block.
5. Verify per below.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer/input/composer-height-store.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx packages/app/src/composer/input/composer-height-store.rambla.ts packages/app/src/composer/input/composer-drag-handle.rambla.tsx`
- On device (iOS TestFlight): with an EMPTY box, drag the handle — the box
  follows the finger to any height up to the window top (this exact case
  failed in every prior revision; it is the acceptance test). Release — the
  box stays exactly there. Type a long draft — text scrolls inside the fixed
  box; the box never grows on its own. Drag down to 2 lines — holds. Single
  tap — nothing changes. Double-tap — box returns to the 3-line default.
  Fresh install — fixed 3 lines, no auto-grow. Rotation — a too-tall pin
  shrinks to fit.

## Risks

- Web measured mode recomputes on every keystroke but self-clamps into
  min=max; if web still fights the pin, stop and report rather than patching
  height.web.ts.
- Fixed-height mode must re-clamp on rotation (window top moves).
- The pan gesture must not steal scrolls from the chat list; it lives only on
  the 16px handle row.
