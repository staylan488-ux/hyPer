import { describe, expect, it } from 'vitest';

import {
  isHealthWeightSyncEnabled,
  normalizeNativeWeightSample,
  setHealthWeightSyncEnabled,
} from '@/lib/healthWeightCore';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('HealthKit body-weight normalization', () => {
  it('normalizes a valid HealthKit sample for idempotent storage', () => {
    expect(normalizeNativeWeightSample('user-1', {
      id: 'health-uuid',
      measuredAt: '2026-07-19T15:00:00Z',
      kilograms: 82.45,
      sourceBundle: 'com.oceanwing.EufyLife',
      sourceName: 'EufyLife',
    })).toEqual({
      user_id: 'user-1',
      source: 'apple_health',
      external_id: 'health-uuid',
      measured_at: '2026-07-19T15:00:00.000Z',
      kilograms: 82.45,
      source_bundle: 'com.oceanwing.EufyLife',
      source_name: 'EufyLife',
    });
  });

  it('rejects impossible weights and invalid dates', () => {
    const base = {
      id: 'health-uuid',
      measuredAt: '2026-07-19T15:00:00Z',
      kilograms: 82,
      sourceBundle: 'source',
      sourceName: 'Scale',
    };
    expect(normalizeNativeWeightSample('user-1', { ...base, kilograms: 0 })).toBeNull();
    expect(normalizeNativeWeightSample('user-1', { ...base, kilograms: 700 })).toBeNull();
    expect(normalizeNativeWeightSample('user-1', { ...base, measuredAt: 'bad' })).toBeNull();
  });

  it('persists the opt-in flag explicitly', () => {
    const storage = memoryStorage();
    expect(isHealthWeightSyncEnabled(storage)).toBe(false);
    setHealthWeightSyncEnabled(true, storage);
    expect(isHealthWeightSyncEnabled(storage)).toBe(true);
    setHealthWeightSyncEnabled(false, storage);
    expect(isHealthWeightSyncEnabled(storage)).toBe(false);
  });
});
