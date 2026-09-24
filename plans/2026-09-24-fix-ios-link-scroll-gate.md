# fix: iOS link scroll gate

## Provenance

- main: `3e5566f2b` — 2026-09-24
- upstream-rebrand: `61b044d8b` — 2026-09-21
- upstream/main: `135a3b4c9` (untagged) — 2026-09-21

## Scope

**In scope:**

1. A module-level gate that records whether the native chat stream's user scroll
   (drag or momentum) is currently active.
2. The chat FlatList's existing scroll handlers keep that gate in sync.
3. Assistant file link presses are ignored while the gate is active, on iOS —
   so a scroll that starts on a link no longer opens it when the finger lifts.

**Not in scope:**

- Any change to react-native-uitextview, its native code, or a node_modules
  patch (the 2.7.1 bump is already done separately and stays).
- Any delay after scroll ends — a clean tap after momentum has settled opens
  the link instantly, exactly as today.
- Web behavior; links on web already go through the `<a>` path.
- Selection-copy, tooltips, or any other link interaction besides open-on-press.

## Goal

On iOS, lifting a finger off a link after scrolling the chat opens the link.
The native tap recognizer fires onPress at touch-up regardless of the scroll
gesture, and the library offers no scroll awareness. Rambla fixes this in its
own code: the scroll lifecycle the stream already tracks gates the link's
onPress.

## Merge conflict mitigation

This is a permanent fork of upstream Paseo. Nothing goes upstream; upstream
is merged in weekly. Code below follows the fork's placement rules.

**Files this work changes:**

| File                                                       | Edit                                                                                                                                      | Upstream activity                                   | Tag                 |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------- |
| `packages/app/src/agent-stream/link-scroll.rambla.ts`      | new module: `setLinkScrollActive` / `isLinkScrollActive` flag                                                                             | new                                                 | `RAMBLA-FORK: fix:` |
| `packages/app/src/agent-stream/link-scroll.rambla.test.ts` | covers set/clear round-trip                                                                                                               | new                                                 | `RAMBLA-FORK: fix:` |
| `packages/app/src/agent-stream/strategy-native.tsx`        | 3 one-line calls next to existing `isUserScrollActiveRef` writes (begin: set true; deferred drag end: set false; momentum end: set false) | 5 commits in recent months, composer/keyboard fixes | `RAMBLA-FORK: fix:` |
| `packages/app/src/assistant-file-links/use-file-link.ts`   | inside module function `openAssistantFileLink`, early return when gate is active, iOS only                                                | 5 commits since late last year, none recent         | `RAMBLA-FORK: fix:` |

**Why this shape:** module function `openAssistantFileLink` is the single
choke point every assistant link open flows through — file and code links via
`useFileLink`'s `onPress` ([use-file-link.ts:117](../packages/app/src/assistant-file-links/use-file-link.ts#L117)), and markdown URL
links via `handleMarkdownLinkPress` → `useAssistantFileLinkActions().open`
([message.tsx:1524](../packages/app/src/components/message.tsx#L1524)) — and `isUserScrollActiveRef` already tracks
exactly the lifecycle needed: its deferred drag-end is cancelled by momentum
begin, so the flag naturally spans momentum. Both upstream edits are bare
statement additions at calm seams; copying more (context provider, wrapping
component) would grow the fork surface for no benefit.

**Branch:** none — 2 upstream files edited, work on main.

## Cause

react-native-uitextview (2.2.0 and 2.7.1 alike) dispatches `onPress` from its
native recognizer at touch-up even when that touch-up ends a scroll drag that
began on the link; the recognizer runs simultaneously with the list's scroll
pan. The stream already mirrors this lifecycle in
`isUserScrollActiveRef` ([strategy-native.tsx:407](../packages/app/src/agent-stream/strategy-native.tsx#L407) true at drag begin, false
at deferred drag end [strategy-native.tsx:427](../packages/app/src/agent-stream/strategy-native.tsx#L427) and at momentum end
[strategy-native.tsx:445](../packages/app/src/agent-stream/strategy-native.tsx#L445)), but the flag is component-local and nothing on the
link path consults it, so module function `openAssistantFileLink`
([use-file-link.ts:156](../packages/app/src/assistant-file-links/use-file-link.ts#L156)) opens unconditionally on both press
paths.

## Constraints

- No file outside the mitigation table changes; no upstream test file is touched.
- The gate module exports only the two functions; no timers, no options, no
  per-surface registry.
- `strategy-native.tsx` edits stay one statement per handler, placed next to
  the existing `isUserScrollActiveRef` writes; no reordering of upstream code.
- `use-file-link.ts` edit stays at the top of module function
  `openAssistantFileLink`; no change to either hook's return shape or to the
  public `open` signatures.
- No new imports in `strategy-native.tsx` beyond the gate module;
  `use-file-link.ts` may additionally import `Platform` from `react-native`
  for the iOS-only gate (`Platform.OS === "ios"`; `constants/platform.ts`
  exports no iOS constant).
- Behavior must be unchanged on web, and unchanged for taps with no active
  scroll on iOS.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to
   be wrong, stop and report back to the supervisor — do not amend this plan
   and do not re-decide placement while coding.
1. Create `packages/app/src/agent-stream/link-scroll.rambla.ts` with the
   module-level flag and its set/get functions.
2. In `packages/app/src/agent-stream/strategy-native.tsx`, call the setter at
   the three `isUserScrollActiveRef` write sites: true in
   `handleScrollBeginDrag`, false in the deferred `handleScrollEndDrag` rAF,
   false in `handleMomentumScrollEnd`. Tag each block.
3. In `packages/app/src/assistant-file-links/use-file-link.ts`, make module
   function `openAssistantFileLink` return early when the gate reports an
   active scroll, on iOS only — this covers both press paths,
   `useFileLink`'s `onPress` and `handleMarkdownLinkPress`. Tag the block.
4. Create `packages/app/src/agent-stream/link-scroll.rambla.test.ts`
   covering set/clear round-trip.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/app/src/agent-stream/link-scroll.rambla.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" -- packages/app/src/agent-stream/strategy-native.tsx packages/app/src/assistant-file-links/use-file-link.ts` — both must show a tag.
- In the iOS app: scroll the chat starting on a link — finger lift must not
  open it; momentum gliding past a link with a lift must not open it; a clean
  tap on a link must still open it.

## Risks

- A tap landing in the same frame the deferred drag-end rAF fires could be
  suppressed; the rAF runs one frame after drag end, so the window is a single
  frame and matches the existing momentum-ownership semantics.
- If a future refactor renames the strategy-native handlers, the setter calls
  move with them; the gate module itself is inert if orphaned.
