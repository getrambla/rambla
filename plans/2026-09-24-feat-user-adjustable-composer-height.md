# feat: user-adjustable composer max height via drag handle

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (v0.9.1) — 2026-09-21

## Scope

**In scope:**

1. A persisted, per-device user ceiling for the chat composer's auto-grow height, set by dragging a grabber handle on the composer's top edge.
2. Double-tap (double-click on web) on the handle toggles the ceiling between the app default and the maximum the viewport bound allows.
3. Works for typed and dictated composition alike, mobile and desktop/web: content still auto-grows with text up to the user ceiling and scrolls beyond it.
4. Hard clamps: the stored ceiling can never push the composer past the existing viewport-ratio bound, and the existing minimum height is untouched.

**Not in scope:**

- Fullscreen or expanded compose modal.
- Changing the minimum height, the 160px default, or the 50%-viewport bound for users who never touch the handle.
- A settings-page entry for composer height.
- Per-workspace or per-conversation height memory.
- Keyboard-inset or safe-area behavior around the composer dock.

## Goal

Let the user decide how tall the composer may grow while composing, so a long draft stays readable without covering chat history.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                                   | Edit                                                                                | Upstream activity          | Tag                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------- | -------------------- |
| `packages/app/src/composer/input/input.rambla.tsx`                     | read the store to cap `maxInputHeight`; render the handle at the wrapper's top edge | existing (fork-only, ours) | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.ts`      | persisted zustand store: stored ceiling or default sentinel, clamped setter, toggle | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-height-store.rambla.test.ts` | sentinel default, clamp behavior, persistence round-trip, toggle                    | new                        | `RAMBLA-FORK: feat:` |
| `packages/app/src/composer/input/composer-drag-handle.rambla.tsx`      | grabber row: pan adjusts the ceiling, double-tap toggles default/max                | new                        | `RAMBLA-FORK: feat:` |

The app renders `input.rambla.tsx` on every platform — it is the only `MessageInput` import site ([index.tsx:57](../packages/app/src/composer/index.tsx#L57)) — so 1 file serves mobile and web. The wrapper is a column whose first child, the attachment slot, renders `null` when empty ([input.rambla.tsx:1858](../packages/app/src/composer/input/input.rambla.tsx#L1858)), leaving the top edge free for the handle. The height cap enters at the existing `useComposerHeight` wiring ([input.rambla.tsx:1232](../packages/app/src/composer/input/input.rambla.tsx#L1232)); height changes already flow to the panel via `onHeightChange` ([input.rambla.tsx:1239](../packages/app/src/composer/input/input.rambla.tsx#L1239)), so no panel file changes. Persistence follows the local view-state store pattern ([sidebar-view-store.ts:179](../packages/app/src/stores/sidebar-view-store.ts#L179) with [validated-persist-storage.ts](../packages/app/src/storage/validated-persist-storage.ts)); it is a per-device view preference, not a synced app setting.

**Why this shape:** every touched path is fork-owned, so upstream's weekly merges can never conflict; keeping the input-file edit to cap-resolution plus one rendered row leaves the fork file small enough to stay diffable against its upstream origin.

**Branch:** none — 0 upstream files edited, work on main.

## Constraints

- No file outside the table changes — including upstream's `input.tsx`, which carries the same constants but is dead code at runtime.
- Users who never drag the handle see today's behavior exactly.
- No new dependency: gestures use what the codebase already uses (react-native-gesture-handler where present).
- No app-settings schema or migration changes; the store uses `createValidatedPersistStorage`.
- Hover-only affordances are forbidden; pointer handling follows the plain-View hover/press pattern in `docs/hover.md`.
- The handle must not steal taps from the attachment slot or textarea; its hit area stays inside its own row.
- Upstream test files untouched; new tests live only in the `.rambla.test.ts` file.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor — do not amend this plan and do not re-decide placement while coding.
1. Create `composer-height-store.rambla.ts`: persisted store holding the user ceiling (null sentinel = app default), a clamped setter, a reset action; clamp against the live viewport bound at read time so rotation/window resize stays safe.
2. Create `composer-height-store.rambla.test.ts`: default sentinel, clamping, persistence round-trip, reset.
3. Create `composer-drag-handle.rambla.tsx`: a slim grabber row; drag adjusts the ceiling by pixel delta through the store's clamped setter; double-tap toggles between the app default and the viewport maximum.
4. Edit `input.rambla.tsx`: resolve `maxInputHeight` as the existing bound capped by the store value, and render the handle as the wrapper's first child above the attachment slot. Tag each block `RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height` + one clause.
5. Verify per below.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/composer/input/composer-height-store.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/input/input.rambla.tsx` — shows the tags.
- In the running app: drag the handle up and down with a long dictation draft in the field on mobile and web; the chat list stays visible; typing past the ceiling scrolls inside the box; double-tap flips between default and near-full height; reload keeps the chosen height.

## Risks

- The handle row sits where the attachment slot appears; when an attachment tray renders, the handle must stay above it without overlapping its hit area.
- Web drag could start a text selection; the handle must set `userSelect: "none"` on web itself and capture the pointer, not rely on any ancestor style.
- On native, repeated height changes mid-dictation re-run the keyboard-shift layout; the existing `onHeightChange` → `prepareForViewportChange` path is the mitigation and needs no new code.
