# Shared AudioWorklet capture module

Goal: move web microphone capture off the main thread so dictation stops dropping Tom's audio when the UI is busy.

## Names and locations

| Path                                                       | What                                                                                                             |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `packages/app/public/rambla-audio-capture-processor.js`    | The worklet. Hand-written plain JS, no imports, loaded by root-relative URL.                                     |
| `packages/app/src/audio-capture/capture.web.ts`            | Main-thread module. Owns getUserMedia, the graph, `addModule`, the port, lifecycle. Delivers raw Int16 segments. |
| `packages/app/src/audio-capture/dictation-source.web.ts`   | Dictation adapter hook. Base64 + React volume state. Satisfies `use-dictation-audio-source.types.ts` unchanged.  |
| `packages/app/src/hooks/use-dictation-audio-source.web.ts` | Upstream file, reduced to a one-line re-export of the adapter.                                                   |

`packages/app/src/audio-capture/` does not exist upstream, so an upstream merge can only add files beside it, never inside it; the public asset carries `rambla-` so it cannot collide with an upstream-added asset of the same purpose.

## Messaging contract

Construction options (`processorOptions`, set once, never changed): `outputSampleRate` (16000), `segmentFrames` (output frames per `segment` message), `volumeEveryQuanta` (quanta between `volume` messages, 16).

Worklet to main thread:

| Message   | Carries                                                                                                                                                                                | When                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `segment` | PCM16 buffer (transferred), frame count, `firstFrameIndex` — the audio thread's own clock (`currentFrame`) converted to the output rate, so a render the thread never ran leaves a gap | Whenever the accumulator reaches `segmentFrames`, and once more per `flush` for the remainder |
| `volume`  | RMS 0..1 over the quanta since the last one                                                                                                                                            | Every `volumeEveryQuanta` quanta, muted or not                                                |
| `flushed` | `finalFrameIndex`                                                                                                                                                                      | Once, after the last `segment` a `flush` produced                                             |

Main thread to worklet:

| Message | Carries         | When                                                                                                                          |
| ------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `mute`  | boolean         | Only when a consumer mutes. Muted, the worklet keeps computing and posting `volume` and stops accumulating and posting audio. |
| `flush` | `final` boolean | On stop, before anything is disconnected                                                                                      |

`firstFrameIndex` is the whole dropout detector: contiguous indices prove no audio was lost, and a jump is reported through `onError` rather than passing silently. (Calibrated 2026-09-18: gaps under 50 ms — warm-up plus one-miss jitter — are dropped silently and remain visible only in the end-of-session shortfall report; the user-facing warning reports milliseconds, not frames. Follow-up under step 6's consumer, recorded in `reviews/2026-09-17-capture-gap-threshold.md`.)

## Division of labour

Audio thread: resample to 16 kHz, convert to PCM16, RMS, accumulate to `segmentFrames`, mute gate. All of it is per-sample arithmetic on the render quantum, which is the work that must not queue behind React.

Main thread: `btoa` (absent from the worklet global scope), React volume state, getUserMedia, track and context event listeners, graph teardown.

## One module, two consumers

`segmentFrames` is a number, not a mode: dictation passes 16000 for one-second segments, voice chat will pass 128 to get every quantum. Mute is a message voice chat sends and dictation never sends. Base64 and chunk-to-string live in the dictation adapter, so the shared module has no opinion about either.

## Lifecycle

`start()`: getUserMedia, create the context, `addModule`, construct the node, wire source to node to zero gain to destination, attach listeners. `stop()`: post `flush` with `final`, await `flushed`, deliver every segment that arrived in between, then disconnect, stop tracks, close the context. Audio captured between the stop request and the stream closing is delivered, because teardown waits on `flushed`. A `flushed` that never arrives resolves `stop()` after a short timeout and reports the shortfall through `onError`.

## Interruption and device loss

Main thread only. The microphone track's `ended` and `mute` events and the `AudioContext` `statechange` to `suspended` or `closed` each fire `onInterruption` once and then stop capture. The worklet cannot see any of this; a disconnected input is indistinguishable from silence from inside `process`.

## Worklet loading failure

No fallback. If `addModule` rejects, `AudioWorklet` is absent, or the node cannot be constructed, `start()` rejects with a message naming the worklet URL; the adapter routes it to `onError`, and `use-dictation.ts` already turns that into a visible dictation failure with the retry control. Upstream's MediaRecorder fallback goes away with the file it lives in.

## Testing

The processor file has no imports, so a Node unit test imports it under stubbed `AudioWorkletProcessor`, `registerProcessor`, and `sampleRate` globals and drives `process()` directly. That covers resampling, segment size, frame-index continuity, mute, and flush without a browser. The main-thread module is unit-testable against a fake context and node. Only `addModule` loading, real microphone timing, and main-thread contention need the Playwright harness.

A test is certain it exercised the worklet by wrapping `AudioWorklet.prototype.addModule` in a page init script and asserting the wrapper ran and resolved. `packages/app/e2e/browser/dictation-loss.rambla.browser.test.ts` already has a main-thread-jam test whose current guard infers the path from segment sizes; that guard is replaced by the `addModule` counter.

## Steps

1. **Worklet DSP.** Test `packages/app/src/audio-capture/processor.rambla.test.ts` drives `process()` through the stubbed global scope: 16 kHz output frame counts, `segment` at exactly `segmentFrames`, contiguous `firstFrameIndex`, `volume` still posted while muted with no `segment`, `flush` emitting the remainder then `flushed`. Then write `packages/app/public/rambla-audio-capture-processor.js`.
2. **Loading proof.** New spec `packages/app/e2e/browser/audio-worklet-loading.rambla.browser.test.ts` loads the app shell, calls `addModule` on the root-relative URL, constructs the node, asserts both resolve. Run `npm run typecheck`, `npm run lint`, `npm run format:check` in the same step to settle whether repo tooling accepts a raw `.js` under `public/`.
3. **Main-thread module.** Test `packages/app/src/audio-capture/capture.rambla.test.ts` against a fake context and node: `stop()` waits for `flushed` and delivers late segments, `addModule` rejection surfaces as a start error, track `ended` fires `onInterruption` once, a frame-index jump reports through `onError`. Then write `capture.web.ts`.
4. **Dictation adapter.** Test `packages/app/src/audio-capture/dictation-source.rambla.test.tsx`: segments arrive as base64 of the PCM bytes, the tail is emitted before `stop()` resolves, `onInterruption` is called, `volume` updates are throttled to roughly 10 Hz so the composer does not re-render per message. Then write `dictation-source.web.ts`.
5. **Flip the shim.** Reduce `packages/app/src/hooks/use-dictation-audio-source.web.ts` to a one-line re-export and repoint the guard in `dictation-loss.rambla.browser.test.ts` to the `addModule` counter. The existing jam test is the proof.
6. **Loss coverage in the harness.** Add to `dictation-loss.rambla.browser.test.ts`: ending the synthetic microphone track mid-dictation surfaces a failure instead of silence, and the audio spoken just before the submit press reaches the daemon.

## What I ran

- `ls`/`find` over `packages/app/src`, `packages/app/public`, `packages/app/e2e/browser` — confirmed `audio-capture/` does not exist, `public/` holds only six static assets, and `dictation-loss.rambla.browser.test.ts` exists.
- Read `use-dictation-audio-source.types.ts`, `use-dictation-audio-source.web.ts`, `dictation-loss.rambla.browser.test.ts`, `packages/app/vitest.config.ts`, and the three research files.
- `grep` of `packages/app/package.json` scripts and the vitest projects — the `unit` project is Node and includes `src/**/*.test.{ts,tsx}`; `e2e` is excluded from it.

## Not verified

- That a Node unit test can import the `public/` JS file through Vite's transform under stubbed worklet globals. Step 1 settles it; if it cannot, the processor test moves into the Playwright spec from step 2.
- Whether `typecheck`, `lint`, `format`, and `knip` accept a hand-written `.js` under `packages/app/public/`. Step 2 settles it.
- That `addModule` succeeds in a browser against the Metro dev server. Verified on Electron only; step 2 settles it.
- That the worklet fixes the jam test. Nobody has run it against a worklet.

## Open question — which file absorbs the merge conflict

Shipped: `use-dictation-audio-source.web.ts` gutted to a re-export, 484 lines
deleted, `use-dictation.ts` untouched.

Alternative not evaluated before shipping: leave upstream's file byte-identical
and change the single import in `use-dictation.ts` instead. It has one real
importer, at `use-dictation.ts`, plus a mock of the same path in
`use-dictation.rambla.test.tsx`.

An untouched file never conflicts, and upstream's future edits to it would merge
clean and sit unused, against a one-line conflict in `use-dictation.ts`. The
cost is that upstream's implementation stays in the tree unreferenced.

**Answered — keep the shipped shim.** Three facts settle it:

1. The import cannot simply be repointed. `use-dictation.ts` is
   platform-split: web loads `use-dictation-audio-source.web.ts`, native loads
   `use-dictation-audio-source.native.ts`, resolved per platform from the one
   import. Repointing the line at the web adapter breaks the phone; keeping the
   split means building a new platform pair of our own, which relocates the
   seam rather than removing it.
2. The alternative trades a loud conflict for a silent one. Upstream's 484
   lines would sit in the tree unused, and upstream's future edits to that file
   would merge clean and change nothing — a merge that lies. The shim turns
   every upstream touch of that file into a two-line conflict that always
   resolves the same way: keep ours.
3. The shim satisfies `use-dictation-audio-source.types.ts` exactly, so the
   seam's contract is unchanged either way.

## Out of scope

Voice chat adoption and `packages/app/src/voice/audio-engine.web.ts`. Native capture. Every other finding in the dictation-loss audit. Echo cancellation, barge-in, and playback-aware gating. Docs.
