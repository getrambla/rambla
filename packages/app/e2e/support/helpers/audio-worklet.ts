import { type Page } from "@playwright/test";

export interface AddModuleCounter {
  calls: number;
  resolved: number;
  urls: string[];
}

const COUNTER_KEY = "__ramblaAddModuleCounter";

/**
 * Counts `AudioWorklet.addModule` calls, so a test can prove capture ran on the
 * audio thread rather than inferring it from the shape of the captured audio.
 */
export const installAddModuleCounter = async (page: Page): Promise<void> => {
  await page.addInitScript((key) => {
    const counter: AddModuleCounter = { calls: 0, resolved: 0, urls: [] };
    (window as unknown as Record<string, unknown>)[key] = counter;
    const original = AudioWorklet.prototype.addModule;
    AudioWorklet.prototype.addModule = async function patchedAddModule(url, options) {
      counter.calls += 1;
      counter.urls.push(String(url));
      await original.call(this, url, options);
      counter.resolved += 1;
    };
  }, COUNTER_KEY);
};

export const readAddModuleCounter = async (page: Page): Promise<AddModuleCounter> =>
  await page.evaluate(
    (key) => (window as unknown as Record<string, AddModuleCounter>)[key],
    COUNTER_KEY,
  );
