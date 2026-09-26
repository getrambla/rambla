# feat: user-adjustable composer height

Status: unapproved

**Revision 7 — full restart on `fixes-2026-09-26`. Supersedes revision 6;
none of the prior material is trusted until re-verified against this
branch.**

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (v0.9.1) — 2026-09-21

## Scope

**In scope:**

1. The gesture controls the composer's **top edge position** (absolute
   window Y). The handle tracks the finger 1:1, pixel-exact, every frame —
   no snapping, no lag, no drift.
2. Height is **derived, never accumulated**: every frame,
   `height = bottomAnchorY − topY`, where `bottomAnchorY` is the composer's
   bottom edge in window coordinates (fixed during a drag) and `topY` is the
   finger-derived top edge. No drag-start baseline, no `translationY`
   accumulation.
3. The derived height renders as an explicit `height` on the **container
   View** (a fork-owned wrapper around the text input), never as a style on
   the text input; the text input fills the container.
4. One coordinate space: window coordinates only. Finger values come from
   RNGH `absoluteY`; anchors from `measureInWindow`. No `event.x/y`, no
   `translationY`, no `onLayout`-derived y-values in the height path.
5. Bounds live entirely in `topY` clamping: `topY ∈ [windowTop,
bottomAnchorY − MIN_HEIGHT]` (min 2 lines ~60px, max window top).
6. Release persists `topY` (the last rendered frame's value, not a
   re-measurement). Mount restores: measure anchor, restore `topY`, derive.
   Double-tap: `topY = bottomAnchorY − DEFAULT_HEIGHT` (3 lines, ~90px).
7. The box never sizes to content, for anyone; text scrolls inside.
8. Haptics: grab, release, double-tap only. Single tap does nothing.
9. Works on mobile AND web/desktop: the store, topY derivation, and
   container-height mechanism are platform-agnostic; the drag handle must
   be draggable on all three. On web/desktop the same gesture code runs on
   pointer events (RNGH web backend) and the text input is the DOM
   textarea path; desktop wraps the same web app.
10. Diagnostic step (before any fix): instrumented TestFlight build logging,
    during one drag, store value → style → container `onLayout` →
    `onHeightChange`, alongside the gesture's `absoluteY`. The layer the log
    indicts is the only layer the fix touches. Web/desktop get the same
    logging during one drag before their fix is called done.

**Not in scope:**

- Any height quantization (forbidden — see Constraints).
- Per-workspace height, settings entry.
- Android-specific tuning (same code ships; Android gets the same code
  untested, like today).

## Goal

The composer's top edge follows the finger 1:1; its height is derived from
the finger position against a fixed bottom anchor. The box never sizes to
content.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is
merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                   | Edit                                                                                                                                                                                                                                                                                                                                                                                                                           | Upstream activity          | Tag                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------- |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`      | store: persisted `topY` (null = default) + transient live `topY`; anchor Y and window-top as arguments; clamp lives in topY, not height                                                                                                                                                                                                                                                                                        | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts` | rewrite from the height-based API to the topY API: derivation, clamp at window top and min height, persistence excludes live topY, restore-default, garbage-tolerant load                                                                                                                                                                                                                                                      | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`      | pan: report `absoluteY` per frame (no baseline, no translationY); grab/release/double-tap haptics; pressed state; ≥8px = drag, else tap logic                                                                                                                                                                                                                                                                                  | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-frame.rambla.ts`        | new module: per-frame derivation `height = anchorY − topY`, clamp, and anchor measurement contract (`measureInWindow`)                                                                                                                                                                                                                                                                                                         | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/input.rambla.tsx`                     | fork-owned container View around the text input carrying explicit `height` (derived per frame); text input fills it; remove the stock min/max style (`composerHeightStyle`) from the input's style array and the `useComposerHeight` call that produces it, folding its `scrollEnabled` into a constant true (native mode always returns true); anchor re-measure on keyboard show/hide; handle row as container's first child | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/diagnostics.rambla.ts`                | temporary instrumented logging (step 1); removed in step 6                                                                                                                                                                                                                                                                                                                                                                     | new                        | `RAMBLA-FORK: fix:`  |
| `packages/app/e2e/browser/composer-drag-handle.rambla.browser.test.ts` | Playwright E2E test: launches the real web app (Metro/expo web build), drives real mouse drags on the composer handle, asserts the container's top edge tracks the pointer per frame (≤1px, no jumps) and release + relaunch persist                                                                                                                                                                                           | new                        | `RAMBLA-FORK: feat:` |

**Why this shape:** R5 proved a style on the text input does not control the
observed size; a plain container View with explicit `height` obeys the layout
value exactly (the resize-handle.tsx pattern: gesture → state → plain View
style). The controlled quantity is the top edge, not height — accumulated
deltas made every wrong baseline a jump (R2–R5).

**Branch:** none — 0 upstream files edited, work on `fixes-2026-09-24`.

## Cause

R4b/R5 device behavior: box moves in whole-line jumps; explicit height on
the text input changed nothing. The dragged value was applied to the wrong
node (text input, not container) and the controlled quantity was wrong
(accumulated height instead of absolute top-edge Y) — a wrong drag-start
baseline turns the first pixels of drag into a large jump.

## Constraints

- No file outside the table changes — including height.native.ts,
  height.types.ts, height.web.ts, upstream input.tsx.
- No quantization anywhere: no rounding, snapping, stepping, or line-grid
  alignment in store, gesture, render, or native. (Detaches handle from
  finger — the R4b defect.)
- One coordinate space: window coordinates only. Gesture values from
  `absoluteY` only; anchors from `measureInWindow` only. `event.x/y`,
  `translationY`, and `onLayout`-reported y-values are forbidden in the
  height path. (Mixing spaces is a jump.)
- No drag-start baseline: the derivation reads the finger's absolute Y each
  frame plus a constant grab offset captured once at activation
  (`grabOffset = restingTopY − absoluteY_at_activation`), so the box moves
  with the finger without snapping the top edge to the grab point. The
  offset is a per-drag constant; nothing accumulates across frames or drags.
  (Without it, the 6px activation threshold makes the first frame jump.)
- The derived height renders as explicit `height` on the fork-owned
  container View; the text input carries no explicit height and no min/max
  from this feature.
- Store persists `topY`, never height. Release persists the last rendered
  frame's `topY`; no re-measurement at release. (Re-measuring can disagree
  with the rendered frame — R3's junk pin.)
- Anchor re-measured on `keyboardWillChangeFrame` / `keyboardDidChangeFrame`
  / `keyboardDidHide` (the documented trigger points); during a drag the
  anchor is fixed.
- On mount, restored `topY` is re-clamped against the freshly measured
  anchor before rendering (window geometry may have changed since the pin;
  what persists is the user's perceived size, via the re-derivation).
- `.runOnJS(true)` FIRST in the pan chain (R4 crash).
- Haptics: grab, release, double-tap only; none during movement.
- Tap <8px mutates nothing; two taps <300ms restore default.
- Stored `topY` that fails schema loads as null.
- The browser test drives trusted pointer events (Playwright mouse API —
  real input, not JS-constructed PointerEvents); it must not call store
  setters directly, or it tests nothing about the gesture path.
- Simplicity: helper machinery beyond the table's shapes → stop and report.

## Steps

0. Read the `code` skill first. If a step is wrong, stop and report.

   **Starting state:** the branch contains the r4+r5 implementation
   (HEAD = `05feda809`) — device-verified BROKEN (whole-line jumps, r5's
   style change did nothing observable). The drag handle, store, and
   wiring exist but implement the wrong mechanism; steps 3–5 AMEND that
   code in place, they do not write from scratch. The known-good stock
   composer is `5a36aa28b` if a comparison is ever needed. The r4 crash
   fixes (`.runOnJS(true)`, haptics on events only) are KEEP — they
   survived device testing.

1. Diagnostic build: add `diagnostics.rambla.ts`; during one drag log
   gesture `absoluteY`, store value, style height sent, container
   `onLayout` height, `onHeightChange` value. Ship via TestFlight; capture
   one drag's log. Findings decide which layer the fix touches (steps 2–5
   assume the container, per R5's evidence; if the log indicts a different
   layer, stop and report — do not re-decide placement while coding).
2. Add `composer-drag-frame.rambla.ts`: derivation function
   (anchorY, topY → clamped height), clamp constants
   (MIN_HEIGHT = 60, DEFAULT_HEIGHT = 90), anchor measurement contract.
3. Amend `composer-height-store.rambla.ts`: persisted `topY` + transient
   live `topY`; setters clamp topY to [windowTop, anchorY − MIN_HEIGHT];
   restore-default sets `topY = anchorY − DEFAULT_HEIGHT`; anchor and window
   top are arguments (the store owns no measurement).
4. Amend `composer-drag-handle.rambla.tsx`: keep `.runOnJS(true)` FIRST,
   `failOffsetX([-24,24])` / `activeOffsetY([-6,6])` (activation threshold);
   on activation capture a constant grab offset
   (`grabOffset = restingTopY − absoluteY_at_activation`, from the store's
   current topY — a per-drag constant, not an accumulated baseline);
   `onUpdate` reports `absoluteY + grabOffset` to the store; on end:
   ≥8px translation persists live topY + haptic, else tap logic; two taps
   <300ms → restore-default + haptic; pressed row style while active.
   Remove the `dragStartHeight` prop entirely.
5. Edit `input.rambla.tsx`: wrap the text input in a fork-owned container
   View; apply the derived height as explicit `height` on that container
   (style recomposed per frame from the store); remove the stock min/max
   `composerHeightStyle` from the input's style array and the
   `useComposerHeight` call producing it — dispose of ALL its consumers:
   the `onTextChange` calls at :1281/:1349/:1757, the `reset` call at
   :1584, and their dependency-array entries (:1292, :1357, :1762) get
   deleted with the call; `scrollEnabled` folds into a constant true
   (native mode returns true unconditionally; web's dynamic value is
   superseded by this feature's fixed-height design — the box no longer
   grows, so the input must always scroll); `webTextareaRef`/`getLiveText`
   lose their only consumer and go with it; text input fills the
   container with no height or min/max styles of its own; measure the
   anchor with `measureInWindow` and re-measure on keyboard show/hide;
   handle row stays the container's first child. Tag every block.
6. Add `composer-drag-handle.rambla.browser.test.ts`: a Playwright E2E
   test that launches the real web app (Metro/expo web build — not the
   vitest browser harness; vitest/Vite cannot bundle the app's expo
   import chain), drives real mouse drags on the handle with Playwright's
   mouse API, and
   assert per-frame after activation: container top edge == pointer Y +
   grabOffset (≤1px) across small (few-px, including sub-6px drags that
   must NOT activate), large (multi-hundred-px), and fast drags — no jumps,
   including the first post-activation frame; release holds; remount
   restores; double-tap restores default. Tag it. The browser test may be
   marked heavy/skippable but MUST be run before
   declaring the feature done.
7. Remove `diagnostics.rambla.ts` and all logging.
8. Verify per below.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer/input/composer-height-store.rambla.test.ts --bail=1`
- `npx playwright test e2e/browser/composer-drag-handle.rambla.browser.test.ts --bail=1` (from `packages/app/`)
  — must pass: per-frame top-edge == pointer Y + grabOffset (≤1px), no
  jumps, release/relaunch persist, double-tap restores default.
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx packages/app/src/composer/input/composer-height-store.rambla.ts packages/app/src/composer/input/composer-drag-handle.rambla.tsx packages/app/src/composer/input/composer-drag-frame.rambla.ts packages/app/e2e/browser/composer-drag-handle.rambla.browser.test.ts`
- Diagnostic-log check (step 1, before coding the fix): for every logged
  frame, container `onLayout` height == anchorY − (absoluteY + grabOffset)
  (within 1px) — equivalently, it equals anchorY − the store's rendered
  topY. Container reports pixel values matching that predicate → proceed.
  Line-quantized values → stop and report.
- On device (iOS TestFlight), the acceptance test: with an EMPTY box, drag
  the handle any distance at any speed — the box's top edge stays exactly
  under the finger, 1:1, pixel-exact, every frame: no line jumps, no fling
  from a few pixels of movement, no snap after release, no lag. Release —
  the box stays exactly there. Kill and relaunch — same height. Type a long
  draft — text scrolls inside the fixed box. Keyboard show/hide — no jump.
  Single tap — nothing. Double-tap — 3-line default. Fresh install — fixed
  3 lines.
- Same acceptance test on web (browser) and desktop (Electron): drag with
  the mouse — the top edge stays under the cursor 1:1, no jumps, no snap;
  release holds; relaunch holds; long draft scrolls; double-tap restores
  the 3-line default. Web drag logging from step 1 shows pixel-exact
  values, not line-quantized ones.

## Risks

- iOS pixel snapping and PasteInput intrinsic-size behavior are
  doc-silent; the diagnostic gate (step 1) exists to falsify the container
  assumption on device before the fix ships. Web textarea behavior is
  likewise verified by web logging first.
- The pan gesture must not steal scrolls from the chat list; it lives only
  on the handle row.
- Rotation mid-drag is unhandled by design; the anchor is fixed during a
  drag.

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
5. **R5 (explicit height on text input, `05feda809`):** an explicit `height`
   style appended last to the text input's style array changed nothing
   observable on device — the size the user sees is controlled by the
   container/frame chain, not the TextInput's style. Additionally, the whole
   height-driven design was wrong: height is a derived quantity
   (bottom anchor − top edge), not the controlled one; controlling it via
   drag-start baselines and accumulated deltas made every wrong baseline a
   jump. The controlled quantity is the top edge's absolute window Y.

Lessons carried into this revision: position-controlled, height derived;
one coordinate space (window); no quantization anywhere; gesture on JS;
diagnosis by instrumented build before any fix.
