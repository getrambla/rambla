// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: tests the persisted composer ceiling store.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  COMPOSER_HEIGHT_STORE_VERSION,
  DEFAULT_COMPOSER_MAX_INPUT_HEIGHT,
  useComposerHeightStore,
  type ComposerHeightPersistedState,
} from "./composer-height-store.rambla";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));

function createMemoryStorage(entries: Record<string, string>): StateStorage {
  return {
    getItem: async (name) => entries[name] ?? null,
    setItem: async (name, value) => {
      entries[name] = value;
    },
    removeItem: async (name) => {
      delete entries[name];
    },
  };
}

const WINDOW_HEIGHT = 800;
// The existing viewport bound: max(default, 50% of the window), from input.rambla.tsx.
const VIEWPORT_BOUND = Math.max(DEFAULT_COMPOSER_MAX_INPUT_HEIGHT, Math.floor(WINDOW_HEIGHT * 0.5));

describe("composer height store", () => {
  beforeEach(() => {
    useComposerHeightStore.setState({ userMaxInputHeight: null });
  });

  it("defaults to the null sentinel meaning the app default", () => {
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBeNull();
  });

  it("clamps the setter to the viewport bound and the app default minimum", () => {
    useComposerHeightStore.getState().setUserMaxInputHeight(10000, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(VIEWPORT_BOUND);

    useComposerHeightStore.getState().setUserMaxInputHeight(10, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT,
    );
  });

  it("keeps a previous ceiling when the setter is clamped with a smaller viewport bound", () => {
    useComposerHeightStore.getState().setUserMaxInputHeight(400, 800);
    useComposerHeightStore.getState().setUserMaxInputHeight(400, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(400);
  });

  it("reset returns to the null sentinel", () => {
    useComposerHeightStore.getState().setUserMaxInputHeight(400, VIEWPORT_BOUND);
    useComposerHeightStore.getState().resetUserMaxInputHeight();
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBeNull();
  });

  it("applies a delta from the app default when no ceiling is stored", () => {
    useComposerHeightStore.getState().setUserMaxInputHeightDelta(-40, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT + 40,
    );
  });

  it("applies a delta from the stored ceiling", () => {
    useComposerHeightStore.getState().setUserMaxInputHeight(300, VIEWPORT_BOUND);
    useComposerHeightStore.getState().setUserMaxInputHeightDelta(-40, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(340);

    useComposerHeightStore.getState().setUserMaxInputHeightDelta(40, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(300);
  });

  it("clamps the delta-applied ceiling at both ends", () => {
    useComposerHeightStore.getState().setUserMaxInputHeightDelta(10000, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT,
    );

    useComposerHeightStore.getState().setUserMaxInputHeightDelta(-10000, VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(VIEWPORT_BOUND);
  });

  it("toggles between the null sentinel and the viewport bound", () => {
    useComposerHeightStore.getState().toggleUserMaxInputHeight(VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBe(VIEWPORT_BOUND);

    useComposerHeightStore.getState().toggleUserMaxInputHeight(VIEWPORT_BOUND);
    expect(useComposerHeightStore.getState().userMaxInputHeight).toBeNull();
  });

  it("persists the ceiling and reads it back through the schema", async () => {
    const entries: Record<string, string> = {};
    const { createComposerHeightPersistStorage } = await import("./composer-height-store.rambla");
    const storage = createComposerHeightPersistStorage(createMemoryStorage(entries));

    await storage.setItem("composer-height", { state: { userMaxInputHeight: 320 }, version: 1 });

    const raw = entries["composer-height"];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { state: ComposerHeightPersistedState };
    expect(parsed.state.userMaxInputHeight).toBe(320);

    const restored = await storage.getItem("composer-height");
    expect(restored).not.toBeNull();
    expect(restored!.state).toEqual({ userMaxInputHeight: 320 });
    expect(COMPOSER_HEIGHT_STORE_VERSION).toBe(1);
  });

  it("drops persisted state that fails the schema", async () => {
    const entries: Record<string, string> = {};
    const { createComposerHeightPersistStorage } = await import("./composer-height-store.rambla");
    const storage = createComposerHeightPersistStorage(createMemoryStorage(entries));

    await storage.setItem("composer-height", {
      state: { userMaxInputHeight: "tall" } as unknown as ComposerHeightPersistedState,
      version: 1,
    });
    expect(await storage.getItem("composer-height")).toBeNull();

    const migrated = useComposerHeightStore.persist.getOptions().migrate;
    expect(migrated?.({ userMaxInputHeight: "tall" }, 1)).toEqual({
      userMaxInputHeight: null,
    });
    expect(migrated?.({ userMaxInputHeight: 240 }, 1)).toEqual({ userMaxInputHeight: 240 });
  });
});
