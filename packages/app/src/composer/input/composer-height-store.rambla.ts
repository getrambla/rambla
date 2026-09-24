// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: persisted per-device ceiling for the composer's auto-grow height.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist, type PersistStorage, type StateStorage } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

const COMPOSER_HEIGHT_STORAGE_KEY = "composer-height";
export const COMPOSER_HEIGHT_STORE_VERSION = 1;

/**
 * The height the composer grows to when the user has never dragged the handle — the same
 * default `input.rambla.tsx` has always applied. Kept here so the store can clamp against it
 * without importing from the component file.
 */
export const DEFAULT_COMPOSER_MAX_INPUT_HEIGHT = 160;

/**
 * Null means "use the app default". A number is the user's ceiling in px, already clamped to
 * the viewport bound at write time; it is clamped again at read time so rotation and window
 * resizes cannot push the composer past the bound the current viewport allows.
 */
export interface ComposerHeightPersistedState {
  userMaxInputHeight: number | null;
}

const ComposerHeightPersistedStateSchema = z.strictObject({
  userMaxInputHeight: z.number().finite().positive().nullable(),
});

interface ComposerHeightStoreState extends ComposerHeightPersistedState {
  setUserMaxInputHeight: (height: number, viewportBound: number) => void;
  setUserMaxInputHeightDelta: (delta: number, viewportBound: number) => void;
  resetUserMaxInputHeight: () => void;
  toggleUserMaxInputHeight: (viewportBound: number) => void;
}

function clampCeiling(height: number, viewportBound: number): number | null {
  const bound = Math.max(DEFAULT_COMPOSER_MAX_INPUT_HEIGHT, viewportBound);
  const clamped = Math.min(Math.max(height, DEFAULT_COMPOSER_MAX_INPUT_HEIGHT), bound);
  // Round to whole pixels so persisted values stay stable across platforms.
  return Math.floor(clamped);
}

export function migrateComposerHeightState(persistedState: unknown): ComposerHeightPersistedState {
  const result = ComposerHeightPersistedStateSchema.safeParse(persistedState);
  if (!result.success) {
    return { userMaxInputHeight: null };
  }
  return { userMaxInputHeight: result.data.userMaxInputHeight };
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

export const useComposerHeightStore = create<ComposerHeightStoreState>()(
  persist(
    (set) => ({
      userMaxInputHeight: null,
      setUserMaxInputHeight: (height, viewportBound) =>
        set({ userMaxInputHeight: clampCeiling(height, viewportBound) }),
      // A null current starts from the app default, so the first upward drag grows from today's
      // default rather than from the sentinel.
      setUserMaxInputHeightDelta: (delta, viewportBound) =>
        set((state) => ({
          userMaxInputHeight: clampCeiling(
            (state.userMaxInputHeight ?? DEFAULT_COMPOSER_MAX_INPUT_HEIGHT) - delta,
            viewportBound,
          ),
        })),
      resetUserMaxInputHeight: () => set({ userMaxInputHeight: null }),
      toggleUserMaxInputHeight: (viewportBound) =>
        set((state) => ({
          userMaxInputHeight:
            state.userMaxInputHeight === null ? clampCeiling(viewportBound, viewportBound) : null,
        })),
    }),
    {
      name: COMPOSER_HEIGHT_STORAGE_KEY,
      version: COMPOSER_HEIGHT_STORE_VERSION,
      storage: createComposerHeightPersistStorage(),
      partialize: (state) => ({ userMaxInputHeight: state.userMaxInputHeight }),
      migrate: migrateComposerHeightState,
    },
  ),
);

/**
 * The effective ceiling for the composer: the user's value if one is stored, capped by the
 * current viewport bound so a stored ceiling from a taller window can never overflow this one.
 * The bound itself keeps the app's existing floor-of-defaults behavior.
 */
export function resolveEffectiveMaxInputHeight(
  userMaxInputHeight: number | null,
  viewportBound: number,
): number {
  if (userMaxInputHeight === null) return viewportBound;
  return Math.min(Math.max(userMaxInputHeight, DEFAULT_COMPOSER_MAX_INPUT_HEIGHT), viewportBound);
}
