// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: tests the persisted explicit composer height store.
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
// The existing viewport bound: max(default, 50% of the window), matching input.rambla.tsx.
const VIEWPORT_BOUND = resolveComposerViewportBound(WINDOW_HEIGHT);

describe("composer height store", () => {
  beforeEach(() => {
    useComposerHeightStore.setState({ explicitHeight: null });
  });

  it("resolves auto-grow min/max without an explicit height and pins with one", () => {
    expect(resolveComposerHeightArgs(null, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: 46,
      maxHeight: VIEWPORT_BOUND,
    });
    expect(
      resolveComposerHeightArgs(VIEWPORT_BOUND + 500, VIEWPORT_BOUND, LINE_HEIGHT, 46),
    ).toEqual({ minHeight: VIEWPORT_BOUND, maxHeight: VIEWPORT_BOUND });
    expect(resolveComposerHeightArgs(10, VIEWPORT_BOUND, LINE_HEIGHT, 46)).toEqual({
      minHeight: MIN_COMPOSER_HEIGHT_LINES * LINE_HEIGHT,
      maxHeight: MIN_COMPOSER_HEIGHT_LINES * LINE_HEIGHT,
    });
  });

  it("defaults to the null sentinel meaning today's auto-grow", () => {
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
  });

  it("quantizes the setter to whole text lines", () => {
    useComposerHeightStore.getState().setExplicitHeight(45, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(40);
  });

  it("clamps the setter to a minimum of 2 lines", () => {
    useComposerHeightStore.getState().setExplicitHeight(10, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(2 * LINE_HEIGHT);
  });

  it("clamps the setter to the viewport bound", () => {
    useComposerHeightStore.getState().setExplicitHeight(10000, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(VIEWPORT_BOUND);
  });

  it("quantizes the viewport bound down to a whole line when it is not a multiple", () => {
    useComposerHeightStore.getState().setExplicitHeight(10000, VIEWPORT_BOUND + 5, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(VIEWPORT_BOUND);
  });

  it("applies a delta from the app default when no explicit height is stored", () => {
    useComposerHeightStore
      .getState()
      .setExplicitHeightDelta(LINE_HEIGHT, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(
      DEFAULT_COMPOSER_MAX_INPUT_HEIGHT + LINE_HEIGHT,
    );
  });

  it("applies a delta from the stored height in both directions", () => {
    useComposerHeightStore.getState().setExplicitHeight(200, VIEWPORT_BOUND, LINE_HEIGHT);
    useComposerHeightStore
      .getState()
      .setExplicitHeightDelta(-LINE_HEIGHT, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(180);

    useComposerHeightStore
      .getState()
      .setExplicitHeightDelta(LINE_HEIGHT, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(200);
  });

  it("clamps the delta at both ends", () => {
    useComposerHeightStore.getState().setExplicitHeightDelta(10000, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(VIEWPORT_BOUND);

    useComposerHeightStore.getState().setExplicitHeightDelta(-10000, VIEWPORT_BOUND, LINE_HEIGHT);
    expect(useComposerHeightStore.getState().explicitHeight).toBe(2 * LINE_HEIGHT);
  });

  it("reset returns to the null sentinel and today's auto-grow", () => {
    useComposerHeightStore.getState().setExplicitHeight(300, VIEWPORT_BOUND, LINE_HEIGHT);
    useComposerHeightStore.getState().resetExplicitHeight();
    expect(useComposerHeightStore.getState().explicitHeight).toBeNull();
  });

  it("toggles between the null sentinel and the viewport bound", () => {
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

  it("persists the explicit height and reads it back through the schema", async () => {
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
