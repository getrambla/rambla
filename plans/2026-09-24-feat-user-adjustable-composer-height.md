# feat: user-adjustable composer max height via drag handle

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (v0.9.1) — 2026-09-21

## Scope

**In scope:**

1. While the handle is held, the composer's height follows the finger 1:1 — constraints released: the minimum drops to 1 text line, and there is no maximum (the box may grow to the top of the window). Content scrolls inside the box while dragging.
2. On release, the height the user left the box at is pinned: minimum = maximum = that height. The chosen height persists per device and holds for any draft length.
3. Haptic feedback: a single tick on grab, and one tick per line crossed during the drag (not continuous).
4. The handle row shows a pressed/active state for the whole drag.
5. Works while composing and while live dictation is running, mobile and desktop/web.
6. Double-tap (double-click on web) still toggles between the app default and the viewport maximum.

**Not in scope:**

- Fullscreen or expanded compose modal.
- Behavior for users who never touch the handle: today's auto-grow stays exactly as shipped.
- A settings-page entry for composer height.
- Per-workspace or per-conversation height memory.
- Keyboard-inset or safe-area behavior around the composer dock.

## Goal

Let the user decide how tall the composer is: while held, the handle drags the box freely (1 line minimum, no maximum); on release the box pins at the height it was left at.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                   | Edit                                                                                                                                                  | Upstream activity          | Tag                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| `packages/app/src/composer/input/input.rambla.tsx`                     | read the store to cap `maxInputHeight`; render the handle at the wrapper's top edge; honor an explicit stored height (fixed height with inner scroll) | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`      | persisted zustand store: explicit height (null = today's auto-grow), line-quantized setters clamped to 2 lines and the viewport bound                 | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts` | sentinel default, clamp behavior, persistence round-trip, toggle                                                                                      | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`      | grabber row: drag moves the actual height in line steps with haptics and a pressed state; double-tap toggles default/max                              | new                        | `RAMBLA-FORK: feat:` |

The app renders `input.rambla.tsx` on every platform — it is the only `MessageInput` import site ([index.tsx:57](../packages/app/src/composer/index.tsx#L57)) — so 1 file serves mobile and web. The wrapper is a column whose first child, the attachment slot, renders `null` when empty ([input.rambla.tsx:1858](../packages/app/src/composer/input/input.rambla.tsx#L1858)), leaving the top edge free for the handle. The height cap enters at the existing `useComposerHeight` wiring ([input.rambla.tsx:1232](../packages/app/src/composer/input/input.rambla.tsx#L1232)); height changes already flow to the panel via `onHeightChange` ([input.rambla.tsx:1239](../packages/app/src/composer/input/input.rambla.tsx#L1239)), so no panel file changes. Persistence follows the local view-state store pattern ([sidebar-view-store.ts:179](../packages/app/src/stores/sidebar-view-store.ts#L179) with [validated-persist-storage.ts](../packages/app/src/storage/validated-persist-storage.ts)); it is a per-device view preference, not a synced app setting.

**Why this shape:** every touched path is fork-owned, so upstream's weekly merges can never conflict. The v1 defect was the interaction model, not the placement: the store held a grow-only ceiling floored at 160px while the native composer's height is content-driven, so most store values were unobservable ([height.native.ts:13](../packages/app/src/composer/input/height.native.ts#L13)); the fix replaces ceiling-state with height-state in the same fork files.

**Device-tested defects this revision fixes** (auditor citations): the pan gate `activeOffsetY([-6,6])` + `failOffsetX([-6,6])` rejects any drag that drifts horizontally, so grabs fail ([composer-drag-handle.rambla.tsx:106](../packages/app/src/composer/input/composer-drag-handle.rambla.tsx#L106)); the 160px floor in `clampCeiling` makes every downward drag a no-op ([composer-height-store.rambla.ts:42](../packages/app/src/composer/input/composer-height-store.rambla.ts#L42)); height being content-driven left exactly 2 visible sizes — content-hug (~4 lines) and the 160 cap (~6.5 lines); no pressed state or haptic exists ([composer-drag-handle.rambla.tsx:171](../packages/app/src/composer/input/composer-drag-handle.rambla.tsx#L171)) despite the design docs requiring pressed states and `expo-haptics` already being the codebase pattern ([use-long-press-drag-interaction.ts:90](../packages/app/src/components/sidebar/use-long-press-drag-interaction.ts#L90)). Nothing overlays the handle during dictation (the strip is in-flow below the text surface, [dictation-recording-controls.rambla.tsx:52](../packages/app/src/composer/input/dictation-recording-controls.rambla.tsx#L52)); the dictation failure is the same gesture gate plus no visible drag effect.

**Branch:** none — 0 upstream files edited, work on main.

## Constraints

- No file outside the table changes — including upstream's `input.tsx`, which carries the same constants but is dead code at runtime, and the height hooks (`height.native.ts`, `height.types.ts`, `height.web.ts`): the fixed height rides the existing intrinsic mode via equal min/max.
- Users who never drag the handle see today's behavior exactly.
- No new dependency: gestures use what the codebase already uses (react-native-gesture-handler where present).
- No app-settings schema or migration changes; the store uses `createValidatedPersistStorage`.
- Hover-only affordances are forbidden; pointer handling follows the plain-View hover/press pattern in `docs/hover.md`.
- The handle must not steal taps from the attachment slot or textarea; its hit area stays inside its own row.
- Upstream test files untouched; new tests live only in the `.rambla.test.ts` file.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. Rewrite `composer-height-store.rambla.ts`: persisted store holds the composer's pinned height (null = today's auto-grow); a non-persisted live `dragHeight` field tracks the height mid-drag; setters quantize to whole text lines with a 1-line minimum and no maximum beyond the window; bump `COMPOSER_HEIGHT_STORE_VERSION` to 2 so v1's ceiling-shaped values migrate to null (today's auto-grow) instead of being reinterpreted as explicit heights.
2. Update `composer-height-store.rambla.test.ts`: pin set/clear, drag-height tracking, line quantization, 1-line minimum, persistence round-trip, migration.
3. Rewrite `composer-drag-handle.rambla.tsx`: on grab, one haptic and the drag session starts; while held, the finger's height (1:1, quantized to line steps, one haptic per line crossed — never continuous) feeds the store's live `dragHeight`; on release, the store pins min = max = that height; fix the haptic loop so ticks fire only on line changes (v2 device bug: constant buzz); relax the gesture activation so slight horizontal drift does not kill the grab (fix for [composer-drag-handle.rambla.tsx:106](../packages/app/src/composer/input/composer-drag-handle.rambla.tsx#L106)); haptics via `expo-haptics` (pattern at [use-long-press-drag-interaction.ts:90](../packages/app/src/components/sidebar/use-long-press-drag-interaction.ts#L90)); pressed/active state on the row while held; double-tap toggle stays.
4. Edit `input.rambla.tsx`: three render states — during an active drag (live `dragHeight`), release the constraints: minimum 1 line, no maximum (window top); when a height is pinned, pass `minHeight: H, maxHeight: H` through the existing intrinsic mode — the box renders at H with content scrolling inside; when null, today's values. Keep the handle as the wrapper's first child.
5. Verify per below.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer/input/composer-height-store.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx` — shows the tags.
- On device (iOS TestFlight): press and hold the handle and drag — the box follows the finger freely, down to 1 line and up toward the window top with no ceiling; release — the box pins exactly where left; haptic fires once on grab and once per line crossed, never continuously; row visibly pressed while held; grabs succeed even with sloppy diagonal starts; works while dictation is running; a short draft holds a tall pinned height; never-touched installs keep today's auto-grow; double-tap still flips default/max.

## Risks

- The handle row sits where the attachment slot appears; when an attachment tray renders, the handle must stay above it without overlapping its hit area.
- Web drag could start a text selection; the handle must set `userSelect: "none"` on web itself and capture the pointer, not rely on any ancestor style.
- On native, repeated height changes mid-dictation re-run the keyboard-shift layout; the existing `onHeightChange` → `prepareForViewportChange` path is the mitigation and needs no new code.
- Fixed-height mode must re-clamp on rotation and window resize (a pinned height taller than a rotated window shrinks to fit; the window top is the only ceiling).
- Relaxing the pan activation must not make the handle steal vertical scrolls meant for the chat list; the gesture lives only on the 16px row.
