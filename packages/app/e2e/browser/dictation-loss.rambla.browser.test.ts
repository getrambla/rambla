import type { WebSocketRoute } from "@playwright/test";
import { expect, test, type Page } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { installAddModuleCounter, readAddModuleCounter } from "../support/helpers/audio-worklet";
import { daemonWsRoutePattern } from "../support/helpers/daemon-port";
import {
  openNewWorkspaceComposer,
  selectWorkspaceIsolation,
} from "../support/helpers/new-workspace";
import { seedWorkspace } from "../support/helpers/seed-client";
import { waitForSidebarHydration } from "../support/helpers/workspace-ui";

type WebSocketMessage = string | Buffer;

/** What the microphone supplied, as a complete daemon transcript. */
const SPOKEN = "one two three four five six seven eight nine ten";
/** The same dictation with its ending missing. */
const TRUNCATED = "one two three four five";

const CAPTURE_RATE = 16_000; // the web capture resamples to 16 kHz and cuts a segment every second
const JAM_MS = 2_000;
// Each captured segment must land where the supplied audio says it should.
// Drift of a few ScriptProcessor buffers (~85 ms each at 48 kHz) plus clock
// drift between the microphone's audio context and the app's is legitimate;
// 300 ms covers that and still sits far below the 2 s jam.
const CAPTURE_TOLERANCE_MS = 300;
// The microphone supplies one long rising ramp instead of a tone, so each
// captured sample's amplitude says where in the supplied audio it came from.
// Counting samples would not: dropping a span and then replaying stale buffers
// keeps the count right while the recording is wrong.
const RAMP = { seconds: 30, peak: 0.9 };

interface SegmentRecord {
  seq: number;
  pcm: Buffer;
  receivedAt: number;
}

/** Where a captured sample sits in the supplied ramp, in milliseconds. */
function rampPositionMs(sample: number): number {
  const amplitude = sample / 32_767;
  return ((amplitude + RAMP.peak) / (2 * RAMP.peak)) * RAMP.seconds * 1_000;
}

interface FinishTools {
  dictationId: string;
  acceptFinish(timeoutMs: number): void;
  sendFinal(text: string): void;
}

/** One live segment as a daemon that reads the dictation_segments capability reports it. */
interface DictationSegmentReport {
  id: string;
  index: number;
  text: string;
  isFinal: boolean;
}

interface DictationHarness {
  segments: SegmentRecord[];
  /** What the daemon sent and what the app asked of it, in the order it happened. */
  events: string[];
  /** The prompt of every creation the app requested, so a duplicate send is visible. */
  createPrompts: string[];
  waitForSegments(count: number): Promise<void>;
  waitForFinish(): Promise<void>;
  sendPartial(text: string): void;
  sendSegment(segment: DictationSegmentReport): void;
  /** The stream the app currently has open, so a test can tell a reconnected one apart. */
  dictationId(): string | null;
  dropConnection(): Promise<void>;
  /** Drops the socket and lets the app reconnect, which is what a reconnect restart needs. */
  dropConnectionOnce(): Promise<void>;
  waitForBlockedReconnect(): Promise<void>;
}

function parseEnvelope(message: WebSocketMessage): {
  type?: unknown;
  message?: Record<string, unknown>;
} | null {
  const raw = typeof message === "string" ? message : message.toString("utf8");
  try {
    return JSON.parse(raw) as { type?: unknown; message?: Record<string, unknown> };
  } catch {
    return null;
  }
}

function sessionMessage(message: WebSocketMessage): Record<string, unknown> | null {
  const envelope = parseEnvelope(message);
  return envelope?.type === "session" && envelope.message ? envelope.message : null;
}

function sendSessionMessage(ws: WebSocketRoute, message: Record<string, unknown>): void {
  ws.send(JSON.stringify({ type: "session", message }));
}

function enableDictationCapability(message: WebSocketMessage): WebSocketMessage {
  const envelope = parseEnvelope(message);
  const payload = envelope?.message?.payload;
  if (
    envelope?.message?.type !== "status" ||
    !payload ||
    typeof payload !== "object" ||
    (payload as { status?: unknown }).status !== "server_info"
  ) {
    return message;
  }

  (payload as Record<string, unknown>).capabilities = {
    voice: {
      dictation: { enabled: true, reason: "" },
      voice: { enabled: false, reason: "Realtime voice is disabled in this test." },
    },
  };
  return JSON.stringify(envelope);
}

/** A microphone that yields a genuine MediaStream carrying the ramp, so the app takes its PCM path. */
async function installSyntheticMicrophone(page: Page): Promise<void> {
  await page.addInitScript((ramp) => {
    const mediaDevices = navigator.mediaDevices;
    Object.defineProperty(mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        const context = new AudioContext();
        const frames = Math.floor(context.sampleRate * ramp.seconds);
        const buffer = context.createBuffer(1, frames, context.sampleRate);
        const channel = buffer.getChannelData(0);
        for (let index = 0; index < frames; index += 1) {
          channel[index] = -ramp.peak + (2 * ramp.peak * index) / (frames - 1);
        }
        const source = context.createBufferSource();
        source.buffer = buffer;
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        source.start();
        (window as Window & { __ramblaSyntheticTrack?: MediaStreamTrack }).__ramblaSyntheticTrack =
          destination.stream.getAudioTracks()[0];
        return destination.stream;
      },
    });
  }, RAMP);
}

/**
 * Ends the synthetic microphone. The harness dispatches the event itself: a
 * track from a MediaStreamAudioDestinationNode never ends on its own, and
 * `track.stop()` deliberately does not fire `ended`. This proves the app's
 * response to the event, not a real device loss.
 */
async function endSyntheticMicrophone(page: Page): Promise<void> {
  await page.evaluate(() => {
    const track = (window as Window & { __ramblaSyntheticTrack?: MediaStreamTrack })
      .__ramblaSyntheticTrack;
    if (!track) {
      throw new Error("The synthetic microphone was never opened");
    }
    track.dispatchEvent(new Event("ended"));
  });
}

/** Owns the daemon socket so every dictation reply — including its absence — is the test's choice. */
async function installDictationHarness(
  page: Page,
  options: { onFinish: (tools: FinishTools) => void },
): Promise<DictationHarness> {
  const segments: SegmentRecord[] = [];
  const events: string[] = [];
  const createPrompts: string[] = [];
  const state: {
    socket: WebSocketRoute | null;
    dictationId: string | null;
    dropped: boolean;
  } = { socket: null, dictationId: null, dropped: false };

  let resolveFinish!: () => void;
  const finishSeen = new Promise<void>((resolve) => {
    resolveFinish = resolve;
  });
  let resolveBlockedReconnect!: () => void;
  const blockedReconnect = new Promise<void>((resolve) => {
    resolveBlockedReconnect = resolve;
  });

  await page.routeWebSocket(daemonWsRoutePattern(), (ws) => {
    if (state.dropped) {
      resolveBlockedReconnect();
      void ws.close();
      return;
    }
    state.socket = ws;
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      const request = sessionMessage(message);
      const type = request?.type;
      const dictationId = typeof request?.dictationId === "string" ? request.dictationId : null;

      if (type === "dictation_stream_start" && dictationId) {
        state.dictationId = dictationId;
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: -1 },
        });
        return;
      }
      if (type === "dictation_stream_chunk" && dictationId) {
        const seq = typeof request?.seq === "number" ? request.seq : -1;
        const audio = typeof request?.audio === "string" ? request.audio : "";
        segments.push({
          seq,
          pcm: Buffer.from(audio, "base64"),
          receivedAt: Date.now(),
        });
        sendSessionMessage(ws, {
          type: "dictation_stream_ack",
          payload: { dictationId, ackSeq: seq },
        });
        return;
      }
      if (type === "dictation_stream_finish" && dictationId) {
        resolveFinish();
        options.onFinish({
          dictationId,
          acceptFinish: (timeoutMs) => {
            sendSessionMessage(ws, {
              type: "dictation_stream_finish_accepted",
              payload: { dictationId, timeoutMs },
            });
          },
          sendFinal: (text) => {
            events.push("dictation final");
            sendSessionMessage(ws, {
              type: "dictation_stream_final",
              payload: { dictationId, text },
            });
          },
        });
        return;
      }
      // Recorded and dropped: these tests are about the send the composer made, not the
      // workspace the daemon would build from it.
      if (type === "workspace.create.request") {
        const agent = request?.agent;
        const prompt =
          agent && typeof agent === "object"
            ? (agent as { initialPrompt?: unknown }).initialPrompt
            : undefined;
        events.push("workspace create");
        createPrompts.push(typeof prompt === "string" ? prompt : "");
        return;
      }

      server.send(message);
    });

    server.onMessage((message) => ws.send(enableDictationCapability(message)));
  });

  return {
    segments,
    events,
    createPrompts,
    waitForSegments: async (count) => {
      await expect
        .poll(() => segments.length, {
          timeout: 30_000,
          message: `The app never streamed ${count} audio segments to the daemon`,
        })
        .toBeGreaterThanOrEqual(count);
    },
    waitForFinish: () => finishSeen,
    sendPartial: (text) => {
      if (!state.socket || !state.dictationId) {
        throw new Error("No dictation stream is open on the intercepted socket");
      }
      sendSessionMessage(state.socket, {
        type: "dictation_stream_partial",
        payload: { dictationId: state.dictationId, text },
      });
    },
    sendSegment: (segment) => {
      if (!state.socket || !state.dictationId) {
        throw new Error("No dictation stream is open on the intercepted socket");
      }
      // A daemon that knows the cap sends the reporting segment alone and glues nothing.
      sendSessionMessage(state.socket, {
        type: "dictation_stream_partial",
        payload: { dictationId: state.dictationId, text: "", segment },
      });
    },
    dictationId: () => state.dictationId,
    dropConnection: async () => {
      state.dropped = true;
      await state.socket?.close();
    },
    dropConnectionOnce: async () => {
      await state.socket?.close();
    },
    waitForBlockedReconnect: () => blockedReconnect,
  };
}

async function startDictation(
  page: Page,
  project: { projectKey: string; projectDisplayName: string },
): Promise<void> {
  await gotoAppShell(page);
  await waitForSidebarHydration(page);
  await openNewWorkspaceComposer(page, project);
  await selectWorkspaceIsolation(page, "local");
  await page.getByRole("button", { name: "Start dictation" }).click();
}

function composer(page: Page) {
  return page.getByRole("textbox", { name: "Message agent..." });
}

function insertButton(page: Page) {
  return page.getByRole("button", { name: "Insert transcription", exact: true });
}

function insertAndSendButton(page: Page) {
  return page.getByRole("button", { name: "Insert transcription and send" });
}

function retryButton(page: Page) {
  return page.getByRole("button", { name: "Retry dictation" });
}

function createButton(page: Page) {
  return page.getByTestId("message-input-root").getByRole("button", { name: "Create" });
}

function cancelButton(page: Page) {
  return page.getByRole("button", { name: "Cancel dictation" });
}

function startButton(page: Page) {
  return page.getByRole("button", { name: "Start dictation" });
}

/** An IME composition on the composer, which owns the field until it ends. */
async function dispatchComposition(
  page: Page,
  type: "compositionstart" | "compositionend",
): Promise<void> {
  await page.evaluate((eventType) => {
    const input = document.querySelector("textarea[data-composer-input]");
    if (!input) {
      throw new Error("The composer textarea is not mounted");
    }
    input.dispatchEvent(new CompositionEvent(eventType, { bubbles: true }));
  }, type);
}

/** Moves the caret to an absolute offset with the keyboard, the way a user reaches it. */
async function moveCaretTo(page: Page, offset: number, textLength: number): Promise<void> {
  await page.keyboard.press("End");
  for (let step = 0; step < textLength - offset; step += 1) {
    await page.keyboard.press("ArrowLeft");
  }
}

/** Blocks the page's main thread the way a long render or a long task does. */
async function jamMainThread(page: Page, durationMs: number): Promise<void> {
  await page.evaluate((ms) => {
    const deadline = performance.now() + ms;
    let spins = 0;
    while (performance.now() < deadline) {
      spins += 1;
    }
    return spins;
  }, durationMs);
}

test.describe("Dictation loss", () => {
  test.describe.configure({ timeout: 240_000 });

  test("captures the audio supplied while the main thread is blocked", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-jam-" });
    await installSyntheticMicrophone(page);
    await installAddModuleCounter(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);

      await jamMainThread(page, JAM_MS);
      await page.waitForTimeout(3_000);

      await insertButton(page).click();
      await harness.waitForFinish();

      expect(
        await readAddModuleCounter(page),
        "Capture never loaded its audio worklet, so this measured some other capture path",
      ).toEqual({ calls: 1, resolved: 1, urls: ["/rambla-audio-capture-processor.js"] });

      const seqs = harness.segments.map((segment) => segment.seq);
      expect(
        seqs,
        "The dictation stream restarted mid-recording, so the segments are not one contiguous recording",
      ).toEqual(seqs.map((_, index) => index));

      // The first segment opens with silence recorded before the stream carried
      // audio, so the ramp cannot place it.
      const analysed = harness.segments.slice(1);
      const suppliedStarts = analysed.map((segment) => rampPositionMs(segment.pcm.readInt16LE(0)));

      // Validity check on a segment captured before the jam: if the ramp
      // survived, one second of audio spans one second of ramp.
      const reference = analysed[0];
      const referenceSpanMs =
        rampPositionMs(reference.pcm.readInt16LE(reference.pcm.length - 2)) - suppliedStarts[0];
      const referenceDurationMs = ((reference.pcm.length / 2 - 1) / CAPTURE_RATE) * 1_000;
      expect(
        Math.abs(referenceSpanMs - referenceDurationMs),
        `The supplied ramp did not survive the capture path: the first full segment holds ${Math.round(referenceDurationMs)} ms of audio but spans ${Math.round(referenceSpanMs)} ms of ramp, so captured audio cannot be located in the supplied signal`,
      ).toBeLessThanOrEqual(CAPTURE_TOLERANCE_MS);

      let expectedStart = suppliedStarts[0];
      let worstDriftMs = 0;
      const drifts: number[] = [];
      for (const [index, segment] of analysed.entries()) {
        const drift = suppliedStarts[index] - expectedStart;
        drifts.push(Math.round(drift));
        worstDriftMs = Math.max(worstDriftMs, Math.abs(drift));
        expectedStart += (segment.pcm.length / 2 / CAPTURE_RATE) * 1_000;
      }

      expect(
        Math.round(worstDriftMs),
        `Captured audio does not match the audio supplied around a ${JAM_MS} ms main-thread block. Each segment should start where the previous one ended; measured offsets into the supplied audio were ${drifts.join(", ")} ms, so the recording runs up to ${Math.round(worstDriftMs)} ms away from what the microphone supplied`,
      ).toBeLessThanOrEqual(CAPTURE_TOLERANCE_MS);
    } finally {
      await seeded.cleanup();
    }
  });

  test("streams the audio captured right before the press that ends the recording", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-tail-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);
      // Press part way into a segment, so the audio under test is the part the
      // capture still held rather than one that had already been sent.
      await harness.waitForSegments(harness.segments.length + 1);
      const streamedBeforePress = harness.segments.length;
      await page.waitForTimeout(400);

      // The pencil and the arrow share every line up to the transcript.
      await insertButton(page).click();
      await harness.waitForFinish();

      const tail = harness.segments.slice(streamedBeforePress);
      expect(
        tail.length,
        "Nothing was streamed after the press, so the audio spoken into the last part-second of the recording never reached the daemon",
      ).toBeGreaterThan(0);

      const last = harness.segments[streamedBeforePress - 1];
      const spokenBefore = rampPositionMs(last.pcm.readInt16LE(last.pcm.length - 2));
      const tailStart = rampPositionMs(tail[0].pcm.readInt16LE(0));
      expect(
        Math.round(tailStart - spokenBefore),
        `The audio streamed after the press does not continue the recording: the previous segment ended at ${Math.round(spokenBefore)} ms of the supplied audio and the tail starts at ${Math.round(tailStart)} ms`,
      ).toBeLessThanOrEqual(CAPTURE_TOLERANCE_MS);
    } finally {
      await seeded.cleanup();
    }
  });

  test("reports a microphone that ends mid-dictation instead of falling silent", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-device-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);

      await endSyntheticMicrophone(page);

      await expect(
        retryButton(page),
        "A microphone that ends mid-dictation must report a failure and keep the audio, not leave the user talking into nothing",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await seeded.cleanup();
    }
  });

  test("reports an empty final transcript instead of accepting it", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-empty-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal("");
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);

      await insertButton(page).click();
      await harness.waitForFinish();

      await expect(
        retryButton(page),
        "An empty final transcript must be reported and the recorded audio kept for retry",
      ).toBeVisible({ timeout: 15_000 });
      await expect(composer(page)).toHaveValue("");
    } finally {
      await seeded.cleanup();
    }
  });

  test("reports a truncated final transcript instead of accepting it", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-truncated-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(TRUNCATED);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);
      harness.sendPartial(SPOKEN);

      await insertButton(page).click();
      await harness.waitForFinish();

      await expect(
        retryButton(page),
        `The daemon returned "${TRUNCATED}" after reporting "${SPOKEN}"; a final that drops the ending must be reported, not accepted as complete`,
      ).toBeVisible({ timeout: 15_000 });
      await expect(composer(page)).not.toHaveValue(TRUNCATED);
    } finally {
      await seeded.cleanup();
    }
  });

  test("reports a missing final transcript instead of waiting indefinitely", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-silent-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: () => {
        // The daemon never answers the finish.
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);

      await insertButton(page).click();
      await harness.waitForFinish();

      await expect(
        insertButton(page),
        "The dictation never entered its processing state, so the missing reply was not actually awaited",
      ).toHaveCount(0);
      await expect(
        retryButton(page),
        "A daemon that never answers the finish must surface a timeout or an error, not leave the dictation processing with every control disabled",
        // A silent daemon costs 15 s waiting for the finish to be taken and 10 s more for
        // the text, so the error is up at ~25 s and this wait is not a boundary race.
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      await seeded.cleanup();
    }
  });

  test("lands dictated words in the field while the user types before and inside them", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-live-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);

      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(
        composer(page),
        "A partial's words never reached the field, so nothing appears while the user speaks",
      ).toHaveValue("one two");

      await composer(page).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("Hi ");
      await expect(
        composer(page),
        "The field was not editable during dictation, or the typing was swallowed",
      ).toHaveValue("Hi one two");

      harness.sendSegment({ id: "seg-1", index: 0, text: "one two three", isFinal: false });
      await expect(
        composer(page),
        "The next partial overwrote what the user typed before the dictated words",
      ).toHaveValue("Hi one two three");

      await moveCaretTo(page, 6, "Hi one two three".length);
      await page.keyboard.type("!");
      await expect(composer(page)).toHaveValue("Hi one! two three");

      harness.sendSegment({ id: "seg-1", index: 0, text: "one two three four", isFinal: false });
      await expect(
        composer(page),
        "A partial after an edit inside the dictated words must append past it and rewrite nothing before it",
      ).toHaveValue("Hi one! two three four");
    } finally {
      await seeded.cleanup();
    }
  });

  test("sends once, after the final, when send is pressed mid-recording", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-send-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await createButton(page).click();
      await harness.waitForFinish();

      await expect
        .poll(() => harness.events, {
          timeout: 20_000,
          message:
            "Pressing send while recording must stop the dictation and send once the final has landed",
        })
        .toEqual(["dictation final", "workspace create"]);
      expect(
        harness.createPrompts,
        "The final re-appended words the partials had already put in the field",
      ).toEqual(["one two"]);
    } finally {
      await seeded.cleanup();
    }
  });

  test("keeps the dictated words as they are when the recording is stopped", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-stop-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await insertButton(page).click();
      await harness.waitForFinish();

      await expect(
        startButton(page),
        "The recording never stopped, so what the field holds afterwards is not settled",
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        composer(page),
        `The final re-appended the whole transcript "${SPOKEN}" over words the partials had already placed`,
      ).toHaveValue("one two");

      // A second dictation starts its own region at the caret, which is wherever the user left it,
      // and leaves the first one's words alone.
      await composer(page).click();
      await page.keyboard.press("End");
      await page.keyboard.type(" ");
      await startButton(page).click();
      await harness.waitForSegments(harness.segments.length + 1);
      harness.sendSegment({ id: "seg-2", index: 0, text: "three four", isFinal: false });
      await expect(composer(page)).toHaveValue("one two three four");
    } finally {
      await seeded.cleanup();
    }
  });

  test("deletes nothing when the recording is cancelled", async ({ page }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-cancel-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await composer(page).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("Hi ");
      await expect(composer(page)).toHaveValue("Hi one two");

      await cancelButton(page).click();

      await expect(
        startButton(page),
        "Cancel did not stop the recording, so the field's contents afterwards prove nothing",
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        composer(page),
        "Cancelling deleted text: the dictated words and the user's own typing must both survive",
      ).toHaveValue("Hi one two");
    } finally {
      await seeded.cleanup();
    }
  });

  test("keeps the pending words when the final is empty and when the failure is discarded", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-empty-pending-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal("");
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await insertButton(page).click();
      await harness.waitForFinish();

      await expect(retryButton(page)).toBeVisible({ timeout: 15_000 });
      await expect(
        composer(page),
        "An empty final must leave the words the partials already placed in the field alone",
      ).toHaveValue("one two");

      await cancelButton(page).click();
      await expect(
        startButton(page),
        "The failure was never discarded, so the field's contents afterwards prove nothing",
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        composer(page),
        "Discarding a failed dictation deleted the words already in the field",
      ).toHaveValue("one two");
    } finally {
      await seeded.cleanup();
    }
  });

  test("rebuilds the dictated words from scratch when a failed dictation is retried", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-retry-" });
    await installSyntheticMicrophone(page);
    let finishes = 0;
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        finishes += 1;
        tools.acceptFinish(5_000);
        // The first finish fails the dictation so it can be retried; the retry's own finish is
        // left open, so the rebuilt region is what the test observes.
        if (finishes === 1) tools.sendFinal("");
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await composer(page).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("Hi ");
      await moveCaretTo(page, 6, "Hi one two".length);
      await page.keyboard.type("!");
      await expect(composer(page)).toHaveValue("Hi one! two");

      await insertButton(page).click();
      await expect(retryButton(page)).toBeVisible({ timeout: 15_000 });

      await retryButton(page).click();
      await expect(
        composer(page),
        "Retry re-sends the whole recording, so the dictated region must be spliced out while the text around it survives",
      ).toHaveValue("Hi ");

      harness.sendSegment({ id: "seg-9", index: 0, text: "one two three", isFinal: false });
      await expect(
        composer(page),
        "The retried recording's words did not rebuild the region, or the edit made inside the old one came back",
      ).toHaveValue("Hi one two three");
    } finally {
      await seeded.cleanup();
    }
  });

  test("rebuilds the dictated words from scratch when the socket reconnects mid-recording", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-reconnect-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await composer(page).click();
      await page.keyboard.press("Home");
      await page.keyboard.type("Hi ");
      await expect(composer(page)).toHaveValue("Hi one two");

      const droppedDictationId = harness.dictationId();
      await harness.dropConnectionOnce();

      await expect(
        composer(page),
        "A reconnect re-sends the whole recording, so the dictated region must be spliced out while the text around it survives",
      ).toHaveValue("Hi ", { timeout: 30_000 });

      await expect
        .poll(() => harness.dictationId(), {
          timeout: 30_000,
          message: "The app never opened a new dictation stream after the reconnect",
        })
        .not.toBe(droppedDictationId);

      harness.sendSegment({ id: "seg-7", index: 0, text: "one two three", isFinal: false });
      await expect(
        composer(page),
        "The re-transcribed words did not rebuild the region after the reconnect",
      ).toHaveValue("Hi one two three");
    } finally {
      await seeded.cleanup();
    }
  });

  test("skips a dictation write during an IME composition and repairs it on the next partial", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-ime-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(1);
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two", isFinal: false });
      await expect(composer(page)).toHaveValue("one two");

      await composer(page).click();
      await dispatchComposition(page, "compositionstart");
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two three", isFinal: false });
      // The composition owns the field, so this partial must not reach it.
      await page.waitForTimeout(500);
      await expect(
        composer(page),
        "A write landed during an IME composition, which discards what the user was composing",
      ).toHaveValue("one two");

      await dispatchComposition(page, "compositionend");
      harness.sendSegment({ id: "seg-1", index: 0, text: "one two three four", isFinal: false });
      await expect(
        composer(page),
        "The partial after the composition did not repair the write that was skipped",
      ).toHaveValue("one two three four");
    } finally {
      await seeded.cleanup();
    }
  });

  test("reports a submit made while the socket is down instead of doing nothing", async ({
    page,
  }) => {
    const seeded = await seedWorkspace({ repoPrefix: "dictation-offline-" });
    await installSyntheticMicrophone(page);
    const harness = await installDictationHarness(page, {
      onFinish: (tools) => {
        tools.acceptFinish(5_000);
        tools.sendFinal(SPOKEN);
      },
    });

    try {
      await startDictation(page, seeded);
      await harness.waitForSegments(2);

      await harness.dropConnection();
      await harness.waitForBlockedReconnect();

      await expect(
        insertAndSendButton(page),
        "The dictation was gone before the submit press, so the press could not be the thing under test",
      ).toBeVisible();
      await insertAndSendButton(page).click();

      await expect(
        retryButton(page),
        "Submitting a dictation while the socket is down must report a failure and keep the audio, not silently do nothing",
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await seeded.cleanup();
    }
  });
});
