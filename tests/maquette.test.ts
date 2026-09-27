import { describe, expect, it } from 'vitest';
import {
  BODY_SOLIDS,
  MUSCLE_PARTS,
  mixRgb,
  muscleColor,
  parseColor,
  projectX,
  shadeMuscles,
  visibleFrom,
} from '../src/lib/maquette';
import type { MuscleVolume } from '../src/types';

const volume = (muscle_group: MuscleVolume['muscle_group'], weekly_sets: number, status: MuscleVolume['status']): MuscleVolume => ({
  muscle_group,
  weekly_sets,
  status,
});

describe('volume maquette', () => {
  it('draws every rendered muscle symmetrically except midline regions', () => {
    const counts = new Map<string, number>();
    for (const part of MUSCLE_PARTS) counts.set(part.muscle, (counts.get(part.muscle) ?? 0) + 1);
    expect(counts.get('core')).toBe(1);
    expect(counts.get('traps')).toBe(1);
    for (const muscle of ['chest', 'back', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'front_delts', 'side_delts', 'rear_delts']) {
      expect(counts.get(muscle)).toBe(2);
    }
    expect(BODY_SOLIDS.length).toBeGreaterThan(10);
  });

  it('shades trained muscles by status and leaves untrained ones bare', () => {
    const shades = shadeMuscles([
      volume('chest', 12, 'mav'),
      volume('quads', 4, 'below_mev'),
      volume('side_delts', 26, 'above_mrv'),
      volume('calves', 0, 'below_mev'),
    ]);
    expect(shades.get('chest')).toMatchObject({ ink: 0.62, hot: false, sets: 12 });
    expect(shades.get('quads')?.ink).toBe(0.2);
    expect(shades.get('side_delts')).toMatchObject({ hot: true, sets: 26 });
    expect(shades.get('calves')?.ink).toBe(0);
    expect(shades.get('back')).toMatchObject({ ink: 0, hot: false, sets: 0, status: null });
  });

  it('lets general shoulder volume stand in for untracked deltoid heads', () => {
    const shades = shadeMuscles([volume('shoulders', 10, 'mev_mav'), volume('rear_delts', 6, 'mav')]);
    expect(shades.get('front_delts')?.ink).toBe(0.4);
    expect(shades.get('side_delts')?.ink).toBe(0.4);
    expect(shades.get('rear_delts')?.ink).toBe(0.62);
  });

  it('mixes colours from theme tokens', () => {
    expect(parseColor('#fff', [0, 0, 0])).toEqual([1, 1, 1]);
    expect(parseColor('#A8352A', [0, 0, 0])[0]).toBeCloseTo(0xa8 / 255);
    expect(parseColor('rgb(10, 20, 30)', [0, 0, 0])).toEqual([10 / 255, 20 / 255, 30 / 255]);
    expect(parseColor('var(--x)', [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
    const palette = { body: [1, 1, 1] as [number, number, number], ink: [0, 0, 0] as [number, number, number], accent: [1, 0, 0] as [number, number, number] };
    expect(muscleColor(undefined, palette)).toEqual([1, 1, 1]);
    expect(muscleColor({ muscle: 'chest', ink: 0.5, hot: false, sets: 8, status: 'mev_mav' }, palette)).toEqual([0.5, 0.5, 0.5]);
    expect(muscleColor({ muscle: 'chest', ink: 0.84, hot: true, sets: 30, status: 'above_mrv' }, palette)).toEqual([1, 0, 0]);
  });

  it('projects front and back views', () => {
    const chest = MUSCLE_PARTS.find((part) => part.muscle === 'chest')!.solid;
    const back = MUSCLE_PARTS.find((part) => part.muscle === 'back')!.solid;
    const core = MUSCLE_PARTS.find((part) => part.muscle === 'core')!.solid;
    expect(visibleFrom(chest, 'front')).toBe(true);
    expect(visibleFrom(chest, 'back')).toBe(false);
    expect(visibleFrom(back, 'back')).toBe(true);
    expect(visibleFrom(core, 'front')).toBe(true);
    expect(projectX(0.3, 'front')).toBe(0.3);
    expect(projectX(0.3, 'back')).toBe(-0.3);
  });
});
