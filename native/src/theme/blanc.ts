// Blanc: Apple's structure, content straight on the page, and two things of
// hyPer's own: the red italic P that marks the app, and the set tally from a
// paper training log.
//
// SF Pro for everything except the P (Fraunces, in BrandMark). Big figures use
// SF's Thin weight, the way the Weather app draws temperatures. Small label
// details use Menlo, the closest monospaced face apps can name. Chalk ground
// (true black in dark), black ink; no cards and no accent colour: hierarchy
// comes from type, space and hairlines on the 16 pt gutter. Red is reserved
// for "live", "over the limit" and the P.
import { DynamicColorIOS, Platform, useColorScheme, type TextStyle } from 'react-native';

import { useIncreaseContrast } from '~/lib/accessibility';

export const palettes = {
  light: {
    ground: '#F2F1ED',
    /**
     * A surface lifted off the page, never a resting card: a row while it is
     * dragged, a hold menu's preview. Content at rest sits on the ground.
     */
    label: '#FFFFFF',
    labelEdge: 'rgba(0, 0, 0, 0.06)',
    ink: '#0B0B0B',
    graphite: '#66665F',
    upcoming: '#707069',
    hairline: 'rgba(0, 0, 0, 0.09)',
    track: '#DCDBD6',
    /** Marks to read but not lead (tally strokes still to do, past bars, weigh-in dots): 3:1 or more on chalk and labels. */
    mark: '#878680',
    fill: '#ECEBE6',
    /** A chosen chip or segment, lifted on the fill as a segmented control's choice (lighter than the fill in dark too). */
    chosen: '#FFFFFF',
    pressed: '#E7E6E1',
    capsule: '#0B0B0B',
    onCapsule: '#FFFFFF',
    /**
     * A switch turned on: an ink capsule, never iOS's green (Blanc has no
     * accent). In dark it turns over as the main button does, a light track
     * with a dark knob, so on never reads as another grey beside off.
     */
    switchOn: '#0B0B0B',
    switchThumbOn: '#FFFFFF',
    // One red: the P's, also for live, over and errors.
    live: '#A8352A',
    brand: '#A8352A',
  },
  dark: {
    ground: '#000000',
    label: '#1C1C1B',
    labelEdge: 'rgba(255, 255, 255, 0.07)',
    ink: '#F4F4F2',
    graphite: '#A3A39C',
    upcoming: '#8C8C86',
    hairline: 'rgba(255, 255, 255, 0.11)',
    track: '#363634',
    mark: '#7A7A73',
    fill: '#2C2C2A',
    chosen: '#4A4A47',
    pressed: '#30302E',
    // A touch below ink, so the main button isn't the brightest slab in a dim room.
    capsule: '#E6E6E2',
    onCapsule: '#0B0B0B',
    /**
     * A switch turned on: an ink capsule, never iOS's green (Blanc has no
     * accent). In dark it turns over as the main button does, a light track
     * with a dark knob, so on never reads as another grey beside off.
     */
    switchOn: '#E6E6E2',
    switchThumbOn: '#0B0B0B',
    live: '#E0604F',
    brand: '#E0604F',
  },
  // With Increase Contrast on (Settings, Accessibility, Display & Text Size),
  // as iOS's own colours do: the same chalk and lifted surfaces, with darker
  // (in dark, lighter) secondary text, stronger rules and edges, and full
  // black or white ink. Every text tone reads at 4.5:1 or more on every surface
  // (graphite at about 6:1 and up). The P keeps its colour.
  lightContrast: {
    ground: '#F2F1ED',
    label: '#FFFFFF',
    labelEdge: 'rgba(0, 0, 0, 0.2)',
    ink: '#000000',
    graphite: '#4A4A44',
    upcoming: '#57574F',
    hairline: 'rgba(0, 0, 0, 0.22)',
    track: '#BDBCB6',
    mark: '#7A7973',
    fill: '#E3E2DC',
    chosen: '#FFFFFF',
    pressed: '#D8D7D1',
    capsule: '#000000',
    onCapsule: '#FFFFFF',
    /**
     * A switch turned on: an ink capsule, never iOS's green (Blanc has no
     * accent). In dark it turns over as the main button does, a light track
     * with a dark knob, so on never reads as another grey beside off.
     */
    switchOn: '#000000',
    switchThumbOn: '#FFFFFF',
    live: '#A8352A',
    brand: '#A8352A',
  },
  darkContrast: {
    ground: '#000000',
    label: '#222221',
    labelEdge: 'rgba(255, 255, 255, 0.24)',
    ink: '#FFFFFF',
    graphite: '#C9C9C3',
    upcoming: '#B2B2AC',
    hairline: 'rgba(255, 255, 255, 0.28)',
    track: '#4D4D4A',
    mark: '#85857D',
    fill: '#38383A',
    chosen: '#5A5A57',
    pressed: '#424240',
    capsule: '#FFFFFF',
    onCapsule: '#000000',
    /**
     * A switch turned on: an ink capsule, never iOS's green (Blanc has no
     * accent). In dark it turns over as the main button does, a light track
     * with a dark knob, so on never reads as another grey beside off.
     */
    switchOn: '#FFFFFF',
    switchThumbOn: '#000000',
    live: '#FF6F61',
    brand: '#E0604F',
  },
} as const;

export type Palette = { [K in keyof typeof palettes.light]: string };

/** The palette for an appearance, with or without Increase Contrast. */
export function paletteFor(dark: boolean, contrast: boolean): Palette {
  if (contrast) return dark ? palettes.darkContrast : palettes.lightContrast;
  return dark ? palettes.dark : palettes.light;
}

/** Blanc's colours for the system appearance, following Increase Contrast. */
export function useBlanc(): Palette {
  return paletteFor(useColorScheme() === 'dark', useIncreaseContrast());
}

/** Ink that follows the system appearance and Increase Contrast, for native chrome (tab bar, headers). */
export const dynamicInk =
  Platform.OS === 'ios'
    ? DynamicColorIOS({
        light: palettes.light.ink,
        dark: palettes.dark.ink,
        highContrastLight: palettes.lightContrast.ink,
        highContrastDark: palettes.darkContrast.ink,
      })
    : palettes.light.ink;

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
  /** Screen edge to text on the ground: the large title's edge, which every row and figure shares. */
  gutter: 16,
  /** Screen edge to a block's own edge (a button row, a control): the gutter. */
  inset: 16,
  /**
   * A Label's inner edge: rows and blocks keep 18 pt of padding, and the
   * Label reaches 2 pt past the screen edge, so their text lands on the gutter.
   */
  labelPad: 18,
  /** Between sections. */
  section: 26,
} as const;

export const radius = {
  /** A lifted surface's corners (a dragged row, a hold menu's preview). */
  label: 10,
} as const;

/**
 * How far to pull a big Thin figure left so its first digit's ink, not its
 * box, sits on the text edge. A tabular "1" is centred in a wide advance
 * (about an eighth of the size on either side); other digits carry a little
 * side bearing too.
 */
export function figureLead(text: string, size: number, opts?: { tabular?: boolean }): number {
  const first = text.trim().charAt(0);
  if (!/[0-9]/.test(first)) return 0;
  // Proportional digits (a hero that only rolls now and then) keep the "1" narrow, with a small bearing like the rest.
  const tabular = opts?.tabular ?? true;
  return -Math.round(size * (tabular && first === '1' ? 0.12 : 0.04));
}

/**
 * Figures shown at rest rather than counting: proportional digits, so a "1"
 * doesn't leave a gap before the next digit ("1 ,342"). Counting figures
 * (clocks, fields being typed in) keep the figure role's tabular digits.
 */
export const restingFigure = { fontVariant: [] as TextStyle['fontVariant'] };
