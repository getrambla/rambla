// RAMBLA-FORK: fix: 2026-09-24-feat-user-adjustable-composer-height.md: temporary step-1 drag diagnostics; removed in step 7.

export interface ComposerDragFrameSample {
  t: number;
  layer: "gesture" | "render" | "layout";
  absoluteY?: number;
  translationY?: number;
  liveHeight?: number | null;
  pinnedHeight?: number | null;
  styleHeight?: number;
  layoutHeight?: number;
  onHeightChange?: number;
  windowHeight?: number;
}

// Enabled by default so the TestFlight diagnostic build logs with no debug hook.
let enabled = true;

export function setComposerDiagnosticsEnabled(next: boolean): void {
  enabled = next;
}

export function isComposerDiagnosticsEnabled(): boolean {
  return enabled;
}

export function logComposerDragFrame(sample: ComposerDragFrameSample): void {
  if (!enabled) return;
  console.log(`[composer-diag] ${JSON.stringify(sample)}`);
}
