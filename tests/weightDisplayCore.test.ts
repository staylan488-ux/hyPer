import { describe, expect, it } from 'vitest';

import {
  WEIGHT_UNIT_KEY,
  formatWeight,
  getPreferredWeightUnit,
  kgToUnit,
  setPreferredWeightUnit,
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

  it('persists the unit preference and defaults to pounds', () => {
    const storage = memoryStorage();
    expect(getPreferredWeightUnit(storage)).toBe('lb');
    setPreferredWeightUnit('kg', storage);
    expect(storage.getItem(WEIGHT_UNIT_KEY)).toBe('kg');
    expect(getPreferredWeightUnit(storage)).toBe('kg');
  });
});
