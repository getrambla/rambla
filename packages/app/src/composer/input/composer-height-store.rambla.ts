// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: persisted explicit composer height (null = today's auto-grow).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type PersistStorage, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const COMPOSER_HEIGHT_STORAGE_KEY = "composer-height";
export const COMPOSER_HEIGHT_STORE_VERSION = 2;

/**
 * The app's existing default max composer height (`DEFAULT_MAX_INPUT_HEIGHT` in
 * input.rambla.tsx), kept here so deltas can grow from it without importing from the
 * component file. Only used as the starting point for drags from the auto-grow state.
 */
export const DEFAULT_COMPOSER_MAX_INPUT_HEIGHT = 160;

export const MIN_COMPOSER_HEIGHT_LINES = 2;

/**
 * Null means "today's auto-grow". A number is the user's fixed composer height in px,
 * already quantized to whole text lines and clamped to [2 lines, viewport bound] at write
 * time; it is clamped again at read time so rotation and window resizes cannot push the
 * composer past the bound the current viewport allows.
 */
export interface ComposerHeightPersistedState {
  explicitHeight: number | null;
}

const ComposerHeightPersistedStateSchema = z.strictObject({
  explicitHeight: z.number().finite().positive().nullable(),
});

interface ComposerHeightStoreState extends ComposerHeightPersistedState {
  setExplicitHeight: (height: number, viewportBound: number, lineHeight: number) => void;
  setExplicitHeightDelta: (delta: number, viewportBound: number, lineHeight: number) => void;
  resetExplicitHeight: () => void;
  toggleExplicitHeight: (viewportBound: number, lineHeight: number) => void;
}

/**
 * The composer's viewport bound: max(app default, 50% of the window) — the same rule
 * `resolveMaxInputHeight` applies in input.rambla.tsx.
 */
export function resolveComposerViewportBound(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) {
    return DEFAULT_COMPOSER_MAX_INPUT_HEIGHT;
  }
  return Math.max(DEFAULT_COMPOSER_MAX_INPUT_HEIGHT, Math.floor(windowHeight * 0.5));
}

function clampExplicitHeight(height: number, viewportBound: number, lineHeight: number): number {
  // Quantize to whole text lines so the composer's rows never shear mid-drag.
  const minHeight = MIN_COMPOSER_HEIGHT_LINES * lineHeight;
  const bound = Math.max(minHeight, Math.floor(viewportBound / lineHeight) * lineHeight);
  const quantized = Math.floor(height / lineHeight) * lineHeight;
  return Math.min(Math.max(quantized, minHeight), bound);
}

export function migrateComposerHeightState(
  persistedState: unknown,
  version: number,
): ComposerHeightPersistedState {
  // v1 stored a grow-only ceiling (`userMaxInputHeight`) that was unobservable on native;
  // migrate it to the null sentinel so those installs fall back to today's auto-grow.
  if (version < 2) {
    return { explicitHeight: null };
  }
  const result = ComposerHeightPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return { explicitHeight: null };
  }
  return { explicitHeight: result.data.explicitHeight };
}

export function createComposerHeightStorage(
  backingStorage: StateStorage = AsyncStorage,
): StateStorage {
  return {
    getItem: (name) => backingStorage.getItem(name),
    setItem: (name, value) => backingStorage.setItem(name, value),
    removeItem: (name) => backingStorage.removeItem(name),
  };
}

export function createComposerHeightPersistStorage(
  backingStorage: StateStorage = AsyncStorage,
): PersistStorage<ComposerHeightPersistedState> {
  return createValidatedPersistStorage(
    createComposerHeightStorage(backingStorage),
    ComposerHeightPersistedStateSchema,
  );
}

/**
 * The composer's pixel height setup for a render. With no explicit height, today's
 * auto-grow: min = the app's minimum, max = the viewport bound. With one, both equal the
 * explicit height (re-clamped to the bound and 2 lines) so the box pins with inner scroll.
 */
export function resolveComposerHeightArgs(
  explicitHeight: number | null,
  viewportBound: number,
  lineHeight: number,
  autoMinHeight: number,
): { minHeight: number; maxHeight: number } {
  if (explicitHeight === null) {
    return { minHeight: autoMinHeight, maxHeight: viewportBound };
  }
  const minLines = MIN_COMPOSER_HEIGHT_LINES * lineHeight;
  const pinned = Math.min(Math.max(explicitHeight, minLines), viewportBound);
  return { minHeight: pinned, maxHeight: pinned };
}

export const useComposerHeightStore = create<ComposerHeightStoreState>()(
  persist(
    (set) => ({
      explicitHeight: null,
      setExplicitHeight: (height, viewportBound, lineHeight) =>
        set({ explicitHeight: clampExplicitHeight(height, viewportBound, lineHeight) }),
      // A null current starts from the app default, so the first drag grows from today's
      // default rather than from the sentinel.
      setExplicitHeightDelta: (delta, viewportBound, lineHeight) =>
        set((state) => ({
          explicitHeight: clampExplicitHeight(
            (state.explicitHeight ?? DEFAULT_COMPOSER_MAX_INPUT_HEIGHT) + delta,
            viewportBound,
            lineHeight,
          ),
        })),
      resetExplicitHeight: () => set({ explicitHeight: null }),
      toggleExplicitHeight: (viewportBound, lineHeight) =>
        set((state) => ({
          explicitHeight:
            state.explicitHeight === null
              ? clampExplicitHeight(viewportBound, viewportBound, lineHeight)
              : null,
        })),
    }),
    {
      name: COMPOSER_HEIGHT_STORAGE_KEY,
      version: COMPOSER_HEIGHT_STORE_VERSION,
      storage: createComposerHeightPersistStorage(),
      partialize: (state) => ({ explicitHeight: state.explicitHeight }),
      migrate: migrateComposerHeightState,
    },
  ),
);
