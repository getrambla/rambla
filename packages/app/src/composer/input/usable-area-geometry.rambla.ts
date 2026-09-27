import { useSyncExternalStore } from "react";

// RAMBLA-FORK: feature: 2026-09-24-feat-user-adjustable-composer-height.md: module-level store holding the live header-bottom measurement (usable-area top).
let usableAreaTop = 0;
const subscribers = new Set<() => void>();

export function reportHeaderBottom(headerBottom: number) {
  if (headerBottom === usableAreaTop) return;
  usableAreaTop = headerBottom;
  for (const subscriber of subscribers) subscriber();
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function useUsableAreaTop(): number {
  return useSyncExternalStore(subscribe, () => usableAreaTop);
}
