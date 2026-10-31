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

export type FigureFrameAlignment = 'leading' | 'center' | 'trailing' | 'bottomLeading' | 'bottom' | 'bottomTrailing';

/**
 * The system font's own line height, in ems (SF Pro's ascender plus
 * descender, 1.193): a line height below it is short.
 */
const SYSTEM_LINE = 1.19;

/**
 * Where the SwiftUI copy sits in the React Native text's box, so its glyphs
 * land on React Native's own. In a line at least the font's own height React
 * Native centres the glyphs, so the copy is centred too. In a short line (the
 * big figures, 88 points in a 95-point line) React Native keeps the glyphs'
 * bottom on the line's bottom and lets the tops overflow, so the copy is
 * pinned to the bottom; centred, it sat 4 to 5 points low in the simulator.
 * Sideways it keeps the text's own alignment: a figure whose right edge is
 * fixed (a value before "/ 180 g") aligns right, so the digits it gains or
 * loses come and go on its left.
 */
export function figureFrame(textAlign: string | undefined, fontSize: number, lineHeight: number | undefined): FigureFrameAlignment {
  const short = lineHeight !== undefined && lineHeight < fontSize * SYSTEM_LINE;
  if (textAlign === 'center') return short ? 'bottom' : 'center';
  if (textAlign === 'right') return short ? 'bottomTrailing' : 'trailing';
  return short ? 'bottomLeading' : 'leading';
}

/** How long a figure's roll takes, in seconds. */
export const ROLL_SECONDS = 0.42;

/**
 * SwiftUI's smooth spring over `seconds` (no bounce) as a mass-1 spring:
 * stiffness (2π/t)² and damping 4π/t. The figure's own frame grows or
 * shrinks on this spring, so text beside it (`figureLayout`) follows the
 * same curve and keeps to the figure's edge.
 */
export function rollSpring(seconds = ROLL_SECONDS) {
  const omega = (2 * Math.PI) / seconds;
  return { mass: 1, stiffness: omega * omega, damping: 2 * omega };
}
