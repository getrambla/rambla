import { beforeEach, describe, expect, it, vi } from "vitest";

// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: mocks AsyncStorage for the height store tests.
vi.mock("@react-native-async-storage/async-storage", () => {
  const storage = new Map<string, string>();
  return {
    default: {
      getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
      setItem: vi.fn(async (key: string, value: string) => {
        storage.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        storage.delete(key);
      }),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  COMPOSER_HEIGHT_STORAGE_KEY,
  createComposerHeightStore,
} from "./composer-height-store.rambla";

const BOUNDS = { min: 40, max: 400 };

async function createLoadedStore() {
  const store = createComposerHeightStore({ defaultHeight: 100 });
  await store.load(BOUNDS);
  return store;
}

beforeEach(() => {
  vi.mocked(AsyncStorage.removeItem).mockClear();
});

describe("composer height store clamping", () => {
  it("clamps a set height above max to max", async () => {
    const store = await createLoadedStore();
    store.setHeight(500, BOUNDS);
    expect(store.getHeight()).toBe(400);
  });

  it("clamps a set height below min to min", async () => {
    const store = await createLoadedStore();
    store.setHeight(10, BOUNDS);
    expect(store.getHeight()).toBe(40);
  });

  it("keeps an in-range height unchanged", async () => {
    const store = await createLoadedStore();
    store.setHeight(250, BOUNDS);
    expect(store.getHeight()).toBe(250);
  });
});

describe("composer height store loading", () => {
  it("falls back to the default height when nothing is stored", async () => {
    const store = await createLoadedStore();
    expect(store.getHeight()).toBe(100);
  });

  it("falls back to the default height when the stored value is garbage", async () => {
    await AsyncStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, "not-a-number");
    const store = await createLoadedStore();
    expect(store.getHeight()).toBe(100);
  });

  it("re-clamps a restored height against fresh bounds", async () => {
    await AsyncStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, JSON.stringify(900));
    const store = await createLoadedStore();
    expect(store.getHeight()).toBe(400);
  });
});

describe("composer height store persistence", () => {
  it("persists a set height and round-trips it through a fresh store", async () => {
    const store = await createLoadedStore();
    store.setHeight(280, BOUNDS);
    await store.persist();

    const next = createComposerHeightStore({ defaultHeight: 100 });
    await next.load(BOUNDS);
    expect(next.getHeight()).toBe(280);
  });

  it("clears an invalid stored value instead of loading it", async () => {
    await AsyncStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, "{oops");
    await createLoadedStore();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(COMPOSER_HEIGHT_STORAGE_KEY);
  });
});
