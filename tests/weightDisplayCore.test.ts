import { describe, expect, it } from 'vitest';

import {
  WEIGHT_UNIT_KEY,
  formatWeight,
  getPreferredWeightUnit,
  kgToUnit,
  setPreferredWeightUnit,
  weightTrendDelta,
} from '@/lib/weightDisplayCore';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe('weight display', () => {
  it('converts and formats kilograms in both units', () => {
    expect(kgToUnit(80, 'kg')).toBe(80);
    expect(formatWeight(80, 'kg')).toBe('80.0');
    expect(formatWeight(80, 'lb')).toBe('176.4');
  });

  it('computes the latest-versus-previous trend in the display unit', () => {
    // newest first, matching the query ordering
    expect(weightTrendDelta([81.2, 80.6], 'kg')).toBe(0.6);
    expect(weightTrendDelta([80.6, 81.2], 'lb')).toBe(-1.3);
  });

  it('returns null trend with fewer than two entries', () => {
    expect(weightTrendDelta([], 'kg')).toBeNull();
    expect(weightTrendDelta([80], 'kg')).toBeNull();
  });

  it('persists the unit preference and defaults to pounds', () => {
    const storage = memoryStorage();
    expect(getPreferredWeightUnit(storage)).toBe('lb');
    setPreferredWeightUnit('kg', storage);
    expect(storage.getItem(WEIGHT_UNIT_KEY)).toBe('kg');
    expect(getPreferredWeightUnit(storage)).toBe('kg');
  });
});
