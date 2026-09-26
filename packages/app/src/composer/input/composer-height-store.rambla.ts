import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { readValidatedJson } from "@/storage/validated-storage";
// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: holds the live composer height with clamping and device-local persistence.

export const COMPOSER_HEIGHT_STORAGE_KEY = "@rambla:composer-height";

const StoredComposerHeightSchema = z.number().finite().positive();

export interface ComposerHeightBounds {
  min: number;
  max: number;
}

function clampHeight(height: number, bounds: ComposerHeightBounds): number {
  return Math.min(bounds.max, Math.max(bounds.min, height));
}

export interface ComposerHeightStore {
  getHeight(): number;
  setHeight(height: number, bounds: ComposerHeightBounds): void;
  getMaximizedHeight(): number | null;
  setMaximizedHeight(height: number): void;
  load(bounds: ComposerHeightBounds): Promise<void>;
  persist(): Promise<void>;
}

export function createComposerHeightStore(input: { defaultHeight: number }): ComposerHeightStore {
  let height = input.defaultHeight;
  let maximizedHeight: number | null = null;

  return {
    getHeight: () => height,
    setHeight(next, bounds) {
      height = clampHeight(next, bounds);
    },
    getMaximizedHeight: () => maximizedHeight,
    setMaximizedHeight(next) {
      maximizedHeight = next;
    },
    async load(bounds) {
      const stored = await readValidatedJson(
        AsyncStorage,
        COMPOSER_HEIGHT_STORAGE_KEY,
        StoredComposerHeightSchema,
      );
      if (stored === null) {
        height = input.defaultHeight;
        return;
      }
      height = clampHeight(stored, bounds);
    },
    async persist() {
      await AsyncStorage.setItem(COMPOSER_HEIGHT_STORAGE_KEY, JSON.stringify(height));
    },
  };
}
