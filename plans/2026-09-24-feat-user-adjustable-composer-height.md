# feat: composer height set by dragging the top handle

**Revision 5 — the handle must track the finger absolutely. Supersedes
revision 4; R4's code is the base, amended per the diagnosis below.**

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
4. **R4 (clean rewrite, `3c7480146` + `4e185ca8a`):** logic was correct but
   shipped two native defects. (a) The pan lacked `.runOnJS(true)`, so its
   callbacks ran as Reanimated worklets on the UI thread; the React setState
   and expo-haptics call inside crashed iOS the instant the handle was
   touched (crash log: Hermes `throwPendingError` under
   `UIGestureRecognizer _componentsBegan`). (b) With the crash fixed, the
   box moved in whole-line jumps: on iOS, a TextInput sized via
   `minHeight`/`maxHeight` snaps its committed frame to content-line
   multiples, so min=max can never give pixel-exact sizing. Root cause for
   both: gesture-callback threading and native text-view sizing behavior are
   platform facts no static review caught — the sizing mechanism must be
   `height` (explicit), not min/max, and gestures must run on JS.

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
   the box height equals the finger's position — **the handle tracks the
   finger absolutely, 1:1, pixel-exact; no relative drift, no snapping, no
   lag**. The dragged value is what renders — every frame.
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

| File                                                                   | Edit                                                                                                                                                                                                                             | Upstream activity          | Tag                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`      | new store: persisted `pinnedHeight` (null = default 3 lines) + non-persisted `liveHeight` (set during drag, cleared on release); clamped to [MIN_PINNED_HEIGHT, window height]; exposes DEFAULT_PINNED_HEIGHT = 3 lines          | new (fresh, post-revert)   | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts` | pin/live/clamp round-trip, default-height passthrough, persistence excludes live, garbage-tolerant load                                                                                                                          | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`      | grabber row: pan drives `liveHeight` = drag-start box height + (−translationY), raw pixels; release pins; haptic on grab and release; pressed state; single tap does nothing; double-tap restores default 3 lines                | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/input.rambla.tsx`                     | render: live → explicit `height = liveHeight`; pinned → explicit `height = pinnedHeight`; null (default) → explicit `height = DEFAULT_PINNED_HEIGHT` (3 lines, fixed — auto-grow removed); handle row as container's first child | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |

**Why this shape:** revision 4's device test proved equal `minHeight`/
`maxHeight` is NOT pixel-exact on iOS — the UITextView snaps its committed
frame to whole text-line multiples, so the box moved a line at a time
(researcher-confirmed; R4 wrong turn 4b). The fix is an explicit `height`
style: a fixed frame on the text view cannot snap, giving exact pixels. Web's
measured mode self-clamps any recompute into the provided bounds, so an
explicit height is equally safe there. The whole feature remains one nullable
number plus one transient number, now rendered as explicit `height`.

**Finger tracking (the binding rule):** the handle must stay under the finger
at all times — 1:1, absolute, no relative drift or snapping. Drag deltas use
RNGH `translationY` (absolute since gesture start), so dropped or batched
events cannot accumulate error; the explicit-height render applies each value
as an exact frame.

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
auto-grow pushes the box to the window top and hides the chat. A fixed height
must be applied as an explicit `height` style: iOS snaps min/max-sized text
views to whole line multiples, so min=max cannot deliver pixel-exact tracking.

## Constraints

- No file outside the table changes — including height.native.ts,
  height.types.ts, height.web.ts, upstream input.tsx.
- The drag value must appear in the render in the same frame it updates: the
  store's live value flows straight into the explicit `height` style with no
  intervening clamps, rounding, or alternate bounds.
- The handle must track the finger absolutely: 1:1, pixel-exact, no snapping,
  no lag, no relative drift. This is the acceptance criterion that overrides
  convenience — if the mechanism cannot deliver it, stop and report.
- Gesture callbacks must include `.runOnJS(true)` (R4 crash: worklet-thread
  execution of setState/haptics aborts iOS on touch-down).
- Quantization is FORBIDDEN everywhere in this feature — no rounding,
  snapping, stepping, or line-grid alignment of the height, in any file, at
  any layer (store, gesture, render, native). Rounding the height detaches
  the handle from the finger, which violates the binding tracking rule
  (Scope item 1). Any code that quantizes is a defect.
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
1. Amend `composer-height-store.rambla.ts`: rename `resolveRenderBounds`'s
   return to a single explicit height — `resolveRenderHeight(windowHeight)`
   returns `number`: live if set, else pinned re-clamped to the current
   windowHeightArg (rotation shrink), else DEFAULT_PINNED_HEIGHT. Setters
   clamp as before. That resolution is the single clamp site.
2. Update `composer-height-store.rambla.test.ts`: same coverage, asserting
   the resolved number (live, rotation-shrunk pin, default).
3. Amend `composer-drag-handle.rambla.tsx`: keep `.runOnJS(true)` FIRST in
   the pan chain (R4 crash), `failOffsetX([-24,24])` / `activeOffsetY([-6,6])`;
   drag start = current measured height via `dragStartHeight` prop
   (fallback `MIN_PINNED_HEIGHT`); on update
   `setLiveHeight(start − translationY)`; on end: translation ≥ 8px →
   `pinLiveHeight()` + haptic, else `clearLiveHeight()`; two taps <300ms →
   `restoreDefault()` + haptic; pressed row style while active.
4. Edit `input.rambla.tsx`: resolve `composerHeight = resolveRenderHeight(
windowHeight)` and pass `minHeight: composerHeight, maxHeight:
composerHeight` into the existing `useComposerHeight` call — with an
   explicit-height mode so the style carries `height: composerHeight` rather
   than min/max (see deviation note below); keep the `dragStartHeight`
   measurement feed and the handle row as container's first child. Tag every
   block.
   DEVIATION NOTE: delivering pixel-exact tracking requires the native style
   to carry an explicit `height` instead of min/max —
   height.native.ts/height.types.ts are upstream and off-limits per the
   table, so input.rambla.tsx composes the final style itself: apply
   `composerHeight` as an explicit `height` on the composer surface style
   where the stock minHeight/maxHeight were consumed, leaving
   `useComposerHeight`'s mode untouched. If that composition cannot express
   `height` cleanly at the existing style site, STOP and report — do not
   widen the table.
5. Verify per below.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer/input/composer-height-store.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx packages/app/src/composer/input/composer-height-store.rambla.ts packages/app/src/composer/input/composer-drag-handle.rambla.tsx`
- On device (iOS TestFlight): with an EMPTY box, drag the handle — the box
  edge stays exactly under the finger: 1:1, pixel-exact, no line-sized jumps,
  no snap after release, no catch-up lag (R4's whole-line jumping is the
  failure this test must exclude). Any height between the 2-line floor and
  the window top is reachable and holds. Release — the box stays exactly
  there. Type a long draft — text scrolls inside the fixed
  box; the box never grows on its own. Single tap —
  nothing changes. Double-tap — box returns to the 3-line default.
  Fresh install — fixed 3 lines, no auto-grow. Rotation — a too-tall pin
  shrinks to fit.

## Risks

- Web measured mode recomputes on every keystroke but self-clamps into
  min=max; if web still fights the pin, stop and report rather than patching
  height.web.ts.
- Fixed-height mode must re-clamp on rotation (window top moves).
- The pan gesture must not steal scrolls from the chat list; it lives only on
  the 16px handle row.
