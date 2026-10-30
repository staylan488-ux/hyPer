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

// SF Pro's line height (ascender plus descender, no leading) for one point of size.
export const SF_LINE = 1.194;

export type FigureAlignment = 'leading' | 'center' | 'trailing' | 'bottomLeading' | 'bottom' | 'bottomTrailing';

/**
 * Where the SwiftUI copy sits in the React Native text's box. React Native
 * centres a line in a taller line height, but a shorter one (the big
 * figures) keeps the line's descent at the bottom, so the copy sits on the
 * bottom there.
 */
export function figureAlignment(fontSize: number, lineHeight: number | undefined, textAlign: string | undefined): FigureAlignment {
  const sitsLow = lineHeight !== undefined && lineHeight < fontSize * SF_LINE;
  const horizontal = textAlign === 'center' ? 'center' : textAlign === 'right' ? 'trailing' : 'leading';
  if (!sitsLow) return horizontal;
  return horizontal === 'center' ? 'bottom' : horizontal === 'trailing' ? 'bottomTrailing' : 'bottomLeading';
}
