// How Blanc's text grows with iOS's text size (Dynamic Type). Each type role
// follows the iOS text style it matches, so small text grows more than large
// text, as in Apple's apps; React Native on its own scales every size by
// the same factor. At the standard size (Large) nothing changes. Plain data
// and functions, no React Native, so the shared tests can run them.

export type TextRamp =
  | 'caption2'
  | 'caption1'
  | 'footnote'
  | 'subheadline'
  | 'callout'
  | 'body'
  | 'headline'
  | 'title3'
  | 'title2'
  | 'title1'
  | 'largeTitle';

/**
 * React Native's text multiplier at each iOS text size, extra small to AX5
 * (RCTAccessibilityManager's table; Large is 1).
 */
export const SIZE_SCALES = [0.823, 0.882, 0.941, 1, 1.118, 1.235, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571] as const;

/** Where Large, the standard size, sits in SIZE_SCALES. */
const LARGE = 3;

/** iOS's text styles in points at each text size, extra small to AX5 (Apple's Dynamic Type sizes). */
export const RAMP_POINTS: Record<TextRamp, readonly number[]> = {
  largeTitle: [31, 32, 33, 34, 36, 38, 40, 44, 48, 52, 56, 60],
  title1: [25, 26, 27, 28, 30, 32, 34, 38, 43, 48, 53, 58],
  title2: [19, 20, 21, 22, 24, 26, 28, 34, 39, 44, 50, 56],
  title3: [17, 18, 19, 20, 22, 24, 26, 31, 37, 43, 49, 55],
  headline: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53],
  body: [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53],
  callout: [13, 14, 15, 16, 18, 20, 22, 26, 32, 38, 44, 51],
  subheadline: [12, 13, 14, 15, 17, 19, 21, 25, 30, 36, 42, 49],
  footnote: [12, 12, 12, 13, 15, 17, 19, 23, 27, 33, 38, 44],
  caption1: [11, 11, 11, 12, 14, 16, 18, 22, 26, 32, 37, 43],
  caption2: [11, 11, 11, 11, 13, 15, 17, 20, 24, 29, 34, 40],
};

/**
 * The iOS text style each Blanc role grows like (Text's `dynamicTypeRamp`).
 * Big figures have none: they keep React Native's even growth, capped by
 * ROLE_MAX_SCALE, the same as the figure fields people type into.
 */
export const ROLE_RAMPS = {
  section: 'title3',
  title: 'title2',
  body: 'body',
  field: 'body',
  fieldLines: 'body',
  bodyStrong: 'body',
  headline: 'headline',
  secondary: 'subheadline',
  footnote: 'footnote',
  meta: 'caption1',
  figure: null,
} as const satisfies Record<string, TextRamp | null>;

/**
 * The most a big figure grows (about iOS's largest standard text size). A
 * figure is already large; at the accessibility sizes it would leave the
 * screen, and the words around it carry the bigger text.
 */
export const FIGURE_MAX_SCALE = 1.3;

/** Roles that stop growing at a size (Text's `maxFontSizeMultiplier`). */
export const ROLE_MAX_SCALE: Partial<Record<keyof typeof ROLE_RAMPS, number>> = {
  figure: FIGURE_MAX_SCALE,
};

/** The text size setting React Native's multiplier stands for (an index into SIZE_SCALES). */
export function sizeIndex(fontScale: number): number {
  let best = LARGE;
  SIZE_SCALES.forEach((scale, index) => {
    if (Math.abs(scale - fontScale) < Math.abs(SIZE_SCALES[best] - fontScale)) best = index;
  });
  return best;
}

/** How much an iOS text style grows at a text size, against its size at Large. */
export function rampScale(ramp: TextRamp, fontScale: number): number {
  const points = RAMP_POINTS[ramp];
  return points[sizeIndex(fontScale)] / points[LARGE];
}

/**
 * How much text in a Blanc role grows at a text size, as iOS draws it: its
 * text style's growth (or React Native's own for figures), capped where the
 * role stops. RollingText draws its SwiftUI copy at this size so it lands on
 * the React Native text beneath it.
 */
export function roleScale(role: keyof typeof ROLE_RAMPS, fontScale: number): number {
  const ramp = ROLE_RAMPS[role];
  const scale = ramp ? rampScale(ramp, fontScale) : fontScale;
  const cap = ROLE_MAX_SCALE[role];
  return cap !== undefined && cap >= 1 ? Math.min(scale, cap) : scale;
}
