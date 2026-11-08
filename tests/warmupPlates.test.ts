import { describe, expect, it } from 'vitest';

import {
  defaultBarFor,
  describePlates,
  isBarbellMovement,
  loadBarWeights,
  loadPlates,
  offersWarmup,
  saveBarWeight,
  warmupSteps,
} from '../src/lib/warmupPlates';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    items,
  };
}

describe('loadPlates', () => {
  it('loads each side heaviest first', () => {
    expect(loadPlates(225, 45)).toEqual({ perSide: [45, 45], total: 225, exact: true });
    expect(loadPlates(185, 45)).toEqual({ perSide: [45, 25], total: 185, exact: true });
    expect(loadPlates(150, 45)).toEqual({ perSide: [45, 5, 2.5], total: 150, exact: true });
    expect(loadPlates(320, 45)).toEqual({ perSide: [45, 45, 45, 2.5], total: 320, exact: true });
  });

  it('is just the bar at the bar’s weight, and nothing below it', () => {
    expect(loadPlates(45, 45)).toEqual({ perSide: [], total: 45, exact: true });
    expect(loadPlates(40, 45)).toBeNull();
    expect(loadPlates(Number.NaN, 45)).toBeNull();
  });

  it('loads the closest weight under one between plate steps', () => {
    expect(loadPlates(187, 45)).toEqual({ perSide: [45, 25], total: 185, exact: false });
    expect(loadPlates(137.5, 45)).toEqual({ perSide: [45], total: 135, exact: false });
  });

  it('follows the bar picked', () => {
    expect(loadPlates(95, 25)).toEqual({ perSide: [25, 10], total: 95, exact: true });
    expect(loadPlates(95, 35)).toEqual({ perSide: [25, 5], total: 95, exact: true });
  });
});

describe('describePlates', () => {
  it('names one side’s plates in order', () => {
    expect(describePlates([45, 25, 2.5])).toBe('45 · 25 · 2.5');
    expect(describePlates([])).toBe('');
  });
});

describe('isBarbellMovement and defaultBarFor', () => {
  it('reads barbells from the equipment or the name', () => {
    expect(isBarbellMovement({ name: 'Barbell Back Squat', equipment: 'barbell' })).toBe(true);
    expect(isBarbellMovement({ name: 'Skull Crushers', equipment: 'Barbell' })).toBe(true);
    expect(isBarbellMovement({ name: 'EZ Bar Curl', equipment: null })).toBe(true);
    expect(isBarbellMovement({ name: 'Smith Machine Squat', equipment: 'machine' })).toBe(true);
    expect(isBarbellMovement({ name: 'Incline Dumbbell Press', equipment: 'dumbbells' })).toBe(false);
    expect(isBarbellMovement({ name: 'Front Lever', equipment: 'bodyweight' })).toBe(false);
    expect(isBarbellMovement(null)).toBe(false);
  });

  it('starts an EZ bar at 25 lb and any other at 45', () => {
    expect(defaultBarFor({ name: 'EZ Bar Curl', equipment: 'barbell' })).toBe(25);
    expect(defaultBarFor({ name: 'Barbell Row', equipment: 'barbell' })).toBe(45);
    expect(defaultBarFor(null)).toBe(45);
  });
});

describe('warmupSteps', () => {
  it('ramps a barbell from the empty bar, moving each step to load with fewer plates', () => {
    expect(warmupSteps({ working: 225, barbell: true })).toEqual([
      { weight: 45, reps: 10, bar: true },
      { weight: 95, reps: 5, bar: false },
      { weight: 135, reps: 3, bar: false },
      { weight: 185, reps: 2, bar: false },
    ]);
    expect(warmupSteps({ working: 315, barbell: true }).map((step) => step.weight)).toEqual([45, 135, 185, 245]);
    expect(warmupSteps({ working: 135, barbell: true }).map((step) => step.weight)).toEqual([45, 55, 85, 105]);
  });

  it('leaves out steps too close to the bar, each other or the working weight', () => {
    expect(warmupSteps({ working: 95, barbell: true })).toEqual([
      { weight: 45, reps: 10, bar: true },
      { weight: 55, reps: 3, bar: false },
      { weight: 75, reps: 2, bar: false },
    ]);
    expect(warmupSteps({ working: 65, barbell: true })).toEqual([
      { weight: 45, reps: 10, bar: true },
      { weight: 55, reps: 2, bar: false },
    ]);
    expect(warmupSteps({ working: 60, barbell: true })).toEqual([{ weight: 45, reps: 10, bar: true }]);
    expect(warmupSteps({ working: 50, barbell: true })).toEqual([]);
    expect(warmupSteps({ working: 45, barbell: true })).toEqual([]);
  });

  it('starts from the bar picked', () => {
    expect(warmupSteps({ working: 85, barbell: true, bar: 25 })).toEqual([
      { weight: 25, reps: 10, bar: true },
      { weight: 35, reps: 5, bar: false },
      { weight: 50, reps: 3, bar: false },
      { weight: 65, reps: 2, bar: false },
    ]);
  });

  it('gives dumbbells and machines two lighter sets', () => {
    expect(warmupSteps({ working: 80, barbell: false })).toEqual([
      { weight: 40, reps: 8, bar: false },
      { weight: 60, reps: 4, bar: false },
    ]);
    expect(warmupSteps({ working: 20, barbell: false })).toEqual([{ weight: 10, reps: 8, bar: false }, { weight: 15, reps: 4, bar: false }]);
    expect(warmupSteps({ working: 15, barbell: false })).toEqual([]);
  });

  it('has nothing for no weight', () => {
    expect(warmupSteps({ working: 0, barbell: true })).toEqual([]);
    expect(warmupSteps({ working: Number.NaN, barbell: false })).toEqual([]);
  });
});

describe('offersWarmup', () => {
  const squat = { name: 'Barbell Back Squat', equipment: 'barbell', is_compound: true };
  const press = { name: 'Machine Chest Press', equipment: 'machine', is_compound: true };
  const raise = { name: 'Lateral Raise', equipment: 'dumbbells', is_compound: false };
  const pullUp = { name: 'Weighted Pull-up', equipment: 'bodyweight', is_compound: true };

  it('offers them before the first set of a barbell or compound movement', () => {
    expect(offersWarmup({ setNumber: 1, done: 0, working: 225, exercise: squat })).toBe(true);
    expect(offersWarmup({ setNumber: 1, done: 0, working: 120, exercise: press })).toBe(true);
  });

  it('never after a set is logged, on isolation or bodyweight work, or with no weight', () => {
    expect(offersWarmup({ setNumber: 2, done: 1, working: 225, exercise: squat })).toBe(false);
    expect(offersWarmup({ setNumber: 1, done: 1, working: 225, exercise: squat })).toBe(false);
    expect(offersWarmup({ setNumber: 1, done: 0, working: 40, exercise: raise })).toBe(false);
    expect(offersWarmup({ setNumber: 1, done: 0, working: 25, exercise: pullUp })).toBe(false);
    expect(offersWarmup({ setNumber: 1, done: 0, working: null, exercise: squat })).toBe(false);
    expect(offersWarmup({ setNumber: 1, done: 0, working: 50, exercise: squat })).toBe(false);
  });
});

describe('bar weights on this device', () => {
  it('keeps each movement’s bar per account', () => {
    const storage = memoryStorage();
    expect(loadBarWeights('me', storage)).toEqual({});
    expect(saveBarWeight('me', 'curl', 25, storage)).toEqual({ curl: 25 });
    expect(saveBarWeight('me', 'squat', 35, storage)).toEqual({ curl: 25, squat: 35 });
    expect(loadBarWeights('me', storage)).toEqual({ curl: 25, squat: 35 });
    expect(loadBarWeights('someone else', storage)).toEqual({});
  });

  it('ignores damaged or strange values', () => {
    const storage = memoryStorage();
    storage.setItem('hyper:bar-weights:me', 'not json');
    expect(loadBarWeights('me', storage)).toEqual({});
    storage.setItem('hyper:bar-weights:me', JSON.stringify({ a: 45, b: 'x', c: -5, d: 9999 }));
    expect(loadBarWeights('me', storage)).toEqual({ a: 45 });
    expect(saveBarWeight('me', 'e', Number.NaN, storage)).toEqual({ a: 45 });
  });

  it('reads nothing without an account', () => {
    expect(loadBarWeights(null, memoryStorage())).toEqual({});
  });
});
