# Plan — dictation audio loss: a failing test per defect, then the fix

Dictation deletes speech at four independent points and reports nothing, so every
step below starts by reproducing one deletion as a failing test. Mechanisms and
measurements: `research/2026-09-16-dictation-audio-loss-mechanisms.md`.

Paths are relative to the container repo `~/rambla-work`, holding this plan and the
research. Code and tests live in the `rambla` submodule. The
dictation session (`sherpa-parakeet-realtime-session.ts`) has no test file: one
is created for it, named as upstream would (`sherpa-parakeet-realtime-session.test.ts`);
the other test files exist and steps append to them.

## Merge safety — stated once

Tests go at the end of the existing test file for the module under test; where a
module has none, add one under the name upstream would use. A conflict there is
resolved by keeping both sides and rerere remembers it. The fixes edit upstream
source and are the real conflict surface: keep each edit surgical and on the
file's coldest path, and log every divergence in the ledger (entries under
"Ledger entries" below). Only the workflow is
a new file.

## Working rules

- One defect per step: write the test, watch it fail for the stated reason, fix
  only what it covers. A test that passes when written is not evidence.
  Exception: step 1 is logging-only; verify each message by hand, no test.
- Never relax a threshold for a green run; move it only on a recorded measurement.
- Target what is broken; the same assertions fail if a working path regresses.
- Locally run only the file under test. Whole suites run in CI, never here.
  Typecheck and lint run once, with the change; review reruns the test file only.

## Step 1 — make every discard audible — DONE

Five discard sites in the stream manager now log at warn or error. Committed.

## Step 2 — the whole server pipeline, real engine, before any fix — DONE

`dictation-retention.rambla.e2e.test.ts`. Findings the code cannot tell you:
word retention was 98.6 %, so the server is not where Tom's paragraphs go; the
ending survived, against this plan's prediction; the repetition assertion is red
and a sentence split at a commit boundary is visible in the same transcript; and
no step 1 warning fired, so the seam damage is silent. The retention floor stays
unasserted until there is a post-fix figure.

The CI workflow lands after step 5, not here, so steps 3 to 5 never run under a
red required check. Path-gated to dictation and speech, it restores a cached
models directory, downloads on a miss, and runs the server's test script, which
already collects this file. A missing model fails rather than skips when the
workflow sets its flag, so CI cannot pass without it.

## Step 2b — the app, in a browser, before any fix

Server-side retention is 98.6 %, nowhere near the loss Tom lives with, so the
damage he feels is mostly client-side and no server test will ever see it.
`packages/app/e2e/browser/new-workspace-dictation-submit.spec.ts` already runs
the real app in a real browser with a faked microphone and an intercepted daemon
socket, which means the daemon's replies are ours to choose. Extend that harness
in a new `*.rambla.browser.test.ts`: reply to a finish with a transcript whose
tail is missing, with an empty transcript, and not at all. Assert each case is
surfaced and the audio retained — never a silent success. This is the injection
route for the cut-off-tail symptom, which cannot be reproduced by waiting for it.

Two client defects already have failing unit tests in
`use-dictation.rambla.test.tsx` and belong to this surface: `confirmDictation`
calls its success handler with an empty string when no final sequence exists,
and returns silently when the socket is down. Both are deterministic once
reached; only arriving there is rare.

The truncated final and the missing final are fixed — DONE. A final that stops
at a word boundary the latest partial ran past takes the failure path, and the
finish arms a 10 s reply deadline that `dictation_stream_finish_accepted`
re-arms at the daemon's stated timeout plus a margin. Recorded as ledger
entry 22 (see "Ledger entries" below). The tail-missing and empty-transcript cases of this step are covered;
2c is untouched.

## Step 2c — pencil versus arrow

Tom has lost a dictation on the arrow five or six times in two months and never
on the pencil, at roughly three times the arrow's usage. He rates this as
possibly his own bias: he reaches for the pencil after the arrow has failed.
Both reach the same confirm function; where they diverge before it is unknown
and unexamined. Establish whether the difference is real before treating it as a
clue — an anecdote that survives scrutiny narrows the search, and one that does
not is worth the hour it costs to retire it.

## Step 3 — commit must not ship stale text or delete audio

The dictation session takes its engine as a constructor argument. Build a fake
engine whose decode can be held open, start a decode, append more audio while it
runs, then commit. Assert the committed transcript includes the audio that arrived
during that decode, and that no audio is discarded without appearing in some
transcript. Fails today: the forced decode returns immediately when one is
running, the previous decode's text ships as final, and the buffer is reset.

## Step 4 — a late decode must not land on the next segment — REOPENED 2026-09-18

The closure below is rescinded. The e2e retention test
`packages/server/src/server/dictation/dictation-retention.rambla.e2e.test.ts`
still reproduces the repeated word on post-`eb575472a` code: `expected
[ 'work work' ] to deeply equal []`. The e2e is the controlling evidence; the
closure reasoned from fake-engine schedules while the reproduction was still
failing. Acceptance for this step is that same e2e going green with the
existing unit tests still green.

The superseded closure record follows.

The coder dispatched to this step followed the plan, could not construct the
defect, and stopped per the escape-hatch rule: a test that passes when written
is not evidence. Findings:

- The predicted mechanism (segment id read after the await) is textually
  present in `commit()` and `maybeDecode()`, but unreachable. Step 3's
  `pendingCommitCount` loop plus `maybeDecode`'s singleflight (`decoding` /
  `pendingDecode`, drained inside the active decode's `finally`) means every
  queued decode completes before a commit loop's await resolves, and each loop
  emits + rotates synchronously before yielding. A read-after-await is
  equivalent to a read-before-await in every production-reachable schedule.
- The plan's proposed fix (capture the id before the await) was tried as a
  counterfactual and actively REGRESSES: it produced `"second second"` —
  duplicated text — because `lastPartialText` after a forced decode can
  already reflect the next segment's audio. The post-await read is
  load-bearing.
- An empirical interleaving (two auto-commit-sized chunks, commit #2 queued
  during commit #1's decode, per-chunk distinguishable transcripts) shows
  correct attribution on unmodified code: no cross-segment text, final
  assembled correctly.

Conclusion: step 3's serialization eliminated this defect's window as a side
effect. Mechanism C in `research/2026-09-16-dictation-audio-loss-mechanisms.md`
is closed for the commit path. Reopen paths if repeated words are still observed
on a build containing `eb575472a`: `clear()` rotates the segment id with no
decoding guard (but also wipes `lastPartialText`, so duplication from that path
is not constructible today); the client replay paths (client-audit findings 10
and 11) remain live candidates. The e2e retention test that first caught the
duplicated word should be re-run on a post-`eb575472a` build to confirm the
symptom is gone end to end.

## Step 5 — finishing after real audio must never produce empty text

Drive the stream manager with the same held-open fake session from step 3, so a
commit is in flight when finish arrives; feed it audio, then finish. Assert
the finish never emits an empty transcript when audio was received and no error
occurred, and that a tail shorter than one commit window is committed rather than
cleared. Upstream's manager tests pass on a well-behaved fake; these must not.

## Step 6 — an empty result must not delete the recording

The client discards buffered audio before it checks whether the text is empty.
Drive it through the browser harness that already fakes the microphone and the
daemon socket: reply to the finish with an empty transcript. Assert the audio is
retained and the failed state is entered, which raises the existing toast and
retry control. Cover the two other silent exits too: a finish with no segments,
and a cancel racing a submit.

## Step 7 — capture loss, measured then guarded

Instrument the recorder to report captured audio duration against elapsed wall
clock, and log the gap at warning level when they diverge. Dictate two minutes
while an agent streams output; record the gap. The volume meter updates about
twelve times a second (one callback per 85 ms), so a throttle to ten changes
nothing; the identity churn is the defect. Stop the volume value changing the
audio object's identity: separate the meter state from the controls object, so
volume updates re-render only the meter and the exported controls keep one
identity for the hook's lifetime — this changes the hook's return shape, and
`use-dictation.ts` consumes it. Re-measure the gap afterwards. Acceptance is
one percent, and stays a hand measurement on desktop, where capture loss
happens. Two guards outlive it: the gap warning ships, and a test asserts the
recorder's exported controls keep a stable identity across volume updates.
Missing the one percent target leaves the worklet.

## Ledger entries

The fork ledger entries recorded for this plan, copied in full.

### 10. Dictation: every discard is logged loudly — ACTIVE

Step 1 of `plans/dictation-loss-fix.md`. Logging only; no behavior change.

- **Commit(s):** `3e0b5271f`; stub baselines `3dbbeca43`; test additions
  `9c39411b2`, `3a4f18dc2` (gap warning scope).
- **Files:** `rambla/packages/server/src/server/dictation/dictation-stream-manager.ts`
  (five log sites plus two module-level pure helpers `pcm16SecondsFromBytes` and
  `receivedSeconds`, declared after the `DictationStreamState` interface) and a
  new fork test file
  `rambla/packages/server/src/server/dictation/dictation-discard-logging.rambla.test.ts`.
  Upstream's `dictation-stream-manager.test.ts` is untouched.
- **Why:** upstream throws dictated audio away at debug level or with no log at
  all, and the daemon runs at info, so `daemon.log` holds no dictation lines and
  lost speech cannot be attributed after the fact
  (`research/2026-09-16-dictation-audio-loss-mechanisms.md`).
- **What changed:** silence-only tail clear at finish `debug` → `warn` plus a
  `discardedSeconds` field; dropped abandoned non-final transcripts `debug` →
  `warn`, level only; a new `warn` on the mid-stream auto-commit silence clear,
  which discarded a whole commit window with no log at all; a new `warn` when
  finalization emits an empty final transcript because no segment produced text;
  a new `error` in `failAndCleanupDictationStream` carrying the message and the
  audio received. The two upstream message strings are unchanged, so a text
  conflict there means upstream rewrote the line.
- **How the duration is derived:** the two silence-clear sites report
  `discardedSeconds` from `bytesSinceCommit`, the audio they are about to drop.
  The empty-final warning and the failure error report `receivedSeconds`, all
  audio forwarded to the provider, because in both cases all of it is discarded.
  The dropped-transcripts warning carries no duration: that site deletes text,
  not audio, and any figure there double-counts bytes another warning already
  reported.
- **Rule:** keep fork version; conflicts resolve to ours, taking any upstream
  field additions alongside our level change.
- **Drops when:** upstream logs these five discards at warn/error with a
  duration of its own.

### 14. Dictation: commit during an in-flight decode — ACTIVE

Step 3 of `plans/dictation-loss-fix.md`. Behavior fix, test-first.

- **Commit(s):** `eb575472a`.
- **Files:**
  `rambla/packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts`
  (`commit()` rewritten around a new `pendingCommitCount` field) + tests
  appended to upstream's
  `rambla/packages/server/src/server/dictation/dictation-stream-manager.test.ts`
  (new `FakeParakeetEngine`/`FakeParakeetStream` fakes driving the real
  session; two tests in a "commit during in-flight decode" describe block).
  Patch #15 supersedes the `pendingCommitCount` shape and also edits the
  dictation-stream-manager.
- **Why:** when `commit()` lands while `maybeDecode` is already running,
  upstream's `commit()` awaited `maybeDecode(true)` — which just sets
  `pendingDecode` and returns — then immediately shipped the in-flight
  decode's stale `lastPartialText` as the final transcript and reset
  `pcm16`. Audio appended during the decode never reached any committed
  transcript: the finish-time commit then decoded an empty buffer and the
  tail's partial was dropped as abandoned.
- **What changed:** `commit()` increments `pendingCommitCount` and the async
  body loops — one forced decode per pending commit, each covering the audio
  buffered at that point — before emitting committed+final and rotating the
  segment. A commit during an in-flight decode now waits for that decode,
  then runs its own fresh decode over the audio that arrived meanwhile.
  Buffered audio is only ever cleared after a decode covered it.
- **Rule:** keep fork version; conflicts resolve to ours. Note: two
  upstream tests in this file ("commits tail audio appended while an
  auto-commit is in flight", "waits for an in-flight auto-commit before
  finalizing", "does not wait for an abandoned partial after clearing
  mid-stream silence") fail when `RAMBLA_DICTATION_DEBUG=1` is exported in
  the environment — pre-existing, unrelated to this patch; run the file with
  the variable unset.
- **Drops when:** upstream's `commit()` defers to a queued commit after the
  in-flight decode instead of shipping stale partial text as final.

### 15. Dictation: a window boundary must not cut a word in half — ACTIVE

Step 4 of `plans/dictation-loss-fix.md`. Behavior fix, test-first.

- **Commit(s):** `88942ce63`.
- **Files:**
  `rambla/packages/server/src/server/dictation/dictation-stream-manager.ts`
  (new `findPauseOffset` and `splitChunkAtAutoCommitPause`; the chunk
  forwarding loop handles two parts; `maybeAutoCommitDictationSegment` takes
  an `atPause` argument and defers past the window),
  `rambla/packages/server/src/server/speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts`
  (`commit()` bounds the segment synchronously; `pendingCommitCount` and its
  loop are gone; `decodeNow()` became `decodePcm16(pcm16)`; `maybeDecode`
  captures its segment id before the await), and a new fork test file
  `rambla/packages/server/src/server/dictation/dictation-commit-bounds.rambla.test.ts`.
- **Why:** the auto-commit cut the recording at an exact 15-second mark
  regardless of what was being said. Measured on the real pipeline: segment
  audio [720000, 960000) samples decoded "...We watched them work" and the
  next segment, audio [960000, ...), decoded "work under the floodlights".
  Two disjoint sample ranges, one word straddling the cut, transcribed on
  both sides. Separately, `commit()` read `lastPartialText` and cleared
  `pcm16` only after awaiting decodes that re-read the buffer, so audio
  appended later in the same tick was pulled into the committed transcript —
  which made any attempt to bound a segment from the manager a no-op.
- **What changed:** when the window is due, the arriving chunk is scanned
  forward for 120 ms below the silence peak threshold and split at the middle
  of that pause; the commit fires there. With no pause the window grows to
  15 s + 5 s and then commits wherever it is. `commit()` now takes the
  segment's audio and rotates the segment id synchronously, then decodes that
  snapshot, so the committed transcript covers exactly the audio that existed
  when the manager asked for the commit. A segment can now reach 20 s, which
  lengthens the synchronous decode that blocks the worker thread
  (`issues/012`); the decode cost scales with segment length at a 0.03
  real-time factor, so the worst case moves from about 0.5 s to about 0.7 s.
- **Rule:** keep fork version; conflicts resolve to ours. Supersedes #14's
  `pendingCommitCount`; #14's `RAMBLA_DICTATION_DEBUG=1` caveat still applies
  to the whole dictation test set.
- **Drops when:** upstream commits on a pause rather than on a byte count,
  and bounds a commit to the audio present when it was requested.

### 16. Dictation: an empty transcript after audible speech is a failure — ACTIVE

Step 5 of `plans/dictation-loss-fix.md`. Behavior fix, test-first.

- **Commit(s):** `f8b828c46`.
- **Files:**
  `rambla/packages/server/src/server/dictation/dictation-stream-manager.ts`
  (new `peakOverall` stream field, tracked beside `peakSinceCommit` in the
  chunk forwarding loop, and a new `failEmptyTranscriptAfterSpeech` guard
  called from both empty-text paths of `maybeFinalizeDictationStream`) and a
  new fork test file
  `rambla/packages/server/src/server/dictation/dictation-finish-tail.rambla.test.ts`.
- **Why:** upstream ships `dictation_stream_final` with `text: ""` as an
  ordinary success whenever no segment produced text. The client treats that
  as a successful finish and discards the recording, so a dictation the
  daemon itself judged to be speech — every window it committed was above the
  silence peak threshold — disappears with no error, no toast and no retry.
  Only the no-segments case warned; an assembled text of all-empty segments
  was silent.
- **What changed:** the stream remembers the loudest audio it ever forwarded.
  If the assembled final text is empty and that peak reached the silence
  threshold, the stream fails as retryable
  ("Dictation received audible speech but produced no transcript") instead of
  emitting an empty final, which reuses the existing failure path: error log
  with received duration, debug audio persisted, client enters the failed
  state with its retry control. Whether the client keeps the buffered audio
  on a failure is step 6's work and is not yet done.
  Below the threshold nothing changes — a silence-only
  recording still finishes with an empty transcript, and the finish-time
  silence-tail clear is untouched.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** upstream stops reporting an empty transcript as a
  successful finish.

### 17. Dictation: an empty result keeps the recording and fails visibly — ACTIVE

Step 6 of `plans/dictation-loss-fix.md`. Behavior fix, test-first.

- **Commit(s):** `198c54786`.
- **Files:** `rambla/packages/app/src/hooks/use-dictation.ts`,
  `rambla/packages/app/src/hooks/use-dictation.shared.ts` (one new result
  field), `rambla/packages/app/src/composer/input/input.tsx` (passes it to the
  overlay), `rambla/packages/app/src/components/dictation-controls.tsx` (one
  render condition in `DictationOverlay`), and the fork test files
  `rambla/packages/app/src/hooks/use-dictation.rambla.test.tsx` and
  `rambla/packages/app/src/components/dictation-controls.rambla.test.tsx`.
- **Why:** upstream's `handleStreamingTranscriptionSuccess` sets the status to
  idle and calls `clearStreamingState()` — which empties the sender's segment
  buffer — before it checks whether the transcript is empty, so an empty reply
  deletes the recording and returns with no error, no toast and no retry. Two
  further paths exited the same way: a confirm with no segments yet called the
  success handler with `""`, and a confirm blocked by `canConfirm` (the
  composer passes `client?.isConnected`) returned without touching state, so a
  submit made while the socket was down did nothing at all. Upstream also
  renders the failure overlay's retry button on the failed status alone, while
  `retryFailedDictation` returns without acting or reporting when no audio is
  held.
- **What changed:** the empty check runs first and routes to
  `handleDictationFailure`, so the buffered audio survives; the clear only runs
  on a transcript that has text. `handleDictationFailure` now always sets the
  failed status — it previously fell back to idle when no segments were held,
  which is the state a submit with no segments lands in — while
  `onPermanentFailure` stays gated on segments being present. A blocked
  `canConfirm` stops the microphone and takes the same failure path, reporting
  `common.errors.daemonClientDisconnected`, which is the condition the composer
  gates on and the message `retryFailedDictation` already uses; the empty
  result reuses `common.errors.unexpectedDictationError`. No new translation
  key. `confirmDictation` also refuses a submit while a cancel is in flight,
  the way `startDictation` already does, so a submit chasing a cancel the user
  asked for ends as an ordinary cancel rather than a reported failure. The hook
  exports `canRetryFailedDictation`, written on every entry into the failed
  status from the sender's buffer; the composer passes `onRetry` only when it
  is true and `DictationOverlay` renders the retry button only when it has an
  `onRetry`, so a failure with nothing to retry offers discard alone.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** upstream checks for an empty transcript before it discards
  the buffered audio.

### 22. Dictation: a short final and a silent daemon both fail visibly — ACTIVE

Step 2b of `plans/dictation-loss-fix.md`. Behavior fix, test-first. Builds on
#17's failure path.

- **Commit(s):** `88c1c8bc7` (truncated/unanswered final), `9451c347d`
  (Opus checkpoint regressions; the `4e26e5454` WIP was reverted and redone).
- **Files:** `rambla/packages/app/src/hooks/use-dictation.ts`,
  `rambla/packages/app/src/dictation/dictation-stream-sender.ts` (`finish` takes
  an optional `onFinishSent`), upstream's
  `rambla/packages/app/src/dictation/dictation-stream-sender.test.ts` (the
  delivery-acknowledgement test now pins when that callback fires), and the fork
  test file `rambla/packages/app/src/hooks/use-dictation.rambla.test.tsx`.
- **Why:** upstream's `handleStreamingTranscriptionSuccess` falls back to the
  latest partial only when the final text is empty, so a non-empty final shorter
  than a partial the daemon had already reported was accepted as a complete
  success — the composer got the truncated text and `clearStreamingState()`
  dropped the buffered audio, leaving no retry. Separately, nothing anywhere
  bounded the wait for a reply to `dictation_stream_finish`. The daemon client's
  own guards are a 5-minute fallback after the accept wait expires, so a daemon
  that took the finish and went quiet left the hook in `uploading` with every
  control disabled for minutes.
- **What changed:** the success handler also fails when the trimmed final is a
  strict prefix of the trimmed latest partial at a word boundary — the partial
  starts with the final plus one space — which catches a dropped
  ending without touching a final that is longer, equal, or a corrected
  rewording — punctuation added or changed after the final's last word is not a
  word boundary, so it still succeeds. The comparison only ever reads a partial
  the daemon itself sent. Both cases take the existing `handleDictationFailure`,
  so the audio survives and the retry control appears, and both reuse
  `common.errors.unexpectedDictationError`. No new translation key. For the
  silent daemon, `DictationStreamSender.finish` calls an optional
  `onFinishSent` after the upload drains and before it sends the finish, and the
  hook arms a 10 s timer there — measuring the daemon's silence, not a slow
  upload. A `dictation_stream_finish_accepted` for the open dictation re-arms the
  timer at the daemon's own stated `timeoutMs` plus a 5 s margin. The timer
  rejects a promise raced against the finish, so the timeout lands in the same
  catch as any other finish error. It is cleared on the final, on cancel, and on
  unmount. `retryFailedDictation` shares `ensureFinalTranscript`, so it is
  bounded too.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** upstream bounds the finish wait and stops accepting a final
  that drops an ending it already reported.
