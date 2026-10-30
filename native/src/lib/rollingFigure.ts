// The rules RollingText draws its SwiftUI copy by: which way the digits roll,
// and where the copy sits so its glyphs land on React Native's own.

/** The digits in a figure as one number ("1,240" → 1240, "1:05" → 105), to tell up from down. */
export function figureValue(text: string): number {
  const digits = text.replace(/[^0-9]/g, '');
  return digits ? Number(digits) : NaN;
}

/** True when the new figure is smaller, so its digits roll down; a change from or to no number rolls up. */
export function rollsDown(before: string, after: string): boolean {
  const from = figureValue(before);
  const to = figureValue(after);
  return Number.isFinite(from) && Number.isFinite(to) && to < from;
}

export type FigureAlignment = 'leading' | 'center' | 'trailing';

/**
 * Where the SwiftUI copy sits in the React Native text's box. React Native
 * centres a line in its line height, taller or shorter than the font's own
 * (measured in the simulator: the big figures sat 4 to 5 points low when
 * pinned to the bottom), so the copy is centred too. Sideways it keeps the
 * text's own alignment; a figure whose right edge is fixed (a value before
 * "/ 180 g") aligns right, so a digit it gains or loses changes its left.
 */
export function figureAlignment(textAlign: string | undefined): FigureAlignment {
  return textAlign === 'center' ? 'center' : textAlign === 'right' ? 'trailing' : 'leading';
}

/** How long a figure's roll takes, in seconds; a neighbour that moves with it (`figureLayout`) matches. */
export const ROLL_SECONDS = 0.42;
