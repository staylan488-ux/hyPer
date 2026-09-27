import { describe, expect, it } from 'vitest';

import { calculateE1RM, collectSessionGains, compareSetPerformance, describeSetGain, formatSetPerformanceTarget, sessionTonnage } from '@/lib/workoutProgress';

describe('workoutProgress', () => {
  it('calculates e1RM with Epley formula', () => {
    expect(calculateE1RM(200, 5)).toBeCloseTo(233.333, 3);
    expect(calculateE1RM(0, 8)).toBe(0);
    expect(calculateE1RM(185, 0)).toBeNull();
  });

  it('marks beat when reps improve at same weight', () => {
    expect(compareSetPerformance(
      { weight: 185, reps: 9 },
      { weight: 185, reps: 8 }
    )).toBe('beat');
  });

  it('marks beat when weight improves at same reps', () => {
    expect(compareSetPerformance(
      { weight: 190, reps: 8 },
      { weight: 185, reps: 8 }
    )).toBe('beat');
  });

  it('does not mark beat if heavier weight comes with too few reps (lower e1RM)', () => {
    expect(compareSetPerformance(
      { weight: 205, reps: 5 },
      { weight: 200, reps: 8 }
    )).toBe('below');
  });

  it('marks matched for equivalent performance within tolerance', () => {
    expect(compareSetPerformance(
      { weight: 185, reps: 8 },
      { weight: 185, reps: 8 }
    )).toBe('matched');

    expect(compareSetPerformance(
      { weight: 180, reps: 10 },
      { weight: 200, reps: 6 }
    )).toBe('matched');
  });

  it('returns unknown when either set is incomplete', () => {
    expect(compareSetPerformance(
      { weight: null, reps: 8 },
      { weight: 185, reps: 8 }
    )).toBe('unknown');

    expect(compareSetPerformance(
      { weight: 185, reps: 8 },
      { weight: 185, reps: null }
    )).toBe('unknown');
  });

  it('formats target labels for inline UI', () => {
    expect(formatSetPerformanceTarget({ weight: 185, reps: 8 })).toBe('185 × 8');
    expect(formatSetPerformanceTarget({ weight: 62.5, reps: 10 })).toBe('62.5 × 10');
    expect(formatSetPerformanceTarget({ weight: '185.0', reps: '8' })).toBe('185 × 8');
    expect(formatSetPerformanceTarget({ weight: null, reps: 10 })).toBe('');
  });

  it('supports numeric strings from API responses', () => {
    expect(compareSetPerformance(
      { weight: '190.0', reps: '8' },
      { weight: '185.0', reps: '8' }
    )).toBe('beat');
  });
});

describe('set gains', () => {
  it('names the single dimension that improved', () => {
    expect(describeSetGain({ weight: 100, reps: 9 }, { weight: 100, reps: 8 })).toBe('+1 rep');
    expect(describeSetGain({ weight: 100, reps: 10 }, { weight: 100, reps: 8 })).toBe('+2 reps');
    expect(describeSetGain({ weight: 105, reps: 8 }, { weight: 100, reps: 8 })).toBe('+5 lb');
    expect(describeSetGain({ weight: 102.5, reps: 8 }, { weight: 100, reps: 8 })).toBe('+2.5 lb');
  });

  it('names both gains when weight and reps both rose', () => {
    expect(describeSetGain({ weight: 80, reps: 10 }, { weight: 60, reps: 9 })).toBe('+20 lb · +1 rep');
  });

  it('falls back to estimated max when reps were traded for weight', () => {
    expect(describeSetGain({ weight: 110, reps: 7 }, { weight: 100, reps: 8 })).toMatch(/^\+\d+(\.\d)? lb est\. max$/);
  });

  it('stays quiet unless the set clearly beat last time', () => {
    expect(describeSetGain({ weight: 100, reps: 8 }, { weight: 100, reps: 8 })).toBeNull();
    expect(describeSetGain({ weight: 95, reps: 8 }, { weight: 100, reps: 8 })).toBeNull();
    expect(describeSetGain({ weight: null, reps: 8 }, { weight: 100, reps: 8 })).toBeNull();
  });

  it('collects completed session gains in order and totals tonnage', () => {
    const sets = [
      { exercise_id: 'bench', set_number: 1, weight: 185, reps: 8, completed: true },
      { exercise_id: 'bench', set_number: 2, weight: 185, reps: 7, completed: true },
      { exercise_id: 'row', set_number: 1, weight: 140, reps: 11, completed: true },
      { exercise_id: 'row', set_number: 2, weight: 150, reps: 10, completed: false },
    ];
    const previous = {
      bench: { 1: { weight: 180, reps: 8 }, 2: { weight: 185, reps: 8 } },
      row: { 1: { weight: 140, reps: 10 }, 2: { weight: 140, reps: 10 } },
    };
    expect(collectSessionGains(sets, previous)).toEqual([
      { exerciseId: 'bench', setNumber: 1, gain: '+5 lb' },
      { exerciseId: 'row', setNumber: 1, gain: '+1 rep' },
    ]);
    expect(sessionTonnage(sets)).toBe(185 * 8 + 185 * 7 + 140 * 11);
  });
});
