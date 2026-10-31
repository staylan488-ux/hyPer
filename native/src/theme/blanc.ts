// Blanc: Apple's structure, quiet white labels, and two things of hyPer's own:
// the red italic P that marks the app, and the set tally from a paper
// training log.
//
// SF Pro for everything except the P (Fraunces, in BrandMark). Big figures use
// SF's Thin weight, the way the Weather app draws temperatures. Small label
// details use Menlo, the closest monospaced face apps can name. Chalk ground,
// white labels, black ink; no accent colour. Red is reserved for "live",
// "over the limit" and the P.
import { DynamicColorIOS, Platform, useColorScheme, type TextStyle } from 'react-native';

export const palettes = {
  light: {
    ground: '#F2F1ED',
    label: '#FFFFFF',
    labelEdge: 'rgba(0, 0, 0, 0.06)',
    ink: '#0B0B0B',
    graphite: '#66665F',
    upcoming: '#707069',
    hairline: 'rgba(0, 0, 0, 0.09)',
    track: '#DCDBD6',
    fill: '#ECEBE6',
    pressed: '#E7E6E1',
    capsule: '#0B0B0B',
    onCapsule: '#FFFFFF',
    live: '#D23B2E',
    brand: '#A8352A',
  },
  dark: {
    ground: '#000000',
    label: '#141414',
    labelEdge: 'rgba(255, 255, 255, 0.07)',
    ink: '#F4F4F2',
    graphite: '#A3A39C',
    upcoming: '#8C8C86',
    hairline: 'rgba(255, 255, 255, 0.11)',
    track: '#2B2B29',
    fill: '#1F1F1E',
    pressed: '#232322',
    capsule: '#F4F4F2',
    onCapsule: '#0B0B0B',
    live: '#FF5A4C',
    brand: '#E58477',
  },
} as const;

export type Palette = { [K in keyof typeof palettes.light]: string };

export function useBlanc(): Palette {
  return useColorScheme() === 'dark' ? palettes.dark : palettes.light;
}

/** Ink that follows the system appearance, for native chrome (tab bar, headers). */
export const dynamicInk =
  Platform.OS === 'ios' ? DynamicColorIOS({ light: palettes.light.ink, dark: palettes.dark.ink }) : palettes.light.ink;

/**
 * Every text field names its own letter spacing. React Native reuses a text
 * field's native view, and iOS draws the new placeholder with the spacing of
 * the view's last one unless the new one names a spacing itself: a big
 * figure's tight spacing (FigureInput) squeezed the letters of a search
 * field's placeholder together. Apple documents a spacing of 0 as turning
 * the font's kerning off, so this is a tiny one that draws like plain text.
 */
const FIELD_SPACING = 0.01;

export const type = {
  section: { fontSize: 20, lineHeight: 25, fontWeight: '600' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '600' },
  body: { fontSize: 17, lineHeight: 22 },
  /**
   * One-line text fields: body with no line height (it drew their text low)
   * and its own letter spacing (FIELD_SPACING). Use lineBreakModeIOS="tail"
   * with it, so the placeholder names its own paragraph style too.
   */
  field: { fontSize: 17, letterSpacing: FIELD_SPACING },
  /** Text fields that wrap onto more lines: body with its own letter spacing (FIELD_SPACING). */
  fieldLines: { fontSize: 17, lineHeight: 22, letterSpacing: FIELD_SPACING },
  bodyStrong: { fontSize: 17, lineHeight: 22, fontWeight: '500' },
  headline: { fontSize: 17, lineHeight: 22, fontWeight: '600' },
  secondary: { fontSize: 15, lineHeight: 20 },
  footnote: { fontSize: 13, lineHeight: 18 },
  meta: { fontFamily: 'Menlo', fontSize: 12, lineHeight: 16 },
  /** Big thin figures: calories, weight, reps. */
  figure: { fontWeight: '200', fontVariant: ['tabular-nums'] },
} satisfies Record<string, TextStyle>;

export const space = {
  /** Screen edge to text. */
  gutter: 20,
  /** Screen edge to a label card. */
  inset: 16,
  /** Between sections. */
  section: 30,
} as const;

export const radius = {
  label: 10,
} as const;
