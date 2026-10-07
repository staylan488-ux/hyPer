import { describe, expect, it } from 'vitest';
import { BODY_PATHS, MAP_REGIONS, STATUS_INK, isSubjectMuscle, isSubjectUnder, isUnderStimulated, muscleFill, primarySide, shadeMuscles } from '../src/lib/volumeMap';
import { isPluralMuscle, muscleSubject } from '../src/lib/muscleCopy';
import type { MuscleVolume } from '../src/types';

const volume = (muscle_group: MuscleVolume['muscle_group'], weekly_sets: number, status: MuscleVolume['status']): MuscleVolume => ({
  muscle_group,
  weekly_sets,
  status,
});

describe('volume map', () => {
  it('draws every tracked muscle on the view it is read from', () => {
    const sides = (muscle: string) => new Set(MAP_REGIONS.filter((region) => region.muscle === muscle).map((region) => region.side));
    for (const muscle of ['chest', 'core', 'biceps', 'quads', 'front_delts']) expect(sides(muscle)).toEqual(new Set(['front']));
    for (const muscle of ['back', 'triceps', 'glutes', 'hamstrings', 'rear_delts']) expect(sides(muscle)).toEqual(new Set(['back']));
    for (const muscle of ['traps', 'side_delts', 'calves']) expect(sides(muscle)).toEqual(new Set(['front', 'back']));
    expect(BODY_PATHS.length).toBeGreaterThan(4);
    expect(primarySide('hamstrings')).toBe('back');
    expect(primarySide('side_delts')).toBe('front');
  });

  it('shades trained muscles by status and leaves untrained ones bare', () => {
    const shades = shadeMuscles([
      volume('chest', 12, 'mav'),
      volume('quads', 4, 'below_mev'),
      volume('side_delts', 26, 'above_mrv'),
      volume('calves', 0, 'below_mev'),
    ]);
    expect(shades.get('chest')).toMatchObject({ ink: STATUS_INK.mav, hot: false, sets: 12 });
    expect(shades.get('quads')?.ink).toBe(STATUS_INK.below_mev);
    expect(shades.get('side_delts')).toMatchObject({ hot: true, sets: 26 });
    expect(shades.get('calves')?.ink).toBe(0);
    expect(shades.get('back')).toMatchObject({ ink: 0, hot: false, sets: 0, status: null });
  });

  it('lets general shoulder volume stand in for untracked deltoid heads', () => {
    const shades = shadeMuscles([volume('shoulders', 10, 'mev_mav'), volume('rear_delts', 6, 'mav')]);
    expect(shades.get('front_delts')?.ink).toBe(STATUS_INK.mev_mav);
    expect(shades.get('side_delts')?.ink).toBe(STATUS_INK.mev_mav);
    expect(shades.get('rear_delts')?.ink).toBe(STATUS_INK.mav);
  });

  it('fills from theme tokens, lacquer only past the ceiling', () => {
    const shades = shadeMuscles([volume('chest', 12, 'mav'), volume('side_delts', 26, 'above_mrv'), volume('back', 22, 'approaching_mrv')]);
    expect(muscleFill(shades.get('side_delts'))).toBe('var(--color-accent)');
    expect(muscleFill(shades.get('back'))).not.toContain('accent');
    expect(muscleFill(shades.get('chest'))).toBe('color-mix(in srgb, var(--color-text) 76%, var(--color-base))');
    expect(muscleFill(shades.get('quads'))).toBe('color-mix(in srgb, var(--color-text) 10%, var(--color-base))');
  });
});

describe('figure that illustrates one sentence', () => {
  it('names the subject (any deltoid head for shoulders) and whether it is under MEV', () => {
    const shades = shadeMuscles([volume('hamstrings', 5, 'below_mev'), volume('side_delts', 23, 'above_mrv'), volume('back', 21, 'approaching_mrv')]);
    // Every muscle keeps Progress's tone beside a sentence; the subject is
    // marked by its seam, so only its identity and status are asked here.
    expect(isSubjectUnder(shades.get('hamstrings'))).toBe(true);
    expect(isSubjectUnder(shades.get('back'))).toBe(false);
    expect(muscleFill(shades.get('side_delts'))).toBe('var(--color-accent)');
    expect(isSubjectMuscle('rear_delts', 'shoulders')).toBe(true);
    expect(isSubjectMuscle('chest', 'hamstrings')).toBe(false);
    expect(primarySide('shoulders')).toBe('front');
  });

  it('marks trained muscles still under MEV as hollow', () => {
    const shades = shadeMuscles([volume('hamstrings', 5, 'below_mev'), volume('calves', 0, 'below_mev'), volume('chest', 12, 'mav')]);
    expect(isUnderStimulated(shades.get('hamstrings'))).toBe(true);
    expect(isUnderStimulated(shades.get('calves'))).toBe(false);
    expect(isUnderStimulated(shades.get('chest'))).toBe(false);
  });
});

describe('muscle copy', () => {
  it('agrees in number with the muscle name', () => {
    expect(muscleSubject('hamstrings')).toEqual({ name: 'Hamstrings', is: 'are', its: 'their' });
    expect(muscleSubject('side_delts').is).toBe('are');
    expect(muscleSubject('chest')).toEqual({ name: 'Chest', is: 'is', its: 'its' });
    expect(muscleSubject('core')).toEqual({ name: 'Core', is: 'is', its: 'its' });
    expect(muscleSubject('shoulders')).toEqual({ name: 'Shoulders', is: 'are', its: 'their' });
    expect(isPluralMuscle('back')).toBe(false);
    expect(isPluralMuscle('calves')).toBe(true);
  });
});

describe('figure tones', () => {
  // Theme tokens from index.css: Ivory #232323 on #F5F5F0 (body 10%, under
  // 32%), Black #F2F2F2 on #000000 (body 18%, under 33%, status inks 13%
  // toward the page).
  const lum = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const ratio = (a: number, b: number) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const mix = (text: number, base: number, ink: number) => text * ink + base * (1 - ink);

  const lightUnder = mix(0x23, 0xF5, 0.32);
  const darkUnder = mix(0xF2, 0, 0.33);

  it('keeps under at least 1.6:1 from the untrained body in both themes', () => {
    expect(ratio(lightUnder, mix(0x23, 0xF5, 0.1))).toBeGreaterThanOrEqual(1.6);
    expect(ratio(darkUnder, mix(0xF2, 0, 0.18))).toBeGreaterThanOrEqual(1.6);
  });

  it('keeps the first in-range step at least 2:1 from the under tone in both themes', () => {
    expect(ratio(mix(0x23, 0xF5, STATUS_INK.mev_mav), lightUnder)).toBeGreaterThanOrEqual(2);
    expect(ratio(mix(0xF2, 0, STATUS_INK.mev_mav) * 0.87, darkUnder)).toBeGreaterThanOrEqual(2);
  });
});
