import { describe, expect, it } from 'vitest';

import { calculateE1RM, compareSetPerformance, formatSetPerformanceTarget } from '@/lib/workoutProgress';

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
