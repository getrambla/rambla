# feat: user-adjustable composer height

Status: approved

**Revision 7**

## Provenance

- main: `2572b98ea` — 2026-09-26
- upstream-rebrand: `7b8f99096` — 2026-09-25
- upstream/main: `8cd989529` (untagged) — 2026-09-25

## Scope

**In scope:**

1. A drag handle on the composer's top edge. Dragging it sets the height of
   the composer's wrapper container, clamped between a computed minimum and
   maximum. Touch on phone, mouse on web/desktop (desktop is the web app
   wrapped).
2. The handle tracks the pointer 1:1, pixel-exact, every frame, both
   directions, everywhere between the bounds (criteria 1, 5–8).
3. Auto-grow is deleted: the stock content-growth wiring is removed from the
   fork composer. The box changes height only by dragging or double-tap;
   long text scrolls inside (criterion 12).
4. Minimum height = one full text line plus the composer's own vertical
   padding and border, computed at runtime from the user's font-size setting
   and the wrapper's resolved style — no fixed pixel constant (criterion 10).
5. Maximum = the measured top of the usable area under the header — no
   header/dock constant (criterion 10).
6. Default = the composer's measured resting height on mount, before any
   drag. Double-tap on the handle toggles default ↔ maximized (criteria 13,
   3).
7. Haptics on grab, release, double-tap — native only, never during the
   drag (criterion 9).
8. Height persists device-local (AsyncStorage + Zod-validated read),
   survives relaunch/reload, re-clamped on restore (criterion 14).
9. Upstream browser tests asserting composer growth get fork-tagged skips;
   our browser test replaces their coverage (user-authorized 2026-09-26).

**Not in scope:**

- Line quantization — banned in v1 (criterion 7); a possible later bonus.
- Per-workspace height; any settings UI.
- The upstream Android composer-keyboard harness (manual-run; named in
  Risks).
- Rotation mid-drag; daemon sync of height; upstream `input.tsx` and the
  `height.*` files; the workspace pane-split system.
- The iOS bottom-spacing change — owned by `feat/composer-ios-bottom-spacing`
  (merged to main 2026-09-26). This plan only absorbs it, by measuring.

## Acceptance criteria

1. The drag begins only when a press on the handle moves past the
   activation threshold. A press alone, a tap, or sub-threshold movement
   changes nothing. Once active, height = height-at-press + (finger Y now
   − finger Y at press), within 1px, every frame — including the first
   frame after activation, so the threshold causes no jump.
2. A press with no movement changes nothing.
3. A quick tap on the handle (below the activation threshold) changes
   nothing — no toggle, no collapse.
4. A press anywhere else — chat, text area, buttons — never resizes; a
   scroll begun on the handle scrolls the chat instead of resizing.
5. While pressed, at every sampled frame: (current height − starting
   height) equals (finger Y now − finger Y at press), within 1px.
6. A fast fling lands the height exactly at where the finger ended — the
   height is computed from the finger's current position every frame,
   never accumulated from per-frame deltas, never racing ahead to a bound.
7. One pixel of finger movement changes the height by about one pixel;
   consecutive heights are arbitrary values — never rounded or snapped to
   line multiples.
8. Reversing direction mid-drag responds instantly, same scale in both
   directions.
9. Haptics: exactly one on grab, one on release, one on double-tap, and
   zero during movement — regardless of speed or distance. Never during
   the drag, not even once.
10. Minimum height = one full text line plus the composer's own padding
    and border, computed at runtime from the user's font-size setting;
    maximum = the top of the usable area under the header. At either bound
    the height holds while the finger keeps moving; pulling back resumes
    1:1 tracking immediately.
11. On release the height stays exactly at the last frame's value — no
    snap, no settle animation, no drift (assert: final move value == value
    one second later).
12. After release, nothing but a drag or a double-tap ever changes the
    height: typing, deleting, pasting, dictation, keyboard open/close,
    sending — zero effect (assert: type 200 lines, height identical).
13. Two taps within 300ms toggle between default and maximized (top of
    usable area); a single tap never does.
14. Height survives relaunch on phone and reload on web, re-checked
    against the bounds; mouse on web/desktop and touch on phone behave
    identically; chat reflows cleanly above the composer; keyboard motion
    unchanged.

## Goal

The composer's height is set only by dragging its top-edge handle or by
double-tapping it; min, max, and default are measured at runtime; auto-grow
is deleted and long text scrolls inside.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream
is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                    | Edit                                                                                                                                                                                                                                                                                                                                                                                                | Upstream activity                                                                  | Tag                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------- |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`       | height state: live height, clamp to [min, max], default and maximized, persist/load via AsyncStorage + Zod-validated read (garbage → default), re-clamp on restore                                                                                                                                                                                                                                  | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts`  | store unit tests, written first: clamp at both bounds, default/maximized, persistence round-trip, garbage-tolerant load                                                                                                                                                                                                                                                                             | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/composer-height-bounds.rambla.ts`      | bounds: min = content line height (theme content font × 1.4) + wrapper resolved vertical padding + border; max = measured usable-area top; all values passed in, zero constants                                                                                                                                                                                                                     | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/composer-height-bounds.rambla.test.ts` | bounds unit tests at font settings 10, 15, 21, written first                                                                                                                                                                                                                                                                                                                                        | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`       | handle row: RNGH pan with `.runOnJS(true)` first (the `resize-handle.tsx` pattern), activation threshold, grab/release haptics, double-tap toggle, pressed state                                                                                                                                                                                                                                    | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/composer-drag-handle.rambla.test.ts`   | handle unit tests, written first in its step: haptic schedule — exactly one on grab, release, double-tap, zero during movement — asserted through the composer-haptics guard module (native-only guard, the `use-long-press-drag-interaction.ts` precedent), which the handle takes as its only haptics path; plus threshold and 300ms double-tap-window decisions                                  | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/src/composer/input/input.rambla.tsx`                      | explicit `height` on the wrapper container; handle row as its first child; remove the stock growth wiring (`useComposerHeight` import+call, its entry in the text input's style array, `updateComposerHeightForText` at all 3 call sites + dep-array entries, `resetComposerHeight`, `isComposerScrollEnabled` folded to constant true, `webTextareaRef`/`getLiveText` if their only consumer goes) | existing (fork-only, ours; carries unrelated dictation work — surgical edits only) | `RAMBLA-FORK: feat:`      |
| `packages/app/e2e/browser/composer-drag-handle.rambla.browser.test.ts`  | Playwright E2E against the real web app (setup spawns Metro): real mouse drags, per-frame 1:1 (≤1px), threshold, bounds hold, fling/reversal, release hold, double-tap, reload persistence, type-200-lines                                                                                                                                                                                          | new                                                                                | `RAMBLA-FORK: feat:`      |
| `packages/app/e2e/browser/composer-whitespace.spec.ts`                  | fork-tagged skips on its two growth tests ("blank composer lines remain present and keep their measured height", "composer growth keeps a bottom-pinned chat at the bottom") — this feature replaces the behavior they assert (user-authorized 2026-09-26)                                                                                                                                          | upstream, last touched 2026-09-16 (#4902)                                          | `RAMBLA-FORK: skip-test:` |

**Why this shape:** the height is one measured, clamped value on the
fork-owned wrapper container, and every bound is read from runtime truth —
resolved style and live measurements — so the pending iOS bottom-spacing
merge (and any future padding change) is absorbed with no amendment here.
Deriving any bound from a constant would bake in an assumption another
branch is free to change.

**Branch:** `feat/adjustable-composer-height` — the user's standing choice
(only 1 upstream file edited; the skill would otherwise say main). Already
checked out.

## Constraints

- No file outside the table changes. Upstream `input.tsx` and
  `height.native/web/types/d.ts` stay byte-identical.
- **Zero hard-coded or assumed spacing anywhere in the height path** — no
  pixel constants, no header/dock reserve constants, no safe-area numbers,
  no theme-token lookup substituting for the wrapper's resolved values.
  Min, max, and default come from runtime truth only.
- Min inputs: line height from `theme.fontSize.content` × 1.4 (the
  composer's own formula; follows the font-size setting, which is clamped
  10–21 in settings storage and patched into themes at runtime) plus the
  wrapper's resolved vertical padding and border, read from the same
  resolved style the wrapper renders — breakpoint included. Never
  re-derived from token tables.
- Max from a live measurement of the usable area's top under the header
  (`measureInWindow`), re-measured on keyboard frame change/hide; the
  anchor is fixed during a drag.
- Default measured on mount (the resting height before any drag). A stored
  height is re-clamped against fresh bounds before first render.
- No quantization anywhere — store, gesture, render; heights are arbitrary
  values (criterion 7; the R4b defect).
- `.runOnJS(true)` first in the pan chain, per `resize-handle.tsx` (the
  ordering that fixed an iOS crash).
- Haptics behind a native-only guard (the sidebar long-press-drag
  precedent): grab, release, double-tap only; none during movement
  (criterion 9; R2's constant buzz).
- A tap below the activation threshold mutates nothing (criteria 2, 3);
  double-tap window 300ms (criterion 13).
- The browser test drives real trusted input via Playwright's mouse API
  against the Metro web app; it never calls store setters directly.
- Coding may start now: `feat/composer-ios-bottom-spacing` is merged to
  main (`2572b98ea`). Nothing here depends on its values; the merge is
  absorbed by measurement. Rebase this branch onto main before step 1.
- Upstream tests untouched except the two authorized skips in
  `composer-whitespace.spec.ts`.
- Simplicity: helper machinery beyond the table's shapes → stop and report.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.

1. **Store + unit tests (TDD).** Write
   `composer-height-store.rambla.test.ts` first, then
   `composer-height-store.rambla.ts`: live height, clamp to [min, max],
   default and maximized, persist/load (AsyncStorage + Zod-validated read;
   garbage → default), re-clamp on restore. Red → green → typecheck/lint →
   commit.
   **Acceptance criteria**: the store clamps at both bounds; an absent or
   garbage stored value loads as default; a persist/load round-trip
   preserves the height. (Feeds criteria 11, 14.)

2. **Bounds module + unit tests (TDD).** Write
   `composer-height-bounds.rambla.test.ts` first (font settings 10, 15,
   21), then `composer-height-bounds.rambla.ts`: min = content line height
   (theme content font × 1.4) + wrapper resolved vertical padding + border;
   max = the measured usable-area top; all inputs passed in — the module
   owns no constants. Red → green → typecheck/lint → commit.
   **Acceptance criteria**: min scales with the font setting and with the
   wrapper's resolved padding/border (so the bottom-spacing merge changes
   it with no edit here); max equals the measured value passed in. (Feeds
   criterion 10.)

3. **Drag handle + wiring, tests first. USER REVIEWS A SCREEN
   RECORDING of this step before the plan continues.** Write
   `composer-drag-handle.rambla.browser.test.ts` first: threshold
   activation, press-without-move, tap-below-threshold, press elsewhere
   never resizes, 1:1 per-frame tracking including the first
   post-activation frame, fling, mid-drag reversal, release hold. Write
   `composer-drag-handle.rambla.test.ts` (unit) covering the haptic
   schedule through the composer-haptics guard module — exactly one on
   grab, release, double-tap, zero during movement — plus the threshold
   and the 300ms double-tap window. Then
   `composer-drag-handle.rambla.tsx` (pan with `.runOnJS(true)` first,
   activation threshold, per `resize-handle.tsx`) and the wiring in
   `input.rambla.tsx`: explicit `height` on the wrapper container, handle
   row as its first child. If the still-present stock growth wiring fights
   the wrapper height in E2E, stop and report. Typecheck/lint → commit.
   **Acceptance criteria**: criteria 1–8 pass in E2E; criterion 9 passes
   in the unit tests.

4. **Bounds live in E2E.** Extend the browser test: at min and max the
   height holds while the finger keeps moving; pulling back resumes 1:1
   immediately. Typecheck/lint → commit.
   **Acceptance criteria**: criterion 10 passes in E2E.

5. **Double-tap + haptics in E2E.** Extend the browser test: two taps
   within 300ms toggle default ↔ maximized; a single tap never toggles.
   Criterion 9 is asserted in the handle's unit tests (step 3) through the
   composer-haptics guard module — the guard is native-only and off on
   web, so E2E covers the toggle, the unit tests cover the haptic
   schedule. Typecheck/lint → commit.
   **Acceptance criteria**: criteria 3, 13 pass in E2E; criterion 9 in the
   handle unit tests.

6. **Persistence in E2E.** Extend the browser test: reload restores the
   height, re-clamped against fresh bounds. Typecheck/lint → commit.
   **Acceptance criteria**: the reload half of criterion 14 passes in E2E.

7. **Delete auto-grow.** In `input.rambla.tsx` remove: the
   `useComposerHeight` import and call; its entry in the text input's
   style array; `updateComposerHeightForText` at all 3 call sites and
   their dep-array entries; `resetComposerHeight`;
   `isComposerScrollEnabled` folded to a constant true (the box no longer
   grows, so the input always scrolls); `webTextareaRef`/`getLiveText` if
   their only consumer goes. Extend the browser test: type 200 lines,
   height identical. Add the two fork-tagged skips in
   `composer-whitespace.spec.ts`. Typecheck/lint → commit.
   **Acceptance criteria**: criterion 12 passes in E2E; both skips tagged;
   `settings-toggle-tab-regression.spec.ts` still passes.

8. **User's hands-on acceptance.** iOS (touch): drag 1:1 with no jumps or
   snap, release holds, relaunch holds, long draft scrolls inside,
   double-tap toggles, keyboard motion unchanged, chat reflows. Desktop
   (mouse): same. The plan finishes only on the user's confirmation.
   **Acceptance criteria**: criterion 14 in full, and the user likes it.

## Verification

- `npm run typecheck`
- `npm run lint`
- From `packages/app/`:
  `npx vitest run src/composer/input/composer-height-store.rambla.test.ts src/composer/input/composer-height-bounds.rambla.test.ts src/composer/input/composer-drag-handle.rambla.test.ts --bail=1`
- From `packages/app/`:
  `npm run test:e2e -- e2e/browser/composer-drag-handle.rambla.browser.test.ts`
  — per-frame 1:1 (≤1px), threshold, bounds hold, fling/reversal, release
  hold, double-tap, reload persistence, type-200-lines.
- From `packages/app/`:
  `npm run test:e2e -- e2e/browser/settings-toggle-tab-regression.spec.ts`
  — still green.
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx packages/app/e2e/browser/composer-whitespace.spec.ts`
  — both must show tags.
- Seen working: the step 3 screen recording; step 8 hands-on on iOS and
  desktop.

## Risks

- Sequencing: `feat/composer-ios-bottom-spacing` is merged to main
  (`2572b98ea`) — resolved 2026-09-26. Nothing here depends on its
  values; bounds are measured.
- Both features edit `input.rambla.tsx`. It is fork-owned (upstream never
  conflicts); the rebase onto post-merge main keeps the overlap small.
- The pan must not steal scrolls from the chat — the gesture lives only on
  the handle row (criterion 4 catches it).
- The upstream Android manual harness (`e2e/mobile/composer-keyboard/`)
  also asserts growth; out of scope and untagged — it may mislead manual
  Android testing until Android work happens.
- No others known (looked).
