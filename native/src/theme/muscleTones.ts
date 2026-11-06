// The volume tones Progress shares between the muscle figure and the rows'
// rails, so "in range" reads as one tone wherever it shows: the figure's
// in-range fill, the key's swatch and the rail's in-range band are all `in`,
// and an open row's best range is `best`, a deeper step of the same tone.
// The hook is in useMuscleTones.
/**
 * Set by hand for each card. The body and any muscle not trained this week
 * sit just off the card, held by a 1 pt contour (on the light card graphite
 * at about 30% on white; lighter and wider on the dark card, so the body's
 * edge reads there). An untrained muscle draws nothing of its own, no fill
 * and no outline, so every marked shape on the figure means something. Below range, the state to act on, is a light fill
 * held by a strong outline (`belowEdge`, at least 4.5:1 against the body and
 * its own fill), the most legible mark on the figure; in range is a quieter
 * mid-tone fill (at least 3:1 against the body, less than the outline, never
 * near white on the dark card), and over is the live red. `in`, as the rail's
 * band, is at least 2:1 against the track in every palette, and `best` at
 * least 2:1 against `in`.
 */
export const MUSCLE_TONES = {
  light: { body: '#F6F5F2', contour: '#D1D1CF', below: '#E4E3DE', belowEdge: '#55554F', in: '#85857F', best: '#4A4A45' },
  lightContrast: { body: '#EFEEE9', contour: '#A9A8A2', below: '#DCDBD5', belowEdge: '#33332D', in: '#7A7A75', best: '#3A3A35' },
  dark: { body: '#252524', contour: '#555553', below: '#363634', belowEdge: '#BDBDB7', in: '#7E7E79', best: '#C2C2BC' },
  darkContrast: { body: '#2D2D2C', contour: '#77776F', below: '#40403E', belowEdge: '#DCDCD6', in: '#96968F', best: '#DADAD4' },
} as const;

export type MuscleTones = (typeof MUSCLE_TONES)[keyof typeof MUSCLE_TONES];

/** The volume tones for an appearance, with or without Increase Contrast. */
export function muscleTonesFor(dark: boolean, contrast: boolean): MuscleTones {
  return MUSCLE_TONES[`${dark ? 'dark' : 'light'}${contrast ? 'Contrast' : ''}`];
}
