// The volume tones Progress shares between the muscle figure and the rows'
// rails, so "in range" reads as one tone wherever it shows: the figure's
// in-range fill and the key's swatch at full strength, the rail's in-range
// band as the same tone at BAND_STRENGTH on the card, and the band's best
// range (an open row) at full strength again. The hook is in useMuscleTones.
/**
 * Set by hand for each card. The body and any muscle not trained this week
 * sit just off the card, held by a hairline contour, so every filled shape
 * on the figure means something: a clearly filled light-mid grey below
 * range, the strong tone in range, and the live red over. Each filled state
 * is at least about 1.8:1 from the body and from the others. `band` is `in`
 * at BAND_STRENGTH over the card (`label`), at least 2:1 against the track
 * in every palette.
 */
export const MUSCLE_TONES = {
  light: { body: '#F6F5F2', contour: '#D9D8D3', below: '#B9B8B2', in: '#4A4A45', band: '#92928F' },
  lightContrast: { body: '#EFEEE9', contour: '#A9A8A2', below: '#8E8D87', in: '#26261F', band: '#7D7D79' },
  dark: { body: '#252524', contour: '#484846', below: '#66665F', in: '#D4D4CE', band: '#8A8A86' },
  darkContrast: { body: '#2D2D2C', contour: '#5A5A56', below: '#6A6A64', in: '#F0F0EA', band: '#9E9E9A' },
} as const;

/** How strongly the rail's band shows the in-range tone over the card. */
export const BAND_STRENGTH = 0.6;

export type MuscleTones = (typeof MUSCLE_TONES)[keyof typeof MUSCLE_TONES];

/** The volume tones for an appearance, with or without Increase Contrast. */
export function muscleTonesFor(dark: boolean, contrast: boolean): MuscleTones {
  return MUSCLE_TONES[`${dark ? 'dark' : 'light'}${contrast ? 'Contrast' : ''}`];
}
