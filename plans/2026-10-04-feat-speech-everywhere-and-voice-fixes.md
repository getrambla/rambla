# feat: speech output everywhere, and voice mode fixes

Status: unapproved

## Provenance

- main: `a304fc676` — 2026-10-04
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Goal

Make spoken interaction usable day to day. Voice mode can start mid-turn, long utterances are no longer dropped, spoken replies stay selectable and in the chat, and the speak tool works in every session without voice mode.

## Scope

**In scope:**

1. Starting voice mode while the agent runs, from the button and the voice-toggle shortcut. The "interrupt the agent first" toast is removed.
2. A temporary test toggle that shows the voice mode button on compact layouts that have text.
3. Raising the voice final-transcript timeout to 60 seconds, and making the local Parakeet decode asynchronous. That decode also serves the worker's one-shot `stt.transcribe` request ([worker-process.ts:295](../packages/server/src/server/speech/providers/local/worker-process.ts#L295)), which gains the same non-blocking behavior.
4. Making spoken-reply text selectable.
5. Keeping spoken replies in the chat when a late tool result arrives without the original tool metadata.
6. Making the speak tool available in every session, with a fallback handler that plays on the most recently active client when voice mode is off.
7. Auto-approving speak daemon-wide, whether or not a client is connected.
8. Fixing speak calls that play nothing after a voice abort.
9. Replacing the speak tool description with the approved usage rule.
10. A 60-second playback-confirmation timeout per speech chunk, for every speak path.

**Not in scope:**

- Deferring the voice-mode session reload, and the voice system prompt (both unchanged).
- Per-session or per-message speech preferences, and a settings UI.
- Dictation's realtime session decode (`sherpa-parakeet-realtime-session.ts`), and dictation timeouts.
- Durable on-disk agent timelines.
- Sending composer draft text along with speech.
- Upstream's unrendered `input.tsx`, and the `interruptBeforeVoice` locale strings.
- Speak-tool behavior in providers other than those that already expose it.
- A replay or read-aloud control on chat messages, and an option to hide spoken replies.

## Acceptance criteria

1. While an agent is running, the voice mode button shows next to send.
2. Clicking the voice mode button mid-turn stops the turn and turns voice mode on.
3. The voice-toggle shortcut (`Cmd+Shift+D` on macOS) mid-turn stops the turn and turns voice mode on.
4. The "Interrupt the agent before starting voice mode" toast is removed and never appears.
5. Starting voice mode on an idle agent, and stopping it, behave as before.
6. Temporarily, for testing, the voice mode button also shows on a compact layout while the composer has text, and the typed text is kept. After testing, the user either keeps this or restores the upstream hide.
7. In voice mode, a final transcript that arrives up to 60 seconds after the user stops speaking reaches the agent instead of being dropped.
8. Voice-mode transcription does not block the local speech worker: speech playback and speech detection keep running during it.
9. Spoken-reply text in the chat can be selected like other messages.
10. Without voice mode, in a session started after this ships, asking the agent to speak its answer plays it aloud in the app.
11. Without voice mode, speech plays on the client with the most recent activity.
12. A speak call never reaches any app as a permission prompt, pending permission, or attention notification. The daemon approves it automatically before anything else sees it.
13. If no app is connected, speak returns an error right away. Otherwise, each chunk of speech must be confirmed as played within 60 seconds of being sent, or speak returns an error. A long reply that keeps playing never times out.
14. After the user interrupts a spoken reply by talking, the next spoken reply plays.
15. Voice mode as a whole (listening, spoken replies, stopping) works as before.
16. Spoken replies stay in the chat with their text after playback, including when the user interrupts. A late or interrupted tool result never replaces a row's tool name or input with placeholders.
17. The speak tool's description tells agents to speak only for spoken-input messages or when the user asked for spoken replies, to keep spoken replies short and conversational, and otherwise to reply normally per the user's stated preferences.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                                    | Edit                                                                                                                                                             | Upstream activity               | Tag                                      |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------- |
| `packages/app/src/composer/index.tsx`                                                   | drop `isAgentRunning` from the voice mode slot; short-circuit the compact hide; 2 blocks                                                                         | 2026-10-01, 62 commits in 2026  | `RAMBLA-FORK: feature:`                  |
| `packages/app/src/composer/input/input.rambla.tsx`                                      | delete the running-agent guard and the fields only it uses                                                                                                       | existing                        | `RAMBLA-FORK: feature:` (1, first block) |
| `packages/server/src/server/session/voice/voice-turn-controller.ts`                     | timeout constant 10s to 60s                                                                                                                                      | 2026-06-21, 1 commit in 2026    | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/session/voice/voice-turn-controller.test.ts`                | timer advances that assume 10s                                                                                                                                   | 2026-06-21, 1 commit in 2026    | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/session/voice/voice-session.test.ts`                        | timer advance that assumes 10s                                                                                                                                   | 2026-09-16, 3 commits in 2026   | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-stt.ts`       | synchronous decode to the async decode                                                                                                                           | 2026-04-24, 5 commits in 2026   | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/speech/providers/local/sherpa/sherpa-offline-recognizer.ts` | declare the async decode on the native recognizer type                                                                                                           | 2026-04-24, 4 commits in 2026   | `RAMBLA-FORK: feature:`                  |
| `packages/app/src/components/message.tsx`                                               | make the speak text selectable                                                                                                                                   | 2026-09-21, 180 commits in 2026 | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/agent/timeline-projection.ts`                               | merge keeps an existing name and input over placeholders                                                                                                         | 2026-09-21, 17 commits in 2026  | `RAMBLA-FORK: feature:`                  |
| `packages/app/src/types/stream.ts`                                                      | merge keeps an existing name over the placeholder name (input is already kept)                                                                                   | 2026-09-21, 70 commits in 2026  | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/bootstrap.ts`                                               | turn on voice tools for agent-scoped catalogs only (those with a caller agent id)                                                                                | 2026-10-01, 219 commits in 2026 | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/agent/tools/rambla-tools.ts`                                | replace the speak tool description                                                                                                                               | 2026-10-01, 4 commits in 2026   | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/websocket-server.ts`                                        | fall back to the speak router when no voice handler exists; wire it to sockets                                                                                   | 2026-10-01, 228 commits in 2026 | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/session.ts`                                                 | offer each `audio_played` to the router first; delete the voice-only speak auto-allow block                                                                      | 2026-10-01, 516 commits in 2026 | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/session/voice/voice-session.ts`                             | speak handler uses a signal that a past abort cannot pre-cancel                                                                                                  | 2026-09-21, 7 commits in 2026   | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/agent/agent-manager.ts`                                     | auto-allow live speak permission requests where every request lands                                                                                              | 2026-10-01, 206 commits in 2026 | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/agent/tts-manager.ts`                                       | per-chunk 60-second playback-confirmation timeout that rejects with an error                                                                                     | 2026-05-05, 13 commits in 2026  | `RAMBLA-FORK: feature:`                  |
| `packages/server/src/server/agent/tts-manager.rambla.test.ts`                           | covers the chunk-timeout half of criterion 13                                                                                                                    | new                             | `RAMBLA-FORK: feature:` (1, top)         |
| `packages/server/src/server/speak-router.rambla.ts`                                     | fallback speak handler: picks the client, plays non-voice audio, awaits confirmation with timeout                                                                | new                             | `RAMBLA-FORK: feature:` (1, top)         |
| `packages/server/src/server/speak-router.rambla.test.ts`                                | covers criteria 11 and the no-client half of 13                                                                                                                  | new                             | `RAMBLA-FORK: feature:` (1, top)         |
| `packages/server/src/server/agent/agent-manager.speak-approval.rambla.test.ts`          | covers criterion 12: a live speak request is answered and never stored as pending, broadcast as attention, or dispatched, and its resolution is never dispatched | new                             | `RAMBLA-FORK: feature:` (1, top)         |
| `packages/server/src/server/agent/timeline-projection.rambla.test.ts`                   | covers the server half of criterion 16                                                                                                                           | new                             | `RAMBLA-FORK: feature:` (1, top)         |
| `packages/app/src/types/stream.rambla.test.ts`                                          | covers the app half of criterion 16                                                                                                                              | new                             | `RAMBLA-FORK: feature:` (1, top)         |

**Why this shape:** each upstream edit is a deletion, a constant, or a guard of a few lines, so it is edited in place and tagged. The fallback speak handler has no upstream counterpart, so it lives in a new `.rambla.` module that upstream reaches through one-call hooks. The upstream tests change only where they hard-code the old 10-second timeout, with your permission.

## Cause

- The voice mode button is hidden while the agent runs ([index.tsx:1176](../packages/app/src/composer/index.tsx#L1176)). The shortcut toasts and returns ([input.rambla.tsx:870](../packages/app/src/composer/input/input.rambla.tsx#L870)). The server already cancels the run on reload ([agent-manager.ts:1515](../packages/server/src/server/agent/agent-manager.ts#L1515)).
- Voice turns give up 10 seconds after speech stops ([voice-turn-controller.ts:14](../packages/server/src/server/session/voice/voice-turn-controller.ts#L14)) and drop late finals ([voice-turn-controller.ts:270](../packages/server/src/server/session/voice/voice-turn-controller.ts#L270)). The voice decode is synchronous and blocks the shared worker ([sherpa-parakeet-stt.ts:152](../packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-stt.ts#L152)).
- The speak text has no `selectable` ([message.tsx:2075](../packages/app/src/components/message.tsx#L2075)).
- A tool result with no cached call gets the name `"tool"` and a null input ([agent.ts:5234](../packages/server/src/server/agent/providers/claude/agent.ts#L5234)). The server merge lets both overwrite the row ([timeline-projection.ts:97](../packages/server/src/server/agent/timeline-projection.ts#L97)); the app merge keeps the input but takes the name ([stream.ts:1170](../packages/app/src/types/stream.ts#L1170)). Either way the row stops matching `speak`. This lines up in time with voice aborts in the log, but it was not reproduced.
- Speak works only while voice mode registers a handler ([rambla-tools.ts:1211](../packages/server/src/server/agent/tools/rambla-tools.ts#L1211), [websocket-server.ts:2009](../packages/server/src/server/websocket-server.ts#L2009)). The tool is gated on a flag that nothing sets ([bootstrap.ts:1427](../packages/server/src/server/bootstrap.ts#L1427)). Auto-approval runs only inside a connected client's session while voice mode is active ([session.ts:1920](../packages/server/src/server/session.ts#L1920)), while every permission request passes through the agent manager ([agent-manager.ts:4592](../packages/server/src/server/agent/agent-manager.ts#L4592)).
- After an abort, the speak handler's controller stays aborted until the next transcript ([voice-session.ts:998](../packages/server/src/server/session/voice/voice-session.ts#L998)).

## Constraints

- No file outside the table changes.
- Voice mode's handler wins whenever it is registered; the router only fills a miss. Voice-mode audio payloads keep `isVoiceMode: true`, and router payloads use `false`.
- The router delivers `audio_output` through the WebSocket server's direct per-socket send ([websocket-server.ts:1142](../packages/server/src/server/websocket-server.ts#L1142)). Session publishing drops `audio_output`.
- The per-chunk timeout lives in `TTSManager`, so voice mode and the router share it. A barge-in or abort still stops speech that is already playing.
- Neither an auto-approved speak request nor its resolution reaches any client.
- The router claims only `audio_played` ids it issued. Every other confirmation continues to the voice path unchanged.
- Speak auto-approval covers only live requests whose tool name passes the existing speak policy ([voice-permission-policy.ts:5](../packages/server/src/server/voice-permission-policy.ts#L5)), never replayed history.
- "Most recent activity" means the existing per-socket `lastActivityAt` ([session.ts:658](../packages/server/src/server/session.ts#L658)). Do not add new client tracking.
- The compact test toggle leaves the original condition text intact and is reverted by deleting the short-circuit alone. If lint rejects the form, stop and report.
- The voice system prompt and the session reload stay unchanged.
- The speak tool description becomes exactly the approved text below, with no other wording:

  > Speak text aloud to the user. Use it only when (1) the user's message is wrapped in `<spoken-input>`, meaning they spoke it in voice chat, or (2) the user asked for spoken replies, in this conversation or in their standing instructions. That lasts until they say stop. Otherwise reply normally, following any preference the user has stated. Keep spoken text short and conversational, with no tables, code, or URLs. The user can always ask for written detail.

- No settings, options, or UI beyond the table.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor. Do not amend this plan, and do not re-decide placement while coding. Every tag uses `2026-10-04-feat-speech-everywhere-and-voice-fixes.md`.

   **Acceptance criteria**: no edit lands before the `code` skill is read, and every tag names this plan file.

1. **Voice mode mid-turn.** Change `index.tsx` and `input.rambla.tsx`. In `index.tsx`, block 1 is `ComposerRightControlsSlot`: drop the running condition and the unused prop, and short-circuit the compact hide with a tag that marks it a temporary test toggle. Block 2 is the slot's call site in `rightContent`. In `input.rambla.tsx`, delete the guard and its fields, with 1 tag above the first changed block.

   **Acceptance criteria**: 1–6. The user tests this step's build on desktop and phone, and decides on criterion 6, before step 4 ships.

2. **Dropped speech.** Raise the timeout constant to 60 seconds. Update the hard-coded 10-second advances in the two upstream test files. Switch the decode in `sherpa-parakeet-stt.ts` to the library's async decode, and declare it on the native recognizer type in `sherpa-offline-recognizer.ts`.

   **Acceptance criteria**: 7, 8. Upstream timeout tests pass at 60 seconds. The user tries a long utterance in voice mode before step 3.

3. **Chat display.** Make the speak text selectable. Add the placeholder guard to the server merge (name and input) and the app merge (name), with new `.rambla.test.ts` files proving a late result with the placeholder name and a null input leaves the speak row's name and text intact on both sides.

   **Acceptance criteria**: 9, 16.

4. **Speak everywhere.** Turn on voice tools at the bootstrap site, for agent-scoped catalogs only. Create `speak-router.rambla.ts`, and hook it into `resolveVoiceSpeakHandler`, socket lifecycle, and `audio_played` (session.ts offers each confirmation to the router first). Move speak auto-approval into the agent manager's permission handler for live requests: it responds before the request is stored as pending, broadcast as attention, or dispatched to clients. The matching `permission_resolved` is also kept from clients on both of its dispatch paths ([agent-manager.ts:2997](../packages/server/src/server/agent/agent-manager.ts#L2997), [agent-manager.ts:4606](../packages/server/src/server/agent/agent-manager.ts#L4606)). Delete session.ts's voice-only block so each request gets exactly one response. Replace the speak tool description. Give the voice speak handler an unaborted signal per call. Add the per-chunk confirmation timeout in `TTSManager`.

   **Acceptance criteria**: 10–15 and 17, with 11 and the no-client half of 13 covered by `speak-router.rambla.test.ts`, the chunk timeout half of 13 by `tts-manager.rambla.test.ts`, and 12 by `agent-manager.speak-approval.rambla.test.ts`. The user reviews this step on desktop and phone before the plan is `done`.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/speak-router.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/agent/tts-manager.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/agent/agent-manager.speak-approval.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/agent/timeline-projection.rambla.test.ts --bail=1`
- `npx vitest run packages/app/src/types/stream.rambla.test.ts --bail=1`
- `npx vitest run packages/server/src/server/session/voice/voice-turn-controller.test.ts --bail=1`
- `npx vitest run packages/server/src/server/session/voice/voice-session.test.ts --bail=1`
- `git grep "RAMBLA-FORK:" --` each edited upstream file shows a tag per changed block.
- Desktop dev build, and a TestFlight build per the `code` skill: criteria 1–6 and 9, a long voice utterance (7), speech playing while transcribing (8), "speak your answer" without voice mode on each device (10, 11), and interrupting then speaking again (14, 16).

## Risks

- Speak calls from agents that never asked for speech now play aloud. Mitigation: none beyond the agent's own judgment; preferences are out of scope.
- Sessions already open when this ships may not list the tool until restarted (unverified for Clem).
- The criterion 16 cause was inferred from timing, not reproduced. If the guard does not stop the disappearance, report back with a reproduction.
- Native clients update `lastActivityAt` only on foreground or agent focus, so a phone in hand but idle may lose to the desktop.
- `origin/upstream-rebrand` (`194d33ffb`) is ahead of main's merge base. It has unmerged changes in `index.tsx`, `bootstrap.ts`, `session.ts`, `websocket-server.ts`, `agent-manager.ts`, and `rambla-tools.ts`. None of their hunks touch this plan's edit sites.
