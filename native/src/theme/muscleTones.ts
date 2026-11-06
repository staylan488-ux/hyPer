// The body tones Progress's muscle figure draws on, and the deeper step an
// open row's rail uses for its best range. The marks that carry a muscle's
// state come from the palette instead, so they match the rest of the app:
// below range is an ink outline over a light fill, in range is `mark` (3:1 or
// more on the body and the card), over is the live red.
// The hook is in useMuscleTones.
/**
 * Set by hand for each card. The body and any muscle not trained this week
 * sit just off the card, held by a 1 pt contour (on the light card graphite
 * at about 30% on white; lighter and wider on the dark card, so the body's
 * edge reads there). An untrained muscle draws nothing of its own, no fill
 * and no outline, so every marked shape on the figure means something.
 * `best` is at least 2:1 against `mark`, the rail's in-range band.
 */
export const MUSCLE_TONES = {
  light: { body: '#F6F5F2', contour: '#D1D1CF', below: '#E4E3DE', best: '#4A4A45' },
  lightContrast: { body: '#EFEEE9', contour: '#A9A8A2', below: '#DCDBD5', best: '#3A3A35' },
  dark: { body: '#252524', contour: '#555553', below: '#363634', best: '#C2C2BC' },
  darkContrast: { body: '#2D2D2C', contour: '#77776F', below: '#40403E', best: '#DADAD4' },
} as const;

export type MuscleTones = (typeof MUSCLE_TONES)[keyof typeof MUSCLE_TONES];

/** The volume tones for an appearance, with or without Increase Contrast. */
export function muscleTonesFor(dark: boolean, contrast: boolean): MuscleTones {
  return MUSCLE_TONES[`${dark ? 'dark' : 'light'}${contrast ? 'Contrast' : ''}`];
}
