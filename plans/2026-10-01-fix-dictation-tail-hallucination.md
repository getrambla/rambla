# fix: dictation invents a word at the end on submit

Status: approved

## Provenance

- main: `b2df6979b` — 2026-10-01
- upstream-rebrand: `bdc3888cf` — 2026-09-30
- upstream/main: `c481ecf3e` (v0.10.0) — 2026-09-28

## Scope

**In scope:**

1. On submit, Silero VAD checks the leftover tail (audio since the last auto-commit) before it is committed. No speech: the tail is not decoded, and any preview text it showed is erased. Speech: it is committed as today.
2. Dictation reuses the existing speech worker and Silero wrapper over its own worker connection: a new clip-check session kind with a 100 ms confirm window, and a flush the caller can await.
3. In the clip-check kind only, speech still being confirmed when the clip ends counts as speech.
4. Four tail fixtures cut from real recordings.
5. Tests for the approved criteria.

**Not in scope:**

- Checking any segment other than the tail, including mid-recording auto-commits (issue 013).
- Any change in voice chat behavior. Voice chat keeps its "vad" session and 800 ms window, and never flushes.
- Dictation through OpenAI: the tail is committed as today.
- The up-to-50x gain in both Parakeet decode paths.
- Any app or protocol change.
- Running these e2e tests in CI.

## Acceptance criteria

**What the user sees**

1. On submit, a quiet ending with no speech never adds an invented word to the text.
2. A quiet last word the user actually said is kept.
3. The text in the composer has no doubled or missing words where the last two pieces of audio join.

**Robustness**

4. No speech the app sends is thrown away.
5. Older app builds keep working: the messages between daemon and app don't change.

**Tests**

6. Each silent tail is detected as no speech and not decoded.
7. A test runs generated speech with a quiet last word through the real dictation path, and the word survives submit.
8. A dropped no-speech tail is never reported as lost words.

## Goal

Stop Parakeet from inventing a word from a no-speech tail at submit: Silero decides whether the tail holds speech, and a tail with none never reaches the engine's final decode.

## Merge conflict mitigation

**Files this work changes:**

| File                                                                             | Edit                                                                                                                   | Upstream activity           | Tag                 |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------- |
| `packages/server/src/server/dictation/dictation-stream-manager.ts`               | 1 tagged block in the finish branch that holds finalize while the new module checks the tail, then commits or drops it | 20 commits, last 2026-09-14 | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/speech/providers/local/worker-protocol.ts`           | add the clip-check kind to the session kind union                                                                      | 2 commits, last 2026-05-29  | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/speech/providers/local/worker-process.ts`            | the vad branch builds the clip-check kind with a 100 ms confirm window and speech-on-flush on                          | 3 commits, last 2026-09-14  | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/speech/providers/local/worker-client.ts`             | the dictation transcription session can run a clip check over its own client; flush becomes awaitable                  | 5 commits, last 2026-09-14  | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/speech/providers/local/sherpa/silero-vad-session.ts` | a config option, off by default, that reports unconfirmed speech on flush                                              | 8 commits, last 2026-04-24  | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/dictation/dictation-tail-vad.rambla.ts`              | takes the tail's audio since the last commit, runs the clip check at submit, returns keep or drop                      | new                         | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/dictation/dictation-segment-partial.rambla.ts`       | the dropped tail's empty final, if the emit needs it                                                                   | existing                    | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/dictation/dictation-tail-vad.rambla.test.ts`         | fake session: criteria 3, 4, 5, 8, keep and drop paths, non-worker path                                                | new                         | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/dictation/dictation-tail-vad.rambla.e2e.test.ts`     | real worker, Silero, and Parakeet: criteria 1, 2, 6, 7                                                                 | new                         | `RAMBLA-FORK: fix:` |
| `packages/server/src/server/dictation/fixtures/silent-tail-mm.wav`               | "Mm." tail                                                                                                             | new                         | none                |
| `packages/server/src/server/dictation/fixtures/silent-tail-yeah.wav`             | "Yeah." tail                                                                                                           | new                         | none                |
| `packages/server/src/server/dictation/fixtures/silent-tail-mm-hmm.wav`           | "Mm-hmm." tail                                                                                                         | new                         | none                |
| `packages/server/src/server/dictation/fixtures/silent-tail-yeah-loud.wav`        | second "Yeah." tail, peak 4253                                                                                         | new                         | none                |

**Why this shape:** the user chose to reuse the existing worker and Silero wrapper over a second worker or a new request type, so no Silero handling, worker lifecycle, or crash handling is duplicated. The confirm window is already a session option ([silero-vad-session.ts:19](../packages/server/src/server/speech/providers/local/sherpa/silero-vad-session.ts#L19)); a separate session kind keeps voice chat's 800 ms window. The user chose to reach the check through dictation's own worker connection ([worker-client.ts:633](../packages/server/src/server/speech/providers/local/worker-client.ts#L633)), so it works whatever voice chat is set to and no voice chat or setup file changes. The manager already keeps every forwarded chunk ([dictation-stream-manager.ts:499](../packages/server/src/server/dictation/dictation-stream-manager.ts#L499)) and the tail's length ([dictation-stream-manager.ts:500](../packages/server/src/server/dictation/dictation-stream-manager.ts#L500)), so the chunk path is untouched. The drop sits where upstream still drops silent tails, which the fork removed in `b517a6e24`. When the session is not a local worker session, finish behaves as today, so upstream's manager tests, which use fake sessions, do not change.

## Cause

At submit, the manager commits whatever arrived since the last auto-commit as its own segment ([dictation-stream-manager.ts:834](../packages/server/src/server/dictation/dictation-stream-manager.ts#L834)). The session decodes that buffer alone ([sherpa-parakeet-realtime-session.ts:57](../packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts#L57)) and boosts a quiet buffer up to 50x first ([sherpa-parakeet-realtime-session.ts:158](../packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts#L158)). Parakeet reads the boosted tail as a filler word. Replays reproduced this on four recordings, with tails of 0.196 s, 0.727 s, 0.379 s, and 0.908 s. Decoding the tails with no gain still gave "Mm.", "Okay.", "Okay.", and "Yeah.", and the peak-under-300 floor in voice chat's Parakeet class ([sherpa-parakeet-stt.ts:129](../packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-stt.ts#L129)) missed the loud tail and lost real speech at peak 150. Silero found no speech in any of the 4 tails and found speech in a real speech clip scaled down to peak 60.

## Constraints

- Only the tail at submit is checked. Auto-commits are untouched.
- When the dictation session is not a local worker session (OpenAI, test fakes): finish behaves exactly as today.
- Voice chat's "vad" session keeps its 800 ms window, discards unconfirmed speech on flush, and keeps every current behavior.
- While the check runs, finalize must not run and a second seal must not start ([dictation-stream-manager.ts:830](../packages/server/src/server/dictation/dictation-stream-manager.ts#L830), [dictation-stream-manager.ts:918](../packages/server/src/server/dictation/dictation-stream-manager.ts#L918)).
- When the tail is dropped, it is cleared from the engine session, the way upstream still clears silent tails and the fork stopped doing in `b517a6e24`. Its preview segment ends with an empty final, which the app removes from the field ([dictation-transaction.rambla.ts:258](../packages/app/src/composer/input/dictation-transaction.rambla.ts#L258)).
- No loudness threshold decides the drop. Only Silero does.
- No change to `packages/protocol`, `packages/app`, `turn-detection-provider.ts`, `speech-provider.ts`, voice chat files, or either Parakeet session. If an interface must change, stop and report.
- No upstream test may change. If one fails, stop and report.

## Steps

0. Read the `code` skill before writing anything. If a step below turns out to be wrong, stop and report back to the supervisor. Do not amend this plan, and do not re-decide placement while coding.
   **Acceptance criteria**: none. This step writes nothing.
1. Clip check in the worker. Add the clip-check session kind ([worker-protocol.ts:17](../packages/server/src/server/speech/providers/local/worker-protocol.ts#L17)), build it with a 100 ms confirm window in the worker's vad branch ([worker-process.ts:201](../packages/server/src/server/speech/providers/local/worker-process.ts#L201)), let the dictation transcription session run a clip check over its own client and make flush awaitable ([worker-client.ts:269](../packages/server/src/server/speech/providers/local/worker-client.ts#L269)), and add the off-by-default option that reports unconfirmed speech on flush ([silero-vad-session.ts:172](../packages/server/src/server/speech/providers/local/sherpa/silero-vad-session.ts#L172)). Test first, in the e2e file, against the real worker.
   **Acceptance criteria**: each of the 4 tail fixtures, fed to a clip-check session and flushed, reports no speech; generated speech, including a short word at the very end of the clip, reports speech; a "vad" session still discards unconfirmed speech on flush (criterion 6).
2. Drop no-speech tails at submit. Cut the 4 tails from the end of each recording's `combined.wav` (16 kHz PCM16 mono): "Mm." from 19.004 s, "Yeah." from 15.060 s, "Mm-hmm." from 176.720 s, loud "Yeah." from 77.620 s. The supervisor gives you the recording paths. Write the tests first, then the tail module and the manager block. Generate speech the way [dictation-retention.rambla.e2e.test.ts:93](../packages/server/src/server/dictation/dictation-retention.rambla.e2e.test.ts#L93) does, and skip when models are missing the same way. Tag every upstream edit in both steps `RAMBLA-FORK: fix: 2026-10-01-fix-dictation-tail-hallucination.md: <clause>`. The user tries live dictation on a build before the plan is done.
   **Acceptance criteria**: 1-8.

## Verification

- `npm run typecheck`
- `npm run lint`
- `npx vitest run packages/server/src/server/dictation/dictation-tail-vad.rambla.test.ts --bail=1`
- Each e2e file, one at a time: `systemd-run --user --scope -p MemoryMax=4G -p MemorySwapMax=0 npx vitest run <file> --bail=1` for `dictation-tail-vad.rambla.e2e.test.ts`, `dictation-room-noise.rambla.e2e.test.ts`, and `dictation-retention.rambla.e2e.test.ts`.
- `git grep "RAMBLA-FORK:" --` each of the 5 upstream files edited. Every one must show a tag.
- The user dictates past one auto-commit, stays silent briefly, submits, and sees no invented ending.

## Risks

- Whether sherpa's own flush reports a word at the very end of a clip was not run; step 1's criteria test it.
- The worker handles one request at a time, so the check may wait behind a Parakeet decode. Finish already waits for that decode.
- `dropUncommittedNonFinalTranscripts` ([dictation-stream-manager.ts:850](../packages/server/src/server/dictation/dictation-stream-manager.ts#L850)) may report the dropped tail's preview text as `droppedTranscript`.
- The manager reports an empty transcript after speech as a failure ([dictation-stream-manager.ts:888](../packages/server/src/server/dictation/dictation-stream-manager.ts#L888)). A dropped tail must not trigger it.
