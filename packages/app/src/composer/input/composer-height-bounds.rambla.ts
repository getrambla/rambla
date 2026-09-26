// RAMBLA-FORK: feat: 2026-09-24-feat-user-adjustable-composer-height.md: pure bounds computation for the adjustable composer height.

export interface ComposerHeightBoundsInputs {
  fontSize: number;
  verticalPadding: number;
  borderWidth: number;
  usableAreaTop: number;
}

export function computeComposerHeightBounds(inputs: ComposerHeightBoundsInputs): {
  min: number;
  max: number;
} {
  const lineHeight = inputs.fontSize * 1.4;
  return {
    min: lineHeight + inputs.verticalPadding * 2 + inputs.borderWidth * 2,
    max: inputs.usableAreaTop,
  };
}
