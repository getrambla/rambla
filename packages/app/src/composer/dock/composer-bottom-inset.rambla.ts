// RAMBLA-FORK: fix: 2026-09-26-fix-composer-ios-bottom-spacing.md: computes the reduced composer bottom clearance from the safe-area inset.
const CLEARANCE_FACTOR = 0.5;

export function getComposerBottomInset(bottomInset: number): number {
  return Math.max(0, bottomInset * CLEARANCE_FACTOR);
}
