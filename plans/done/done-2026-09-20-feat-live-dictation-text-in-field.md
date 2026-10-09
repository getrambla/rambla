# Plan — dictated words appear in the composer field as the user speaks

Dictated words land in the composer field while the user speaks, and the field stays editable throughout.

## Rules (each gets its own test)

1. Dictation starts at the cursor, wherever it is.
2. Typing before or after the pending region is never swallowed or overwritten; the region shifts by the length the user inserted or deleted.
3. Editing inside a segment freezes that segment's text up to the end of the edit; the engine's later words still append after the frozen part, and no later message rewrites or deletes it.
4. Moving the cursor without editing re-anchors nothing.
5. Stopping while text is pending keeps that text as-is.
6. An empty or missing final leaves the field's text alone.
7. Cancel and discard stop the recording and delete nothing.
8. A retry or a reconnect clears the whole dictated region and rebuilds it, and edits made before it are lost. Both re-send the entire recording, so the daemon re-transcribes everything under new ids and anything kept would duplicate.
9. Within one stream, a segment marked final is never rewritten, deleted, or resent.
10. Submit while recording stops dictation, waits for the final, then sends the field's text.
11. Segments sit in the daemon's order, not the order they arrived.

## Contract (verified in code, do not re-derive)

Evidence and measurements are in `research/2026-09-20-dictation-segments-verification.md`, `-android-text-write-drop.md`, `-web-undo-preserving-write.md`, and `-segment-boundary-options.md`.

- Everything below about segment behavior is the local sherpa provider only, and this feature is scoped to it. `providers/openai/stt.ts` buffers in `appendPcm16` and emits solely from `commit()`, always `isFinal: true` — it produces no partials at all, so live text as you speak is impossible there. It also emits `committed` synchronously before transcribing and rotates its id in an async `finally`, so neither ordering fact below transfers.
- One segment is live at a time; `commit()` in `sherpa-parakeet-realtime-session.ts` rotates `currentSegmentId` synchronously and is the only emitter for an old id. Nothing re-emits or revises a committed id, and sherpa never abandons one — so the client never deletes. `dropUncommittedNonFinalTranscripts` and `transcriptsMissingFrom` in `dictation-stream-manager.ts` exist for providers that do abandon by re-cutting audio under a new id; scoping to sherpa is what makes the no-delete rule safe.
- `commit()` emits its final only after an await, and its decode covers the whole segment while the next segment's first decode covers a fraction of a second. A final can therefore arrive after a later segment's partial. Order comes from the daemon, never from arrival.
- `committedSegmentIds` cannot supply that order. The session emits `committed` inside the same async block, after the decode, so while segment N decodes, N+1's partials compute the same position N has yet to claim. The order number has to be assigned at the cut, which is synchronous.
- `decodePcm16` re-reads the entire accumulated buffer each time, so the live segment can re-word anywhere within itself, not only at its tail.
- The cut is the daemon's: `DEFAULT_DICTATION_AUTO_COMMIT_SECONDS = 15`, extended up to `DICTATION_AUTO_COMMIT_MAX_EXTRA_SECONDS = 5` waiting for a pause.
- Retry and reconnect are the same operation. In `packages/app/src/dictation/dictation-stream-sender.ts`, `segments` holds every chunk since the dictation began and only `clearAll()` empties it; `restartStream` (reconnect) and `resetStreamForReplay` (retry, via `retryFailedDictation`) both set `sendSeq = 0` and leave it intact. Either one re-sends the entire recording, and the daemon re-transcribes all of it under new ids.
- `TextInput` carries `editable={!isDictating && ...}` and `DictationOverlay` covers the composer while recording, so typing during dictation is impossible today.
- `replaceText` in `input.tsx` does not call `handleInputChange`; user edits are exactly the `handleInputChange` calls.
- Keep the existing web write. `packages/app/src/components/ui/text-input/text-input.web.tsx` assigns `input.value`, which stays out of the undo stack and leaves the user's own entries intact. `document.execCommand("insertText")` wipes the field on one undo and fires `onChangeText`, which would make the composer read its own write as a user edit.
- On Android the write is gated by `canUpdateWithEventCount(eventCounter) = eventCounter >= nativeEventCount` in React Native's `ReactEditText`, so a keystroke racing the write drops it with no error.

## Steps

Every step writes its failing test first and watches it fail before the implementation, per `docs/testing.md`.

1. **Protocol and daemon.** New `packages/protocol/src/dictation-segment.rambla.ts` owns `DictationSegmentSchema` (`{ id, index, text, isFinal }`) and the inferred `DictationSegment`. `packages/protocol/src/messages.ts` takes two lines: the import at the end of its import block, and `segment: DictationSegmentSchema.optional()` inside `DictationStreamPartialMessageSchema`'s payload, COMPAT-tagged per `docs/protocol-compatibility.md`. The partial's `text` stays required and carries the empty string when `segment` is present; making it optional would widen the type for every existing reader of `message.payload.text`, and only a client that advertised the cap ever sees the empty value. One segment per message — never a list, since only one is ever in motion. `index` is assigned by the session, not derived from `committedSegmentIds`. `packages/server/src/server/speech/speech-provider.ts` gets one line, `index?: number` on `StreamingTranscriptionEvent` — optional so upstream's fake sessions compile unchanged. `sherpa-parakeet-realtime-session.ts` gets a counter that starts at 0 in `connect()` and increments in `commit()` and `clear()`, each rotation capturing the outgoing segment's index in the same synchronous block that captures its id. `providers/openai/stt.ts` is not touched: it emits no partials, so it has nothing live to number, and the manager omits `segment` when an event carries no index, which leaves that provider on today's behavior with no branch of its own. Add `dictationSegments: "dictation_segments"` to `CLIENT_CAPS` in `packages/protocol/src/client-capabilities.ts` and one matching optional boolean to the `capabilities` schema in `messages.ts`, both COMPAT-tagged, and advertise it from `appCapabilities` in `packages/app/src/runtime/host-runtime.ts` — one line each. In `packages/server/src/server/dictation/dictation-stream-manager.ts`, when the client advertises the cap, the `transcript` handler sends the reporting segment alone with its `isFinal` flag and an empty glued `text`; it stops gluing and stops resending settled segments. The final message is unchanged and carries no segments — every word already reached the client, the last one marked final by the finish commit. Without the cap everything goes as today, and `committedSegmentIds` ordering for that path is left alone (rule 11). An id's index never changes once seen. The cap test and the branch it selects live in a new `dictation-segment-partial.rambla.ts` beside the manager, so the manager's own touches are its import at the end of its import block, the `segment?: DictationSegment` field on `DictationStreamOutboundMessage`, `index` added to the `transcript` handler's destructure, and one call replacing the existing `emitDictationPartial` call. Rebuild protocol (`npm run build:client`) or the generated outbound validator strips the field. Tests: `packages/protocol/tests/validation/dictation-segments.rambla.test.ts` — a partial parses with and without `segment` and round-trips through `packages/protocol/src/validation/ws-outbound.ts`; `packages/server/src/server/dictation/dictation-segments.rambla.test.ts`, with its own fake session rather than an import from upstream's test file — a partial carries exactly one segment, a committed id is sent once with `isFinal` and never again, a segment's index never changes across its own messages, a late final carries a lower `index` than a partial that arrived before it while its decode was still running, the segments sorted by `index` and joined equal what the glued `text` path produces for the same audio, and a client without the cap gets today's glued messages with no `segment`.

2. **Transaction module (pure).** New `packages/app/src/composer/input/dictation-transaction.rambla.ts`, no React, no mocks. State: `{ anchor: number; segments: Array<{ id: string; index: number; text: string; frozenPrefix: string | null; engineTextAtFreeze: string | null }> }`. Exports:
   - `beginDictation(selection)` → `state`. Anchors at `selection.end` (rule 1).
   - `applySegment({ text, selection, state, segment })` → `{ text, selection, state }`. An id already marked final is ignored outright (rule 9). An unfrozen id takes the incoming text whole. An unseen id is inserted so the list stays sorted by `index`; indexes have gaps, because `clear()` advances the counter without producing a segment, so a position is never an index (rule 11). Nothing is ever removed. A frozen id keeps `frozenPrefix` and appends the incoming text beyond its longest common prefix with `engineTextAtFreeze` — longest common prefix, never `startsWith`. The region is the non-empty segment texts joined by one space, matching the daemon's filter-then-join. Carets at or after the region end shift by the length delta; earlier carets are untouched (rules 2, 4).
   - `applyUserEdit({ previousText, nextText, state })` → `state`. Locates the edit span by common prefix and suffix; for each segment the span overlaps, records `frozenPrefix` as that segment's text up to the end of the span and `engineTextAtFreeze` as the engine's last text for that id; shifts `anchor` when the span ends at or before it (rules 2, 3). Prior art for this shape is in `research/2026-09-20-edit-during-dictation-prior-art.md`.
   - `beginRestart({ text, selection, state })` → `{ text, selection, state }`. Drops every segment, frozen included, and splices the whole region out of the text, so it returns the spliced text and the shifted selection like `applySegment` does. Retry and reconnect both use it (rule 8).
     Test `packages/app/src/composer/input/dictation-transaction.rambla.test.ts`: one test per rule 1-11, one per merge case, one where a late message for an id already marked final changes nothing, one where a segment arriving out of order lands in index order, one where a gap in the indexes still sorts correctly, one where the engine keeps dictating after a mid-segment edit and the new words land after the user's text while the words before it stay edited, one where the engine re-words across the user's edit and no word is lost, and one asserting text outside the region is byte-identical after a merge.

3. **Hook carries the segment.** In `packages/app/src/hooks/use-dictation.shared.ts` widen the `onPartialTranscript` meta to `{ requestId: string; segment?: DictationSegment }`, importing `DictationSegment` from the new protocol module at the end of the import block, and in `use-dictation.ts` pass `message.payload.segment` through the `dictation_stream_partial` listener. `handleStreamingTranscriptionSuccess` and its `droppedTranscript` concatenation are untouched and still run for a daemon without the cap. On the reconnect transition that calls `startNewStream("reconnect")`, emit a `dictationRestarted` callback before the new stream's first partial. Cases in `packages/app/src/hooks/use-dictation.rambla.test.tsx`: a partial's segment reaches the partial callback, a final segment reaches it with `isFinal` set, and a reconnect fires `dictationRestarted` before any new partial.

4. **Composer wiring.** New `packages/app/src/composer/input/use-dictation-field.rambla.ts` owns the transaction ref and every decision: it returns `onPartialTranscript`, `onUserEdit`, `beginDictation`, `beginRestart`, and the final-message handler, and it holds the text-input ref writes. It returns early when the meta carries no segment (old daemon), otherwise calls `applySegment` and writes the result, and it calls `beginRestart` from `dictationRestarted` (rule 8). It clears its state when `dictationStatus` becomes `idle`, writing nothing (rules 5, 6, 7); `failed` keeps the state for retry. On the final it writes nothing when segments were received — the words are already in the field — and runs the existing `applyDictationTranscript` append path when they were not. Every dictation write rewrites the whole region from transaction state, so it is idempotent and a write Android drops or a composition defers is repaired by the next partial 350 ms later; the final write has no successor, so on Android it is re-issued once on a short timer from the same state.

   `packages/app/src/composer/input/input.tsx` is limited to these touches, and `state.ts` is not modified: the import at the end of its import block; one hook call; `isDictating` dropped from the `editable` expression; the `DictationOverlay` branch replaced by inline recording controls beside the field so the text stays visible and editable; the discarded `partialTranscript: _dictationPartialTranscript` replaced by the hook's `onPartialTranscript`; one call each to `beginDictation` in `startDictationIfAvailable`, `onUserEdit` in `handleInputChange`, and `beginRestart` in the retry control; and `handleDefaultSendAction` while `isDictating` awaiting the existing accept-and-send path (`sendAfterTranscriptRef` + `confirmDictation()`) instead of sending immediately, so the final always lands before the send (rule 10). `packages/app/src/components/ui/text-input/text-input.web.tsx` takes one line: `replaceText` returns early while `isComposingRef.current` is set. Cases in `packages/app/e2e/browser/dictation-loss.rambla.browser.test.ts`: words land in the field as partials arrive while the user types before and inside the region; pressing send mid-recording sends once, after the final. Case in `packages/app/src/composer/input/dictation-transaction.rambla.test.ts`: applying the same segment twice produces identical text and state.

5. **Measure the write cost.** Add a case to `packages/app/e2e/browser/dictation-loss.rambla.browser.test.ts` that drives 60 partials at the 350 ms cadence into a field already holding 4000 characters, asserts the caret offset after each write equals where the user left it, and asserts each write completes in under 16 ms — one frame at 60 Hz, well inside the 350 ms partial cadence, so a write that misses it is visible as a stutter. A failure decides whether the writes need coalescing; nothing is coalesced before the measurement exists.

6. **Device pass.** On a physical Android device and a physical iPhone, with the daemon dictating: type continuously through a full 20 s segment and confirm no dictated words are missing from the field; confirm the caret stays where the user left it across a partial write; confirm Ctrl+Z / the platform undo gesture after dictation removes the user's own typing and not the whole field. Record the result per `docs/qa.md`.

## Merge conflicts

`.github/workflows/merge-upstream.yml` merges upstream's newest stable release daily. It pushes nothing if any file conflicts or if `npm run build:server` fails, so every conflict left here becomes a day the fork stops tracking upstream until someone resolves it by hand.

Prevention, in the order it applies (`STRATEGY.md` rules 1-2, the ledger's coldest-path standing rule):

- All new code goes in files upstream does not have: `*.rambla.ts` for modules, `*.rambla.test.ts` for tests, category suffix last. `rambla/fork/rebrand.sh` leaves them alone and a merge never touches them.
- The eleven upstream files above are the whole footprint. Nothing else is edited, no upstream file is reformatted, reordered, or tidied, and every edit is an addition.
- Fork imports go at the end of the import block, never at the top.
- `CLIENT_CAPS`, the `capabilities` schema, and `appCapabilities` are append-at-the-end lists that upstream also appends to, so those three one-line entries are the likeliest conflicts in the feature and the cheapest to re-apply.
- `packages/app/src/composer/input/input.tsx` is the one file where the change is behavioral rather than additive. Keeping the logic in the hook is what holds it to single-line call sites.

Resolution, when it happens anyway:

- Every file below is "take upstream, re-apply ours" except `input.tsx`, which is "keep both — re-apply our call sites onto upstream's structure". rerere is on globally, so each resolution is recorded once.
- `messages.ts` (3 lines), `client-capabilities.ts` (1), `host-runtime.ts` (1), `speech-provider.ts` (1), `sherpa-parakeet-realtime-session.ts` (counter), `dictation-stream-manager.ts` (3), `use-dictation.shared.ts` (1), `use-dictation.ts` (segment passthrough + `dictationRestarted`), `text-input.web.tsx` (1), `input.tsx` (call sites), `dictation-loss.rambla.browser.test.ts` (ours, cannot conflict).
- If upstream adds its own segment or partial-diff field to the dictation partial, drop ours and take theirs — that is the "Drops when" condition for the ledger entry.
- One ledger entry covers this feature (recorded under "Ledger entries" below), listing those files and the rules above, and lands in the same commit as the code.

## Accepted limitation

- Dictated text and typed text look identical in the field. Styling them apart needs either a rich-text surface or an overlay layer behind the field, belongs with the highlight work, and is not in this plan.

## Ledger entries

The fork ledger entries recorded for this plan, copied in full.

### 23. Dictation: words land in the composer field as they are spoken — ACTIVE

`plans/live-dictation-text-in-field.md`, branch `live-dictation`. Feature,
test-first.

- **Commit(s):** `5099e6b36` (segment per partial), `eaad7b92d` +
  `277a0045b` (hook carry + restart announcements), `318dfef22`
  (transaction), `b9b2a6f36` (editable composer), `798fb6789` (composition
  guard test), `283c9ca4b` (daemon-client cap line), `15e6406b9` (failure
  text in controls), `7bf8f298a` (opaque in-flow recording strip), `be30f7582`
  (old-path transcripts insert at the caret), `0d61d4d34` (send-path clear
  bypasses the composition guard), rebase + provenance pins
  `38326ef45`→`e9a8bcb95`. `9451c347d` fixes checkpoint regressions in the
  same feature (see #22 note).
- **Files:** new fork modules `packages/protocol/src/dictation-segment.rambla.ts`,
  `packages/server/src/server/dictation/dictation-segment-partial.rambla.ts`, and
  `dictation-transaction.rambla.ts`, `use-dictation-field.rambla.ts` and
  `dictation-recording-controls.rambla.tsx` under
  `packages/app/src/composer/input/`, plus the forked composer component
  `packages/app/src/composer/input/input.rambla.tsx` (2026-09-21, full copy of
  upstream's `input.tsx` with our 18 hunks' call sites applied in-place; the
  component is ours now and never merges). New fork tests
  `packages/protocol/tests/validation/dictation-segments.rambla.test.ts`,
  `packages/server/src/server/dictation/dictation-segments.rambla.test.ts`,
  `packages/app/src/composer/input/dictation-transaction.rambla.test.ts`,
  `packages/app/src/composer/input/use-dictation-field.rambla.test.tsx`,
  `use-dictation-field-send.rambla.test.tsx`,
  `use-dictation-field-status.rambla.test.tsx` and
  `dictation-recording-controls.rambla.test.tsx`,
  plus cases in `packages/app/src/hooks/use-dictation.rambla.test.tsx` and
  `packages/app/e2e/browser/dictation-loss.rambla.browser.test.ts`. Upstream
  edits, hunk counts against main: `packages/protocol/src/messages.ts` (3) and
  `client-capabilities.ts` (1, the COMPAT entry) — under
  `packages/server/src/server/`: `dictation/dictation-stream-manager.ts` (7),
  `speech/providers/local/sherpa/sherpa-parakeet-realtime-session.ts` (6),
  `session/voice/voice-session.ts` (2), `speech/speech-provider.ts` (1),
  `session.ts` (1) — under `packages/app/src/`:
  `composer/index.tsx` (1, the fork import line pointing at `./input/input.rambla`),
  `hooks/use-dictation.ts` (4),
  `dictation/dictation-stream-sender.ts` (4),
  `components/dictation-controls.tsx` (4), `runtime/host-runtime.ts` (1),
  `hooks/use-dictation.shared.ts` (1), and
  `components/ui/text-input/text-input.web.tsx` (1) — plus
  `packages/client/src/connection/index.ts` (1). Upstream's
  `dictation-stream-manager.test.ts` is untouched; `connection.test.ts` is
  unmodified from main; `daemon-client.test.ts` differs by the one approved
  expected-list line above.
- **Why:** upstream glues every segment it holds into one string and sends that
  whole transcript on every partial, and the composer discards it. The field
  carries `editable={!isDictating && ...}` and `DictationOverlay` covers the
  composer, so dictated words reach the field only on the final and typing during
  dictation is impossible.
- **What changed:** a `dictation_segments` client capability, an optional
  `segment` on the dictation partial, and an optional `index` on the speech
  provider's transcript event; the three COMPAT tags are all in
  `packages/protocol`. The sherpa session numbers a segment in the same
  synchronous block that cuts it, so a slow final still sorts ahead of a later
  segment's partial. A client that advertised the capability receives the one
  segment that reported with an empty glued `text` and places the words itself;
  everyone else, and any event carrying no `index`, keeps today's glued message,
  which leaves `speech/providers/openai/stt.ts` as it was. Client-side the field
  stays editable, inline controls replace the overlay, a user edit freezes the
  segment it lands in while later engine words append after it, `restartStream`
  announces a retry or reconnect so the region is spliced out before the daemon
  re-transcribes it, a send pressed while recording waits for the final, and
  four Pressables in the dictation controls gained `accessibilityRole="button"`.
  `replaceText` on web refuses to write into a live IME composition, except
  that a clear (empty `nextText`, the send path) always goes through — the
  guard is one early return in `text-input.web.tsx`, amended by `0d61d4d34`
  after it was found to leave stale text for IME users (standing rule: the
  composition write-guard
  stays last in the method, any upstream change to `replaceText` resolves keep-
  both with ours appended after upstream's body). A failed dictation surfaces
  its error text through the fork wrapper
  `dictation-recording-controls.rambla.tsx` (`errorText` prop, rendered on the
  failed status with the same `message.dictation.failed` /
  `message.dictation.failedRetry` strings as the overlay) — no upstream edit for
  the failure display. The `dictation_segments` cap sits in
  `CLIENT_CAPS`/messages plus `appCapabilities` in `host-runtime.ts` and
  `DEFAULT_CLIENT_CAPABILITIES` in `packages/client/src/connection/index.ts`;
  capability-defaults decision (task owner, 2026-09-21): option A — the cap
  stays in `DEFAULT_CLIENT_CAPABILITIES`, every client advertises it.
  Upstream's `daemon-client.test.ts` expected-capability list carries one
  task-owner-approved line, `dictation_segments: true`; standing rule: when the
  protocol grows a new default cap, add its line to that list — never weaken
  the assertions.
- **Rule:** keep fork version; conflicts resolve to ours. Every file is "take
  upstream, re-apply ours" except `composer/index.tsx`, whose one conflict-shaped
  line is the fork import (keep ours). `input.tsx` itself is pristine upstream —
  restored 2026-09-21 to `origin/upstream-rebrand@18198cf8f` (zero hunks, nothing
  to merge, ever). The composer component lives in `input.rambla.tsx`; both
  provenance SHAs are pinned in its header comment. Upstream-origin:
  getpaseo/paseo `77c5c8f17e1f` — the exact upstream state to diff against for
  upstream improvements (the rebrand CI embeds it in its commit message).
  Rebrand baseline: `origin/upstream-rebrand@18198cf8f` — the rebranded state we
  actually forked from, for tracing divergence or breakage. Port ritual:
  periodically diff `input.rambla.tsx` against
  `git show <upstream-sha>:packages/app/src/composer/input/input.tsx` and port
  what matters (major accessibility work is planned on the fork copy; expect to
  port little). `CLIENT_CAPS`, the hello `capabilities` schema, `DEFAULT_CLIENT_CAPABILITIES` and `appCapabilities` are
  append-at-the-end lists upstream also appends to, so those four one-line entries
  are the likeliest conflicts. No upstream test file is edited.
- **Drops when:** upstream ships its own live segment field on the dictation
  partial — ours goes, theirs is taken.
- **Verified:** the browser suite
  `packages/app/e2e/browser/dictation-loss.rambla.browser.test.ts` was executed
  on 2026-09-21: all 11 cases passed twice in a row (no flakiness), including
  the write-cost measurement (60 partials into a 4000-char field, caret stable,
  every write < 16 ms; p50 0.8 / p95 1.1 / max 1.2 ms, then 0.7 / 0.9 / 1.0);
  the composition write-guard is pinned by
  `packages/app/src/components/ui/text-input/text-input-web-compose.rambla.test.tsx`.

### 27. Dictation: old-path transcripts insert at the caret — INCOMPLETE

Client-side; the no-segment path of the live-dictation fork (#23).

- **Commit(s):** `be30f7582`.
- **Files:** new `packages/app/src/composer/input/dictation-insert.rambla.ts`
  (pure splice: insert at the caret or over the selection, pad with a space on
  whichever side touches non-whitespace, return the post-insert caret) +
  `input.rambla.tsx` and `use-dictation-field.rambla.ts` call sites + tests
  `dictation-insert.rambla.test.ts` and a `use-dictation-field.rambla.test.tsx` case.
- **Why:** agents without the `dictation_segments` capability still delivered
  one glued final, and the forked composer dropped it on the field wholesale
  instead of inserting where the user's caret was.
- **INCOMPLETE:** only the old no-segment path inserts at the caret; the
  segment path places its own text. Restart/cancel edge cases untested.
  Do not treat as finished until the segment path and the edge cases are covered.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** moot once every client advertises `dictation_segments` (or
  upstream ships caret insertion itself).

### 28. Dictation: opaque in-flow recording strip replaces floating controls — ACTIVE

UI redesign within the live-dictation fork (#23), client-side.

- **Commit(s):** `7bf8f298a`.
- **Files:** `rambla/packages/app/src/composer/input/dictation-recording-controls.rambla.tsx`
  (self-contained strip: 52pt row, 44pt actions, mm:ss timer, `VolumeMeter`,
  themed icons — no longer wraps upstream's `DictationControls`),
  `input.rambla.tsx` call site, fork test
  `dictation-recording-controls.rambla.test.tsx`.
- **Why:** the first live-dictation controls floated over the composer and
  reused upstream's floating `DictationControls`; an opaque, in-flow strip
  between the text surface and the toolbar never overlaps the dictated text
  and carries its own states (recording, processing, failed).
- **Rule:** keep fork version; conflicts resolve to ours. The strip lives
  entirely in the fork copy — nothing to merge unless upstream's
  `dictation-controls.tsx` gains something worth porting.
- **Drops when:** upstream moves its own dictation controls in-flow (compare
  against ours first).
