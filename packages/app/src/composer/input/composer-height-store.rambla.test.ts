// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: tests the pinned composer height store and its live drag state.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StateStorage } from "zustand/middleware";
import {
  COMPOSER_HEIGHT_STORE_VERSION,
  DEFAULT_COMPOSER_MAX_INPUT_HEIGHT,
  MIN_COMPOSER_HEIGHT_LINES,
  resolveComposerHeightArgs,
  resolveComposerViewportBound,
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

const LINE_HEIGHT = 20;
const WINDOW_HEIGHT = 800;
// The v3 bound is the window itself: the box may grow to the top of the window.
const VIEWPORT_BOUND = resolveComposerViewportBound(WINDOW_HEIGHT);

describe("composer height store", () => {
  beforeEach(() => {
    useComposerHeightStore.setState({ explicitHeight: null, dragHeight: null });
  });

  it("resolves the three render states", () => {
    // Live drag: 1-line minimum, no max beyond the window.
    expect(resolveComposerHeightArgs(null, 120, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: MIN_COMPOSER_HEIGHT_LINES * LINE_HEIGHT,
      maxHeight: VIEWPORT_BOUND,
    });
    // Pinned: min = max = the pinned height.
    expect(resolveComposerHeightArgs(240, null, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: 240,
      maxHeight: 240,
    });
    // Null: today's auto-grow, byte-identical values.
    expect(resolveComposerHeightArgs(null, null, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: 46,
      maxHeight: VIEWPORT_BOUND,
    });
  });

  it("re-clamps a pinned height taller than the window on rotation", () => {
    expect(resolveComposerHeightArgs(1200, null, 400, LINE_HEIGHT, 46)).toEqual({
      minHeight: 400,
      maxHeight: 400,
    });
    // And re-quantizes the bound down to a whole line when it is not a multiple.
    expect(resolveComposerHeightArgs(1200, null, 405, LINE_HEIGHT, 46)).toEqual({
      minHeight: 400,
      maxHeight: 400,
    });
  });

  it("defaults to the null sentinel meaning today's auto-grow", () => {
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
    expect(useComposerHeightStore.getState().dragHeight).toBeNull();
  });

  it("tracks the live drag height quantized to whole text lines", () => {
    useComposerHeightStore.getState().setDragHeight(45, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(40);
    useComposerHeightStore.getState().setDragHeight(82, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(80);
  });

  it("floors the live drag height at 1 text line", () => {
    useComposerHeightStore.getState().setDragHeight(5, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(
      MIN_COMPOSER_HEIGHT_LINES * LINE_HEIGHT,
    );
    useComposerHeightStore.getState().setDragHeight(-500, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(
      MIN_COMPOSER_HEIGHT_LINES * LINE_HEIGHT,
    );
  });

  it("applies no maximum to the live drag height beyond the window", () => {
    useComposerHeightStore.getState().setDragHeight(VIEWPORT_BOUND + 500, LINE_HEIGHT);
    // No ceiling clamp: the window top is enforced at render, not in the drag setter.
    expect(useComposerHeightStore.getState().dragHeight).toBe(
      Math.floor((VIEWPORT_BOUND + 500) / LINE_HEIGHT) * LINE_HEIGHT,
    );
  });

  it("starts a delta drag from the pinned height, else the app default", () => {
    useComposerHeightStore.getState().setDragHeightDelta(LINE_HEIGHT, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT + LINE_HEIGHT,
    );

    useComposerHeightStore.getState().pinDragHeight();
    expect(useComposerHeightStore.getState().explicitHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT + LINE_HEIGHT,
    );

    useComposerHeightStore.getState().setDragHeightDelta(-LINE_HEIGHT, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(DEFAULT_COMPOSER_MAX_INPUT_HEIGHT);
  });

  it("pins on release: min = max = the height the box was left at, drag session ends", () => {
    useComposerHeightStore.getState().setDragHeight(200, LINE_HEIGHT);
    useComposerHeightStore.getState().pinDragHeight();
    expect(useComposerHeightStore.getState().explicitHeight).toBe(200);
    expect(useComposerHeightStore.getState().dragHeight).toBeNull();

    // Pinned min=max must not fight the next drag: deltas quantize against the live
    // height, not the pinned one, so a downward drag can recover.
    useComposerHeightStore.getState().setDragHeightDelta(LINE_HEIGHT, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().dragHeight).toBe(220);
  });

  it("pins only when a drag is live", () => {
    useComposerHeightStore.getState().pinDragHeight();
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
  });

  it("reset returns to the null sentinel and today's auto-grow", () => {
    useComposerHeightStore.getState().setDragHeight(300, LINE_HEIGHT);
    useComposerHeightStore.getState().pinDragHeight();
    useComposerHeightStore.getState().resetExplicitHeight();
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
    expect(resolveComposerHeightArgs(null, null, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: 46,
      maxHeight: VIEWPORT_BOUND,
    });
  });

  it("toggles between the null sentinel and the window bound", () => {
    useComposerHeightStore.getState().toggleExplicitHeight(VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(VIEWPORT_BOUND);

    useComposerHeightStore.getState().toggleExplicitHeight(VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
  });

  it("migrates v1 ceiling-shaped values to the null sentinel", () => {
    const migrate = useComposerHeightStore.persist.getOptions().migrate;
    expect(migrate?.({ userMaxInputHeight: 320 }, 1)).toEqual({ explicitHeight: null });
  });

  it("passes v2-shaped state through migration and drops invalid state", () => {
    const migrate = useComposerHeightStore.persist.getOptions().migrate;
    expect(migrate?.({ explicitHeight: 240 }, 2)).toEqual({ explicitHeight: 240 });
    expect(migrate?.({ explicitHeight: "tall" }, 2)).toEqual({ explicitHeight: null });
  });

  it("persists the pinned height and reads it back through the schema", async () => {
    const entries: Record<string, string> = {};
    const { createComposerHeightPersistStorage } = await import("./composer-height-store.rambla");
    const storage = createComposerHeightPersistStorage(createMemoryStorage(entries));

    await storage.setItem("composer-height", {
      state: { explicitHeight: 240 } satisfies ComposerHeightPersistedState,
      version: COMPOSER_HEIGHT_STORE_VERSION,
    });

    const raw = entries["composer-height"];
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw!) as { state: ComposerHeightPersistedState };
    expect(parsed.state.explicitHeight).toBe(240);

    const restored = await storage.getItem("composer-height");
    expect(restored).not.toBeNull();
    expect(restored!.state).toEqual({ explicitHeight: 240 });
    expect(COMPOSER_HEIGHT_STORE_VERSION).toBe(2);
  });

  it("never persists the live drag height", async () => {
    const entries: Record<string, string> = {};
    const { createComposerHeightPersistStorage } = await import("./composer-height-store.rambla");
    const storage = createComposerHeightPersistStorage(createMemoryStorage(entries));

    useComposerHeightStore.getState().setDragHeight(200, LINE_HEIGHT);
    await storage.setItem("composer-height", {
      state: { explicitHeight: useComposerHeightStore.getState().explicitHeight },
      version: COMPOSER_HEIGHT_STORE_VERSION,
    });
    const parsed = JSON.parse(entries["composer-height"]!) as {
      state: ComposerHeightPersistedState;
    };
    expect(parsed.state).toEqual({ explicitHeight: null });
    expect("dragHeight" in parsed.state).toBe(false);
  });

  it("drops persisted state that fails the schema", async () => {
    const entries: Record<string, string> = {};
    const { createComposerHeightPersistStorage } = await import("./composer-height-store.rambla");
    const storage = createComposerHeightPersistStorage(createMemoryStorage(entries));

    await storage.setItem("composer-height", {
      state: { explicitHeight: "tall" } as unknown as ComposerHeightPersistedState,
      version: COMPOSER_HEIGHT_STORE_VERSION,
    });
    expect(await storage.getItem("composer-height")).toBeNull();
  });
});
