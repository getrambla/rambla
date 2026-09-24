// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: persisted pinned composer height (null = today's auto-grow) plus a non-persisted live dragHeight.
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

export const MIN_COMPOSER_HEIGHT_LINES = 1;

/**
 * Null means "today's auto-grow". A number is the height the user pinned the composer at
 * on release, in px, already quantized to whole text lines with a 1-line minimum and no
 * maximum beyond the window; it is clamped again at read time so rotation and window
 * resizes cannot push the composer past the bound the current viewport allows.
 */
export interface ComposerHeightPersistedState {
  explicitHeight: number | null;
}

const ComposerHeightPersistedStateSchema = z.strictObject({
  explicitHeight: z.number().finite().positive().nullable(),
});

interface ComposerHeightStoreState extends ComposerHeightPersistedState {
  /**
   * Live, mid-drag height. Never persisted; while set, the composer follows it 1:1 with
   * a 1-line minimum and no maximum.
   */
  dragHeight: number | null;
  setDragHeight: (height: number, lineHeight: number) => void;
  setDragHeightDelta: (delta: number, lineHeight: number) => void;
  pinDragHeight: () => void;
  setExplicitHeight: (height: number, viewportBound: number, lineHeight: number) => void;
  resetExplicitHeight: () => void;
  toggleExplicitHeight: (viewportBound: number, lineHeight: number) => void;
}

/**
 * The composer's bound: the window height itself — the box may grow to the top of the
 * window, so the window is the only ceiling.
 */
export function resolveComposerViewportBound(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) {
    return DEFAULT_COMPOSER_MAX_INPUT_HEIGHT;
  }
  return Math.floor(windowHeight);
}

// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: drag-time quantization — 1-line minimum, no ceiling; pin-time re-clamp to the viewport.
function clampDragHeight(height: number, lineHeight: number): number {
  const quantized = Math.floor(height / lineHeight) * lineHeight;
  return Math.max(quantized, MIN_COMPOSER_HEIGHT_LINES * lineHeight);
}

function clampPinnedHeight(height: number, viewportBound: number, lineHeight: number): number {
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
 * The composer's pixel height setup for a render, in three states. Live drag: min 1 line,
 * no max — the box follows the finger to the window top. Pinned: min = max = the pinned
 * height (re-clamped to the bound) so the box renders at H with inner scroll. Null:
 * today's auto-grow.
 */
export function resolveComposerHeightArgs(
  explicitHeight: number | null,
  dragHeight: number | null,
  viewportBound: number,
  lineHeight: number,
  autoMinHeight: number,
): { minHeight: number; maxHeight: number } {
  if (dragHeight !== null) {
    const min = MIN_COMPOSER_HEIGHT_LINES * lineHeight;
    return { minHeight: min, maxHeight: Math.max(viewportBound, min) };
  }
  if (explicitHeight === null) {
    return { minHeight: autoMinHeight, maxHeight: viewportBound };
  }
  const pinned = clampPinnedHeight(explicitHeight, viewportBound, lineHeight);
  return { minHeight: pinned, maxHeight: pinned };
}

export const useComposerHeightStore = create<ComposerHeightStoreState>()(
  persist(
    (set, get) => ({
      explicitHeight: null,
      dragHeight: null,
      // RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: live drag state — follows the finger 1:1, quantized to lines, never persisted.
      setDragHeight: (height, lineHeight) =>
        set({ dragHeight: clampDragHeight(height, lineHeight) }),
      // A null dragHeight starts from the pinned height, else the app default, so a drag
      // quantizes against the box's current height — never against a pinned min=max.
      setDragHeightDelta: (delta, lineHeight) =>
        set((state) => ({
          dragHeight: clampDragHeight(
            (state.dragHeight ?? state.explicitHeight ?? DEFAULT_COMPOSER_MAX_INPUT_HEIGHT) + delta,
            lineHeight,
          ),
        })),
      // Release: pin min = max = the height the box was left at; the drag session ends.
      pinDragHeight: () => {
        const { dragHeight } = get();
        if (dragHeight === null) return;
        set({ explicitHeight: dragHeight, dragHeight: null });
      },
      setExplicitHeight: (height, viewportBound, lineHeight) =>
        set({ explicitHeight: clampPinnedHeight(height, viewportBound, lineHeight) }),
      resetExplicitHeight: () => set({ explicitHeight: null }),
      toggleExplicitHeight: (viewportBound, lineHeight) =>
        set((state) => ({
          explicitHeight:
            state.explicitHeight === null
              ? clampPinnedHeight(viewportBound, viewportBound, lineHeight)
              : null,
        })),
    }),
    {
      name: COMPOSER_HEIGHT_STORAGE_KEY,
      version: COMPOSER_HEIGHT_STORE_VERSION,
      storage: createComposerHeightPersistStorage(),
      // RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: only the pinned height persists; dragHeight is session state.
      partialize: (state) => ({ explicitHeight: state.explicitHeight }),
      migrate: migrateComposerHeightState,
    },
  ),
);
