// The body tones Progress's muscle figure draws on. The marks that carry a
// muscle's state come from the palette instead, so they match the rest of the
// app: under way is a graphite outline over the light `below` fill (3:1 or
// more against both), done is `mark` (3:1 or more on the body and the card).
/**
 * Set by hand for each card. The body and any muscle not trained this week
 * sit just off the card, held by a 1 pt contour (on the light card graphite
 * at about 30% on white; lighter and wider on the dark card, so the body's
 * edge reads there). An untrained muscle draws nothing of its own, no fill
 * and no outline, so every marked shape on the figure means something.
 */
export const MUSCLE_TONES = {
  light: { body: '#F6F5F2', contour: '#D1D1CF', below: '#E4E3DE' },
  lightContrast: { body: '#EFEEE9', contour: '#A9A8A2', below: '#DCDBD5' },
  dark: { body: '#252524', contour: '#555553', below: '#363634' },
  darkContrast: { body: '#2D2D2C', contour: '#77776F', below: '#40403E' },
} as const;

export type MuscleTones = (typeof MUSCLE_TONES)[keyof typeof MUSCLE_TONES];

/** The volume tones for an appearance, with or without Increase Contrast. */
export function muscleTonesFor(dark: boolean, contrast: boolean): MuscleTones {
  return MUSCLE_TONES[`${dark ? 'dark' : 'light'}${contrast ? 'Contrast' : ''}`];
}
