import { describe, expect, it } from 'vitest';

import { formatMinutes, formatSet, formatTarget } from '../native/src/lib/format';

describe('native set and target formats', () => {
  it('writes a set with its load, and a bodyweight set by its reps', () => {
    expect(formatSet(80, 10)).toBe('80 lb × 10');
    expect(formatSet(102.5, 6)).toBe('102.5 lb × 6');
    expect(formatSet(80, 10, { unit: false })).toBe('80 × 10');
    expect(formatSet(60, 0)).toBe('60 lb × 0');
    // Calisthenics sets carry no load: never "0 lb".
    expect(formatSet(0, 10)).toBe('10 reps');
    expect(formatSet(null, 1)).toBe('1 rep');
    expect(formatSet(0, 0)).toBe('0 reps');
    expect(formatSet(80, null)).toBe('80 lb');
    expect(formatSet(80, null, { unit: false })).toBe('80');
    expect(formatSet(null, null)).toBe('');
    expect(formatSet(0, null)).toBe('');
  });

  it('writes a target one way, with a set range and equal reps', () => {
    expect(formatTarget(4, 8, 10)).toBe('4 × 8–10');
    expect(formatTarget(5, 5, 5)).toBe('5 × 5');
    expect(formatTarget(4, 8, null)).toBe('4 × 8');
    expect(formatTarget(4, 8, 12, { min: 3, max: 5 })).toBe('3–5 × 8–12');
    expect(formatTarget(4, 8, 12, { min: 4, max: 4 })).toBe('4 × 8–12');
    expect(formatTarget(4, null, null)).toBe('4 sets');
    expect(formatTarget(1, 0, 0)).toBe('1 set');
    expect(formatTarget(4, null, null, { min: 3, max: 5 })).toBe('3–5 sets');
  });

  it('writes minutes and hours', () => {
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(23)).toBe('23 min');
    expect(formatMinutes(60)).toBe('1 h');
    expect(formatMinutes(65)).toBe('1 h 5 min');
  });
});
