// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: tests for the composer height pin/live store.
import { describe, expect, it } from "vitest";
import {
  createComposerHeightStore,
  DEFAULT_PINNED_HEIGHT,
  MIN_PINNED_HEIGHT,
  type ValidatedStringStorage,
} from "./composer-height-store.rambla";

function createFakeStorage(initial: Record<string, string> = {}): ValidatedStringStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    async getItem(key: string) {
      return data.get(key) ?? null;
    },
    async setItem(key: string, value: string) {
      data.set(key, value);
    },
    async removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe("composer-height-store", () => {
  it("returns the fixed 3-line default when never pinned", () => {
    const store = createComposerHeightStore(createFakeStorage());
    expect(store.resolveRenderBounds(800)).toEqual({
      minHeight: DEFAULT_PINNED_HEIGHT,
      maxHeight: DEFAULT_PINNED_HEIGHT,
    });
    expect(store.getState()).toEqual({ pinnedHeight: null, liveHeight: null });
  });

  it("clamps setLiveHeight to [MIN_PINNED_HEIGHT, windowHeight]", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.setLiveHeight(10, 800);
    expect(store.getState().liveHeight).toBe(MIN_PINNED_HEIGHT);
    store.setLiveHeight(5000, 800);
    expect(store.getState().liveHeight).toBe(800);
    store.setLiveHeight(300, 800);
    expect(store.getState().liveHeight).toBe(300);
  });

  it("renders live height unclamped by resolveRenderBounds", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.setLiveHeight(300, 800);
    expect(store.resolveRenderBounds(800)).toEqual({ minHeight: 300, maxHeight: 300 });
  });

  it("pins the live height and clears live on release", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.setLiveHeight(320, 800);
    store.pinLiveHeight(800);
    expect(store.getState()).toEqual({ pinnedHeight: 320, liveHeight: null });
    expect(store.resolveRenderBounds(800)).toEqual({ minHeight: 320, maxHeight: 320 });
  });

  it("pinLiveHeight is a no-op without a live height", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.pinLiveHeight(800);
    expect(store.getState().pinnedHeight).toBeNull();
  });

  it("clamps the pinned value at pin time", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.setLiveHeight(300, 500);
    store.pinLiveHeight(200);
    expect(store.getState().pinnedHeight).toBe(200);
  });

  it("re-clamps a stale pin against the current window height (rotation)", () => {
    const storage = createFakeStorage();
    const store = createComposerHeightStore(storage);
    store.setLiveHeight(800, 800);
    store.pinLiveHeight(800);
    expect(store.resolveRenderBounds(400)).toEqual({ minHeight: 400, maxHeight: 400 });
    expect(store.getState().pinnedHeight).toBe(800);
  });

  it("restoreDefault returns to the fixed default and is a no-op when already default", () => {
    const store = createComposerHeightStore(createFakeStorage());
    store.setLiveHeight(300, 800);
    store.pinLiveHeight(800);
    store.restoreDefault();
    expect(store.resolveRenderBounds(800)).toEqual({
      minHeight: DEFAULT_PINNED_HEIGHT,
      maxHeight: DEFAULT_PINNED_HEIGHT,
    });
    store.restoreDefault();
    expect(store.getState()).toEqual({ pinnedHeight: null, liveHeight: null });
  });

  it("persisted value survives a fresh store load; liveHeight never persists", async () => {
    const storage = createFakeStorage();
    const store = createComposerHeightStore(storage);
    store.setLiveHeight(320, 800);
    store.pinLiveHeight(800);
    store.setLiveHeight(123, 800);
    const persisted = JSON.parse(storage.data.get("@rambla:composer-height") ?? "");
    expect(persisted).toBe(320);

    const reloaded = createComposerHeightStore(storage);
    await reloaded.hydrate();
    expect(reloaded.getState()).toEqual({ pinnedHeight: 320, liveHeight: null });
  });

  it("loads garbage as null", async () => {
    const storage = createFakeStorage({ "@rambla:composer-height": "not-a-number" });
    const store = createComposerHeightStore(storage);
    await store.hydrate();
    expect(store.getState().pinnedHeight).toBeNull();
  });

  it("restoreDefault removes the persisted value", async () => {
    const storage = createFakeStorage();
    const store = createComposerHeightStore(storage);
    store.setLiveHeight(300, 800);
    store.pinLiveHeight(800);
    store.restoreDefault();
    const reloaded = createComposerHeightStore(storage);
    await reloaded.hydrate();
    expect(reloaded.getState().pinnedHeight).toBeNull();
  });
});
