// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: composer height pin/live store.
import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";

export const MIN_PINNED_HEIGHT = 60;
// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: fixed 3-line default; auto-grow removed.
export const DEFAULT_PINNED_HEIGHT = 90;

const COMPOSER_HEIGHT_STORAGE_KEY = "@rambla:composer-height";

const PinnedHeightSchema = z.number().int().finite().positive();

export interface ComposerHeightState {
  pinnedHeight: number | null;
  liveHeight: number | null;
}

function clampToWindow(height: number, windowHeight: number): number {
  return Math.min(Math.max(height, MIN_PINNED_HEIGHT), Math.max(MIN_PINNED_HEIGHT, windowHeight));
}

export interface ComposerHeightStore {
  getState(): ComposerHeightState;
  setLiveHeight(height: number, windowHeight: number): void;
  clearLiveHeight(): void;
  pinLiveHeight(windowHeight: number): void;
  restoreDefault(): void;
  resolveRenderBounds(windowHeight: number): { minHeight: number; maxHeight: number } | null;
  hydrate(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export interface ValidatedStringStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function createComposerHeightStore(storage: ValidatedStringStorage): ComposerHeightStore {
  let state: ComposerHeightState = { pinnedHeight: null, liveHeight: null };
  const listeners = new Set<() => void>();

  function setState(next: ComposerHeightState) {
    state = next;
    for (const listener of listeners) listener();
  }

  async function persistPinned(pinnedHeight: number | null) {
    try {
      if (pinnedHeight === null) {
        await storage.removeItem(COMPOSER_HEIGHT_STORAGE_KEY);
      } else {
        await storage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, JSON.stringify(pinnedHeight));
      }
    } catch {
      // Persistence failures must never break the drag.
    }
  }

  return {
    getState: () => state,

    setLiveHeight(height, windowHeight) {
      setState({ ...state, liveHeight: clampToWindow(height, windowHeight) });
    },

    clearLiveHeight() {
      if (state.liveHeight === null) return;
      setState({ ...state, liveHeight: null });
    },

    pinLiveHeight(windowHeight) {
      if (state.liveHeight === null) return;
      const pinnedHeight = clampToWindow(state.liveHeight, windowHeight);
      setState({ pinnedHeight, liveHeight: null });
      void persistPinned(pinnedHeight);
    },

    // RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: restoreDefault clears the pin; null renders the fixed 3-line default.
    restoreDefault() {
      setState({ pinnedHeight: null, liveHeight: null });
      void persistPinned(null);
    },

    resolveRenderBounds(windowHeight) {
      // RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: single clamp site; live renders as-is, pinned re-clamps on rotation, null renders the fixed default.
      if (state.liveHeight !== null) {
        return { minHeight: state.liveHeight, maxHeight: state.liveHeight };
      }
      if (state.pinnedHeight !== null) {
        const clamped = clampToWindow(state.pinnedHeight, windowHeight);
        return { minHeight: clamped, maxHeight: clamped };
      }
      return { minHeight: DEFAULT_PINNED_HEIGHT, maxHeight: DEFAULT_PINNED_HEIGHT };
    },

    async hydrate() {
      const parsed = await readValidatedJson(storage, COMPOSER_HEIGHT_STORAGE_KEY, PinnedHeightSchema);
      setState({ ...state, pinnedHeight: parsed });
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } satisfies ComposerHeightStore;
}
