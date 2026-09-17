import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { installAddModuleCounter, readAddModuleCounter } from "../support/helpers/audio-worklet";

/** Served from `packages/app/public/`, which every web target exposes at the site root. */
const PROCESSOR_URL = "/rambla-audio-capture-processor.js";
const PROCESSOR_NAME = "rambla-audio-capture";

test.describe("Audio capture worklet loading", () => {
  test("loads the capture processor from the app origin and constructs its node", async ({
    page,
  }) => {
    await installAddModuleCounter(page);
    await gotoAppShell(page);

    const inputs = await page.evaluate(
      async ({ url, name }) => {
        const context = new AudioContext();
        try {
          await context.audioWorklet.addModule(url);
          // Constructing against an unregistered name throws, so reaching the
          // node at all is the proof that the processor script ran.
          const node = new AudioWorkletNode(context, name, {
            processorOptions: {
              outputSampleRate: 16_000,
              segmentFrames: 16_000,
              volumeEveryQuanta: 16,
            },
          });
          return node.numberOfInputs;
        } finally {
          await context.close();
        }
      },
      { url: PROCESSOR_URL, name: PROCESSOR_NAME },
    );

    expect(inputs).toBe(1);
    expect(await readAddModuleCounter(page)).toEqual({
      calls: 1,
      resolved: 1,
      urls: [PROCESSOR_URL],
    });
  });
});
