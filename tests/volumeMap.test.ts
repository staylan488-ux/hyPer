import { describe, expect, it } from 'vitest';
import { BODY_INK, BODY_PATHS, MAP_REGIONS, STATUS_INK, inkFill, isSubjectMuscle, isSubjectUnder, isUnderStimulated, muscleFill, primarySide, shadeMuscles, subjectFill } from '../src/lib/volumeMap';
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
    expect(muscleFill(shades.get('chest'))).toBe('color-mix(in srgb, var(--color-text) 64%, var(--color-base))');
    expect(muscleFill(shades.get('quads'))).toBe('color-mix(in srgb, var(--color-text) 10%, var(--color-base))');
  });
});

describe('figure that illustrates one sentence', () => {
  it('draws only the subject, in its legend style, lacquer only when the sentence is about the ceiling', () => {
    const shades = shadeMuscles([volume('hamstrings', 5, 'below_mev'), volume('side_delts', 23, 'above_mrv'), volume('back', 21, 'approaching_mrv')]);
    // Under MEV is the legend's hollow "Under": the body tone inside an outline, never a solid fill.
    expect(isSubjectUnder(shades.get('hamstrings'))).toBe(true);
    expect(subjectFill(shades.get('hamstrings'), true)).toBe(inkFill(BODY_INK));
    // Nearing the ceiling keeps the legend's heaviest ink.
    expect(isSubjectUnder(shades.get('back'))).toBe(false);
    expect(subjectFill(shades.get('back'), true)).toBe(muscleFill(shades.get('back')));
    // Over-ceiling side delts stay silhouette when the sentence is about hamstrings.
    expect(subjectFill(shades.get('side_delts'), false)).toBe(inkFill(BODY_INK));
    expect(subjectFill(shades.get('side_delts'), true)).toBe('var(--color-accent)');
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
