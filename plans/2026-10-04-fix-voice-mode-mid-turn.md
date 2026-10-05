# fix: start voice mode while an agent is running

Status: approved

## Provenance

- main: `7c8c57485` — 2026-10-04
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Goal

Let the user start realtime voice mode mid-turn. Clicking the voice mode button or pressing the voice-toggle shortcut cancels the running turn and turns voice mode on.

## Scope

**In scope:**

1. Show the voice mode button while the agent is running.
2. Remove the "interrupt the agent before starting voice mode" toast and its guard from the voice-toggle shortcut path.

**Not in scope:**

- Deferring the turn cancel until the user speaks (server-side reload timing).
- Barge-in not stopping the agent's speech playback.
- Spoken replies appearing and then disappearing from the chat.
- A user preference for interrupt behavior.
- Upstream's `packages/app/src/composer/input/input.tsx`. It is not rendered, and it keeps its own copy of the guard.
- The `composer.voice.interruptBeforeVoice` locale strings. Upstream's `input.tsx` still uses them, and [resources.test.ts:107](../packages/app/src/i18n/resources.test.ts#L107) requires key parity across all 9 locales.
- Any server change.

## Acceptance criteria

1. While an agent is running, the voice mode button shows next to send.
2. Clicking the voice mode button mid-turn stops the turn and turns voice mode on.
3. The voice-toggle shortcut (`Cmd+Shift+D` on macOS) mid-turn stops the turn and turns voice mode on.
4. The "Interrupt the agent before starting voice mode" toast is removed and never appears.
5. Starting voice mode on an idle agent, and stopping voice mode, behave as before.
6. On a compact layout, the voice mode button still hides while the composer has sendable content.

## Merge conflict mitigation

**Files this work changes:**

| File                                               | Edit                                                                                    | Upstream activity                                         | Tag                                                    |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| `packages/app/src/composer/index.tsx`              | remove the `isAgentRunning` prop from the voice mode slot, in place, in 2 tagged blocks | last touched 2026-10-01 (`3fd466490`), 62 commits in 2026 | `RAMBLA-FORK: fix:`                                    |
| `packages/app/src/composer/input/input.rambla.tsx` | delete the running-agent guard and the context fields and arguments only it uses        | existing                                                  | `RAMBLA-FORK: fix:` (1, above the first changed block) |

**Why this shape:** both edits only delete lines, so editing in place touches the fewest upstream lines. A helper would add an import and a call site to `index.tsx` without shrinking the change. `input.rambla.tsx` is ours (header at [input.rambla.tsx:1](../packages/app/src/composer/input/input.rambla.tsx#L1), no history on `upstream-rebrand`), so it gets 1 tag above its first changed block and no per-block tags.

## Cause

`ComposerRightControlsSlot` hides the voice mode button whenever the agent is running ([index.tsx:1176](../packages/app/src/composer/index.tsx#L1176)). This check came from upstream commit `501dcf373`, "Hide voice mode while agents run". The shortcut path reaches `toggleRealtimeVoiceImpl`, which shows the toast and returns early when the agent is running ([input.rambla.tsx:870](../packages/app/src/composer/input/input.rambla.tsx#L870)). That guard was copied from upstream's `input.tsx` when the file was forked. Nothing on the server refuses voice mode mid-turn: enabling it reloads the agent session, and the reload already cancels the in-flight run first ([agent-manager.ts:1515](../packages/server/src/server/agent/agent-manager.ts#L1515)).

## Constraints

- In `index.tsx`, change only 2 blocks. Block 1 is `ComposerRightControlsSlot`: its props interface, destructure, and visibility condition ([index.tsx:1157](../packages/app/src/composer/index.tsx#L1157)). Block 2 is its call site and memo dependency in `rightContent` ([index.tsx:2038](../packages/app/src/composer/index.tsx#L2038)). Each block gets one fork tag.
- Keep the compact-layout, existing-voice-mode, `hasAgent`, and `showVoice` conditions.
- Do not edit `input.tsx`, locale files, server code, or any upstream test.
- Add exactly 1 fork tag in `input.rambla.tsx`, on the line above the first changed block.
- Add no new options, settings, or confirmation prompts.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor. Do not amend this plan, and do not re-decide placement while coding.

Single work item:

- In `packages/app/src/composer/index.tsx`, remove the running-agent condition from the voice mode button's visibility. Also remove the `isAgentRunning` prop it leaves unused, from the slot's props and from its call site. Tag both blocks `// RAMBLA-FORK: fix: 2026-10-04-fix-voice-mode-mid-turn.md: shows voice mode while the agent runs.`
- In `packages/app/src/composer/input/input.rambla.tsx`, delete the running-agent guard in `toggleRealtimeVoiceImpl`. Also delete the context fields, call-site arguments, and dependency entries that existed only for that guard. Put `// RAMBLA-FORK: fix: 2026-10-04-fix-voice-mode-mid-turn.md: lets voice mode start while the agent runs.` above the first changed block only.
- The user tests the desktop dev build before the plan is marked `done`.

**Acceptance criteria:** plan-level criteria 1–6.

## Verification

- `npm run typecheck`
- `npm run lint`
- `git grep "RAMBLA-FORK:" -- packages/app/src/composer/index.tsx packages/app/src/composer/input/input.rambla.tsx` — 2 new tags in `index.tsx`, 1 in `input.rambla.tsx`.
- In the desktop dev build (`npm run dev:desktop`), with an agent mid-turn:
  - The voice mode button is visible.
  - Clicking it cancels the turn and shows the realtime voice overlay.
  - The voice-toggle shortcut does the same, with no toast.
- Repeat on an idle agent, and stop voice mode, to confirm criterion 5.
- At a compact window width, type text and confirm the button hides (criterion 6).

## Risks

- Starting voice mode mid-turn discards the in-progress turn. This is intended.
- Upstream's `input.tsx` keeps the guard. A future port of upstream changes into `input.rambla.tsx` must not reintroduce it.
- `origin/upstream-rebrand` (`194d33ffb`, 2026-10-02) has upstream changes to `index.tsx` that main hasn't merged yet. None of its hunks touch either edit block.
