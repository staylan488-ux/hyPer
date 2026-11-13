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

const sets = (entries: Record<string, number>) => new Map(Object.entries(entries));

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

  it('shades each muscle by how far it is through the week, never as a warning', () => {
    const shades = shadeMuscles(sets({ chest: 6, quads: 2, side_delts: 12, calves: 0 }), sets({ chest: 6, quads: 10, side_delts: 6, calves: 4 }));
    expect(shades.get('chest')).toMatchObject({ state: 'done', ink: 0.62, done: 6, planned: 6 });
    expect(shades.get('quads')).toMatchObject({ state: 'under_way', ink: 0.3, done: 2, planned: 10 });
    // Past the plan is still done.
    expect(shades.get('side_delts')).toMatchObject({ state: 'done', done: 12 });
    expect(shades.get('calves')).toMatchObject({ state: 'untouched', ink: 0 });
    expect(shades.get('back')).toMatchObject({ state: 'untouched', done: 0, planned: 0 });
  });

  it('counts sets off the plan as done, and anything trained as done with no plan', () => {
    expect(shadeMuscles(sets({ traps: 2 }), sets({})).get('traps')?.state).toBe('done');
    const free = shadeMuscles(sets({ chest: 1 }), null);
    expect(free.get('chest')).toMatchObject({ state: 'done', planned: null });
    expect(free.get('back')?.state).toBe('untouched');
  });

  it('mixes colours from theme tokens', () => {
    expect(parseColor('#fff', [0, 0, 0])).toEqual([1, 1, 1]);
    expect(parseColor('#A8352A', [0, 0, 0])[0]).toBeCloseTo(0xa8 / 255);
    expect(parseColor('rgb(10, 20, 30)', [0, 0, 0])).toEqual([10 / 255, 20 / 255, 30 / 255]);
    expect(parseColor('var(--x)', [0.5, 0.5, 0.5])).toEqual([0.5, 0.5, 0.5]);
    expect(mixRgb([0, 0, 0], [1, 1, 1], 0.25)).toEqual([0.25, 0.25, 0.25]);
    const palette = { body: [1, 1, 1] as [number, number, number], ink: [0, 0, 0] as [number, number, number] };
    expect(muscleColor(undefined, palette)).toEqual([1, 1, 1]);
    expect(muscleColor({ muscle: 'chest', state: 'under_way', ink: 0.5, done: 3, planned: 8 }, palette)).toEqual([0.5, 0.5, 0.5]);
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
