import { describe, expect, it } from 'vitest';

import { buildManualWeightMeasurement } from '@/lib/healthWeightCore';
import {
  ageFromBirthYear,
  birthYearFromAge,
  isNewPhase,
  todayIsoDate,
} from '@/lib/nutritionProfile';

describe('manual weigh-ins', () => {
  it('builds a row keyed on the measurement minute so resubmits are idempotent', () => {
    const at = new Date('2026-07-25T14:32:41Z');
    expect(buildManualWeightMeasurement('user-1', 82.4, at)).toEqual({
      user_id: 'user-1',
      source: 'manual',
      external_id: 'manual:2026-07-25T14:32',
      measured_at: '2026-07-25T14:32:41.000Z',
      kilograms: 82.4,
      source_bundle: 'manual',
      source_name: 'Manual entry',
    });
  });

  it('gives two entries in the same minute the same identity, a later one a new identity', () => {
    const first = buildManualWeightMeasurement('user-1', 82.4, new Date('2026-07-25T14:32:01Z'));
    const same = buildManualWeightMeasurement('user-1', 82.6, new Date('2026-07-25T14:32:59Z'));
    const later = buildManualWeightMeasurement('user-1', 82.6, new Date('2026-07-25T14:33:00Z'));

    expect(same?.external_id).toBe(first?.external_id);
    expect(later?.external_id).not.toBe(first?.external_id);
  });

  it('rejects implausible weights rather than writing them', () => {
    const at = new Date('2026-07-25T14:32:00Z');
    expect(buildManualWeightMeasurement('user-1', 0, at)).toBeNull();
    expect(buildManualWeightMeasurement('user-1', -5, at)).toBeNull();
    expect(buildManualWeightMeasurement('user-1', 500, at)).toBeNull();
    expect(buildManualWeightMeasurement('user-1', NaN, at)).toBeNull();
    expect(buildManualWeightMeasurement('user-1', 82, new Date('nonsense'))).toBeNull();
  });
});

describe('age from birth year', () => {
  it('round-trips so a stored profile never goes stale', () => {
    const now = new Date('2026-07-25T00:00:00Z');
    const birthYear = birthYearFromAge(30, now);
    expect(birthYear).toBe(1996);
    expect(ageFromBirthYear(birthYear, now)).toBe(30);
  });

  it('reports an older age as the years roll over', () => {
    const birthYear = birthYearFromAge(30, new Date('2026-07-25T00:00:00Z'));
    expect(ageFromBirthYear(birthYear, new Date('2029-07-25T00:00:00Z'))).toBe(33);
  });
});

describe('phase detection', () => {
  const base = { goal: 'cut' as const, rate_pct_per_week: -0.7 };

  it('treats a first profile as a new phase', () => {
    expect(isNewPhase(null, base)).toBe(true);
  });

  it('flags a changed goal or a changed rate', () => {
    expect(isNewPhase(base, { ...base, goal: 'maintain' })).toBe(true);
    expect(isNewPhase(base, { ...base, rate_pct_per_week: -0.5 })).toBe(true);
  });

  it('leaves the phase alone when neither moved', () => {
    expect(isNewPhase(base, { ...base })).toBe(false);
  });
});

describe('todayIsoDate', () => {
  it('formats the local calendar day, not a UTC instant', () => {
    // 23:30 local on the 25th must not report the 26th.
    const local = new Date(2026, 6, 25, 23, 30, 0);
    expect(todayIsoDate(local)).toBe('2026-07-25');
  });

  it('zero-pads single-digit months and days', () => {
    expect(todayIsoDate(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});
