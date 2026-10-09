# Plan — one microphone owner, and failures the user can hear

Dictation dies after a tab switch because two parts of the app each build their own
microphone object over one shared native engine, and every way that engine can fail is
currently swallowed.

Issue: [issues/020](../issues/020-ios-microphone-capture-dies-with-an-android-error.md).
Research: [research/ios-audio-session-ownership.md](../research/ios-audio-session-ownership.md).

Platforms: steps 1-4 are shared native JavaScript and land on iOS and Android both.
Steps 5-6 are iOS Swift. Web is untouched — web dictation uses
`@/audio-capture/dictation-source.web` and never loads this engine.

## Step 1 — one microphone object, claimed by whoever is recording

`packages/app/src/contexts/voice-context.tsx` already builds one engine for the life of
the app and publishes it on `VoiceAudioEngineContext`.

- Leave `VoiceAudioEngineContext`'s value as the bare `AudioEngine`, and leave
  `useVoiceAudioEngineOptional()`'s signature alone. `session-context.tsx` and
  `settings-screen.tsx` consume it, and `settings-screen.tsx` quotes its return type, so
  changing it is an upstream-facing break that buys nothing.
- Hold a mutable current-capture-consumer cell in a `useRef` inside `VoiceProvider`. It
  starts empty and is empty whenever nobody is recording, so dictation's first claim
  after app start succeeds. The voice runtime is only the fallback target for callbacks
  that arrive while the cell is empty, which is how voice mode keeps behaving as it does
  today.
- Route the engine's `onCaptureData`, `onVolumeLevel`, `onInterruption` and `onError`
  callbacks through that cell instead of straight at the runtime.
- Add a second context exposing `claimCapture(consumer): boolean` and
  `releaseCapture(consumer)`. A claim is refused while another consumer holds it; the
  refused caller reports "microphone in use" through its own error path. Voice mode
  claims like everybody else — `startVoice` fails through its normal failure path when
  the claim is refused. `releaseCapture` empties the cell and ignores a caller that is
  not the current consumer.
- Expose the cell to the engine wrapper too. `VoiceProvider` builds the engine, so pass
  `hasCaptureClaim()` into `createAudioEngine` alongside the callbacks; step 3 reads it.

Claim methods live on the new context only, never on the engine, so
`audio-engine-types.ts` and `audio-engine.web.ts` are untouched.

Test: a second claim is refused while the first holds it; a release by a stale consumer
does not steal the microphone back; a release by the holder empties the cell and a fresh
claim then succeeds.

## Step 2 — dictation stops building its own

`packages/app/src/hooks/use-dictation-audio-source.native.ts`:

- Delete `getOrCreateEngine`, `engineRef`, and the unmount effect that calls `destroy()`.
- Take the engine from `useVoiceAudioEngineOptional()`.
- `start` claims capture, then calls `initialize()` and `startCapture()`.
- `stop` releases the claim first and calls `stopCapture()` only while this hook is still
  the current capture consumer.
- On unmount, do the same. Never destroy the engine. `use-dictation.ts` already calls
  `stop` from its own unmount cleanup, and that guard is what keeps a composer unmount
  from cutting off whoever holds capture now.

Test: unmounting the dictation hook leaves the shared engine alive and leaves another
consumer's capture running; a `stop` from a hook that no longer holds the claim touches
the engine not at all.

## Step 3 — act when iOS says capture was interrupted

`packages/app/src/voice/audio-engine.native.ts` ignores every interruption event that is
not `"blocked"`, so the wrapper keeps believing it is capturing after the native side has
already stopped.

- On `"began"`: clear `refs.captureActive`, report volume zero, call `onInterruption`.
- On `"blocked"`: unchanged.
- On `"ended"`: iOS only sends it when the system said resume, and
  `resumeRecordingAndPlayer()` has already turned recording back on whether or not
  anyone in JavaScript still wants it. Reconcile through the `hasCaptureClaim()` getter
  step 1 passes in. If someone still holds the claim, re-assert `refs.captureActive`. If
  nobody does — the consumer
  stopped mid-interruption, say dictation confirmed its transcript — call
  `toggleRecording(false)` so the native side stops recording into nothing.

Native resuming on its own without asking JavaScript stays as it is. Changing it is
Swift work in step 5's file and is a separate piece of work, not part of this plan.

Test: a `"began"` event clears capture state and reaches the consumer; an `"ended"` with
no claim holder turns native recording off.

## Step 4 — voice mode stops swallowing errors

`voice-context.tsx` sends engine errors to `console.error`. Dictation's route —
`useDictation`'s `onError` into `handleDictationError` in `composer/input/input.tsx` —
has no voice equivalent: `voice-runtime.ts` logs and has no error state. So this step
adds the surface rather than reusing one.

- On an engine error, stop voice through the runtime.
- Show the message through `useToast()` from `@/contexts/toast-api-context`, which is
  where the rest of the app puts failures the user has to see.

Test: an engine error raised while voice mode is active stops voice and calls the toast
API.

## Step 5 — iOS reports a refused audio session

`packages/expo-two-way-audio/ios/AudioEngine.swift`:

- `setupAudioSession()` catches `setCategory`, `setPreferredSampleRate` and
  `setActive(true)` and only prints. Record the failure on the engine.
- `toggleRecording(true)` calls `activateAudioSessionIfNeeded()` and then returns true
  regardless. Return false when the session is not active.

`packages/app/src/voice/audio-engine.native.ts` already throws when `toggleRecording`
returns false. Give it a message that says the microphone is in use by something else,
so the failure is distinguishable from a missing engine.

This step is iOS-only by mechanism, not only by file. `setupAudioSession()` also fails
soft inside `init()` and still returns a non-nil engine, and the Kotlin module's
`initialize` has no session concept at all, so there is no Android twin to wait for.

Verification is on device or TestFlight; there is no Swift test harness in this repo.

## Step 6 — fold the uncommitted change in

The working tree holds an unreviewed partial fix in three parts: `destroy()` calling
`releaseAudioSession()` instead of `tearDown()`, the platform-specific capture-failure
message, and `refs.initialized = false` in `startCapture`. Keep the first two. Drop the
third, which guards nothing once step 1 lands.

Delete `packages/app/src/voice/two-way-audio-native.ts` and import the native package at
the top of `audio-engine.native.ts`, then point the test's mock at
`@getrambla/expo-two-way-audio` instead of the seam path. Measured, not assumed: vitest
does not intercept a `require()` inside a module body, which is why upstream's inline
`require` needed a seam to be mockable at all, but it does intercept a top-level import
of the same package. The file's stated reason — deferring the load so a build missing the
module fails at capture rather than startup — does not hold either way, because
`VoiceProvider` mounts at the app root and builds the engine on its first render.

In `packages/app/src/voice/audio-engine.rambla.test.ts`:

- Delete "starts capture after another wrapper tore down the shared native engine". It
  pins the `refs.initialized = false` re-assert this step drops.
- Keep "keeps a capture in flight alive when another wrapper is destroyed" unchanged. It
  is the regression test for the shared-engine fault, at the right level.
- Drop "reports the audio engine, not Android audio focus, when capture fails on iOS",
  which duplicates "does not blame Android audio focus when capture fails off Android".
  Put a case for the Android arm of the message in its place.
- Keep the session-release test.

## Step 7 — record the divergence

Steps 1-3 change three upstream files permanently: `voice-context.tsx`,
`use-dictation-audio-source.native.ts` and `audio-engine.native.ts`. Add a ledger
entry (recorded under "Ledger entries" below) covering them, with the file's `Rule` and `Drops when` lines — keep fork version;
drops when upstream shares one engine across wrappers itself. Amend entry 19, whose
recorded fix — the `refs.initialized = false` re-assert — step 6 removes, along with its
`two-way-audio-native.ts` seam, and whose `Drops when` no longer describes what the fork
carries.

## Ledger entries

The fork ledger entries recorded for this plan, copied in full.

### 19. Dictation: capture re-asserts the shared native audio engine — ACTIVE

Behavior fix, test-first. Client-side; unrelated to the server dictation work.

- **Commit(s):** `9a3768f0b` (destroy must not kill an in-flight capture —
  the surviving `destroy()` change), `9e2f144d8`-era cleanup; superseded
  parts were `e3ce2df1c`-adjacent.
- **Files:** `rambla/packages/app/src/voice/audio-engine.native.ts`, new
  `rambla/packages/app/src/voice/audio-engine.rambla.test.ts`.
- **Why:** `expo-two-way-audio` keeps one native AudioEngine per process, and
  `tearDown()` drops it — `ExpoTwoWayAudioModule.swift` sets `audioEngine` to
  nil, `ExpoTwoWayAudioModule.kt` sets it to null. Upstream tracks
  initialization in a per-wrapper JS flag, and there is more than one wrapper:
  `contexts/voice-context.tsx` makes one and every `useDictation` composer makes
  another. When one wrapper is destroyed, every other live wrapper still
  believes it is initialized, skips `initialize()`, and gets `false` back from
  `toggleRecording(true)` forever. On iOS that nil engine is the only way that
  call can return false, so dictation is dead until the app restarts.
- **What changed:** `startCapture` clears its own initialized flag and awaits
  `initialize()` before toggling recording; native `initialize()` returns early
  when the engine already exists, so this costs one bridge call per capture and
  nothing else. Playback keeps the cached flag. The failure message no longer
  names Android audio focus at all — it says the audio engine is not
  available, which is the true reason on every platform. The native module
  moves to a top-level import, which is what lets the test substitute it;
  `createAudioEngine` ran at app start through `VoiceProvider` anyway, so the
  old in-function `require()` deferred nothing.
  `destroy()` no longer calls `tearDown()` at all: recovering on the next
  capture start does nothing for a capture already in flight, which
  `startCapture` skips on `refs.captureActive`, and no native event reports the
  engine going away — the waveform keeps moving while every word is lost. It
  calls `releaseAudioSession()` in its place, so the background-music
  protection the old call carried stays, guarded natively against releasing
  while another wrapper is live. Nothing else in the app calls `tearDown()`.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** superseded by entry 20. The re-assert in `startCapture` is
  gone — one shared engine leaves nothing to re-assert — and so is the
  `two-way-audio-native.ts` seam. What survives here is the `destroy()` change
  and the failure message.

### 20. Voice: one microphone owner across dictation and voice mode — ACTIVE

Behavior fix, test-first. Client-side.

- **Commit(s):** `e3ce2df1c` (one microphone, claimed), `df67adc5c`
  (interruptions), `e6a68ca59` (errors reach the user), `4d4ed597b` +
  `07a6b9037` + `2a4f065a7` (refusal naming + iOS session honesty), `953d083be` (source typecheck).
- **Files:** `rambla/packages/app/src/contexts/voice-context.tsx`,
  `rambla/packages/app/src/hooks/use-dictation-audio-source.native.ts`,
  `rambla/packages/app/src/voice/audio-engine.native.ts`,
  `rambla/packages/expo-two-way-audio/ios/AudioEngine.swift`, new
  `rambla/packages/app/src/contexts/voice-capture-claim.rambla.test.tsx`.
- **Why:** there is one native audio engine per process, and upstream had two
  JavaScript wrappers over it — the voice provider built one, every dictation
  composer built another. A composer unmount destroyed the engine under voice
  mode, and after a tab switch dictation could not start again. Interruptions
  made it worse: the wrapper ignored every event that was not `"blocked"`, so a
  phone call left it drawing a waveform over a microphone that had stopped. On
  iOS a refused audio session printed and carried on, and `toggleRecording`
  reported success regardless, so there was no way to tell any of this apart.
- **What changed:** the provider owns the one engine and a claim cell. Whoever
  is capturing holds the claim and receives the engine callbacks; the runtime is
  the fallback when nobody holds it. Voice mode claims through an engine facade
  passed to `createVoiceRuntime`, so `voice-runtime.ts` is untouched. Dictation
  takes the shared engine from context and never destroys it, and its stop and
  unmount touch the engine only while it still holds the claim. The refused side
  names the other mode so the user knows what to stop. Interruptions now act:
  `"began"` clears capture state, and `"ended"` — which iOS sends only after the
  native side has already resumed on its own — keeps capturing when someone
  holds the claim and turns native recording off when nobody does. Engine errors
  during voice mode stop voice and reach the toast instead of the console. In
  the Swift, a failed category or activation leaves the session inactive and
  `toggleRecording(true)` refuses to start; a refused preferred sample rate is
  only a preference and still lets the session through.
- **Rule:** keep fork version; conflicts resolve to ours.
- **Drops when:** upstream shares one engine across wrappers itself.
