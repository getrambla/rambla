// RAMBLA-FORK: fix: 2026-09-24-fix-ios-link-scroll-gate.md: module-level flag tracking whether the chat scroll gesture is active.

let linkScrollActive = false;

export function setLinkScrollActive(active: boolean): void {
  linkScrollActive = active;
}

export function isLinkScrollActive(): boolean {
  return linkScrollActive;
}
