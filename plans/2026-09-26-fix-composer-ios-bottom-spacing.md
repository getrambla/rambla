# fix: slim the composer's bottom spacing on iOS

Status: approved

## Provenance

- main: `4a5c00b97` — 2026-09-26
- upstream-rebrand: `7b8f99096` — 2026-09-25
- upstream/main: `8cd989529` (untagged) — 2026-09-25

## Scope

**In scope:**

1. A single runtime-computed composer bottom-inset value, in one new
   `*.rambla.ts` module, that replaces the raw `insets.bottom` the native
   dock pads with — reduced so the gap under the composer is visibly
   smaller on iPhone while keeping a small clearance above the
   home-indicator swipe bar.
2. The iOS keyboard translate consuming that same computed value instead of
   raw `insets.bottom`, so the composer stays flush against the keyboard.
3. A smaller `paddingBottom` for the composer's input-area container on the
   phone breakpoint (16 → 8).
4. A smaller in-panel `paddingVertical` for the message input wrapper on the
   phone breakpoint (8 → 4), tightening the gap between the panel's bottom
   edge and the model/thinking control row.

**Not in scope:**

- Android — untested by the user; no Android-specific file changes.
- Web layout — the web dock (`dock/index.tsx`) and web input paths stay
  untouched.
- The in-progress drag-handle resize plan — its bounds must stay
  measurement-based; this change deliberately adds no constant it could
  hard-code against.
- Any user-facing spacing setting.
- The desktop/tablet `centered` dock variant and its
  `HEADER_INNER_HEIGHT + 24` reserve ([dock/index.native.tsx:93](../packages/app/src/composer/dock/index.native.tsx#L93)).

## Acceptance criteria

1. On iOS, the vertical gap between the composer's gray panel and the
   bottom of the screen is visibly smaller than before, and no control sits
   overlapping or under the home-indicator swipe bar.
2. The gap between the gray panel's bottom edge and the model/thinking/etc.
   controls inside it is visibly smaller on the phone breakpoint.
3. With the keyboard open, the composer sits flush against the top of the
   keyboard — no gap, no overlap.
4. No spacing value in this change is derived from another component's
   hardcoded constant; the single computed bottom-inset value lives in one
   `*.rambla.ts` module and is the only source both consumers read.
5. Web composer layout is unchanged.

## Goal

The composer's bottom margin on iOS consumes excessive screen space
(safe-area inset + two paddings stack to ~58pt). Slim it while keeping the
home-indicator clearance and keyboard alignment intact, with the reduced
value computed in exactly 1 place so later work (the drag-resize plan) measures
rather than assumes it.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                  | Edit                                                                | Upstream activity                                  | Tag                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------- | ------------------- |
| `packages/app/src/composer/dock/composer-bottom-inset.rambla.ts`      | the single runtime bottom-inset computation                         | new                                                | `RAMBLA-FORK: fix:` |
| `packages/app/src/composer/dock/index.native.tsx`                     | 1-line call to the new module at the L132 padding site              | last touched 2026-06 in #4973, quiet since         | `RAMBLA-FORK: fix:` |
| `packages/app/src/keyboard/shift/internal/translate.ios.tsx`          | 1-line swap of `insets.bottom` for the module's value               | last touched 2026-06 in #4973, quiet since         | `RAMBLA-FORK: fix:` |
| `packages/app/src/composer/index.tsx`                                 | one style value change in `inputAreaContainer` (L2540)              | active upstream (rebrand 2026-09-25, #4973, #4958) | `RAMBLA-FORK: fix:` |
| `packages/app/src/composer/input/input.rambla.tsx`                    | one breakpoint value change in `inputWrapper` (L1999–2002)          | ours (fork split of upstream's `input.tsx`)        | `RAMBLA-FORK: fix:` |
| `packages/app/src/composer/dock/composer-bottom-inset.rambla.test.ts` | covers the computed inset: reduced vs raw inset, positive clearance | new                                                | `RAMBLA-FORK: fix:` |

`input.rambla.tsx` is our fork's own file (upstream has `input.tsx`), so
despite its size it can never conflict.

**Why this shape:** the two behavior-bearing edits (dock padding, keyboard
offset) are one-line swaps at upstream call sites feeding a single
`*.rambla.ts` module — rule 3 placement, minimal conflict surface. The two
padding tweaks are 1-value changes, rule 4. Copying the whole dock or
translate file would orphan upstream's #4973-era fixes for no gain.

**Branch:** none — 3 upstream files edited, work on main.

## Cause

Three spacings stack under the composer on iOS: the dock pads the composer
with the raw 34pt safe-area inset
([dock/index.native.tsx:132](../packages/app/src/composer/dock/index.native.tsx#L132)), the input-area container adds a 16pt
`paddingBottom` ([composer/index.tsx:2540](../packages/app/src/composer/index.tsx#L2540)), and the input wrapper adds
8pt `paddingVertical` above the control row on the phone breakpoint
([input/input.rambla.tsx:1999](../packages/app/src/composer/input/input.rambla.tsx#L1999)). All three were sized for default
type; at large accessibility type sizes the fixed chrome crowds the
timeline. The keyboard translate ([translate.ios.tsx:20](../packages/app/src/keyboard/shift/internal/translate.ios.tsx#L20)) separately adds
`insets.bottom` during keyboard motion, so shrinking the dock padding
without updating that offset would leave a gap above the keyboard.

## Constraints

- Only the six tabled files change; `composer/index.tsx` and
  `input.rambla.tsx` edits are the single named style values, one
  contiguous block each.
- The computed inset may be written in exactly 1 place (the new module);
  no consumer may inline or re-derive a spacing number.
- No new abstractions, options, settings, or platform checks beyond what
  the module needs; no behavior change on web or in the `centered` dock
  variant.
- Upstream tests (`capacity.test.ts` and all others) stay untouched.
- Existing fork rules hold: fork-tag every upstream-file edit; the
  `packages/server` zai fetcher's `providerId` is never touched.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out
   to be wrong, stop and report back to the supervisor — do not amend this
   plan and do not re-decide placement while coding.
1. Create `packages/app/src/composer/dock/composer-bottom-inset.rambla.ts`
   with the single computed bottom-inset value: derived from the safe-area
   bottom inset at runtime, reduced by the module's own clearance factor,
   never negative. Write
   `composer-bottom-inset.rambla.test.ts` covering: output is smaller than
   the raw inset on a 34pt device; a small positive clearance remains;
   zero inset yields zero.
   **Acceptance criteria**: 4; tests pass
   (`npx vitest run packages/app/src/composer/dock/composer-bottom-inset.rambla.test.ts --bail=1`).
2. Swap [dock/index.native.tsx:132](../packages/app/src/composer/dock/index.native.tsx#L132) to pad with the module's value (fork
   tag on the block), and swap `translate.ios.tsx`'s [line 20](../packages/app/src/keyboard/shift/internal/translate.ios.tsx#L20) `insets.bottom`
   factor for the same value (fork tag). Nothing else in either file
   changes.
   **Acceptance criteria**: 3 and 4 — with the keyboard open the composer
   rides the keyboard exactly as before; both consumers read the one
   module.
3. Change `paddingBottom` at [composer/index.tsx:2540](../packages/app/src/composer/index.tsx#L2540) to `theme.spacing[2]`
   and xs values at [input/input.rambla.tsx:1999](../packages/app/src/composer/input/input.rambla.tsx#L1999) `paddingVertical` to
   `theme.spacing[1]` (fork tags). Web breakpoint values untouched.
   **Acceptance criteria**: 2; no composer test regresses
   (`npx vitest run packages/app/src/composer --bail=1`).
4. Ship a native build for the user to view on the iPhone. This step is the
   user's visual review; the plan is not done until they accept it.
   **Acceptance criteria**: 1 and 5 — the gap is visibly smaller, controls
   clear the swipe bar, and the user likes the result.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/dock/index.native.tsx packages/app/src/keyboard/shift/internal/translate.ios.tsx packages/app/src/composer/index.tsx packages/app/src/composer/input/input.rambla.tsx` — each must show a tag.
- In the Expo iOS app: composer gap smaller (AC 1), in-panel gap smaller
  (AC 2), keyboard-open alignment intact (AC 3), web reload unchanged
  (AC 5).

## Risks

- The iOS keyboard translate and dock padding must change together; if only
  one lands, the composer floats or overlaps at keyboard-open (AC 3 catches
  it).
- Upstream is actively touching `composer/index.tsx`; the one-line style
  edit may conflict on a future merge — acceptable, it is a 1-line edit.
- The clearance factor is a judgment call until the user sees the build;
  step 4 exists for that.
