import { describe, expect, it } from 'vitest';

import { isLateNightEntry, planEntryDayMove, shiftDayKey } from '@/lib/entryDay';

describe('shiftDayKey', () => {
  it('crosses a month boundary', () => {
    expect(shiftDayKey('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('crosses a year boundary', () => {
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(shiftDayKey('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('planEntryDayMove', () => {
  it('moves the entry to the previous day', () => {
    const patch = planEntryDayMove(
      { date: '2026-08-01', logged_at: '2026-08-01T01:30:00.000Z' },
      -1,
    )!;
    expect(patch.date).toBe('2026-07-31');
  });

  it('keeps the time of day so the entry stays in order', () => {
    // a 01:30 entry moved back should read 01:30, not jump to noon
    const patch = planEntryDayMove(
      { date: '2026-08-01', logged_at: '2026-08-01T01:30:00.000Z' },
      -1,
    )!;
    expect(patch.logged_at).toBe('2026-07-31T01:30:00.000Z');
  });

  it('tolerates an entry with no timestamp', () => {
    const patch = planEntryDayMove({ date: '2026-08-01', logged_at: null }, -1)!;
    expect(patch.date).toBe('2026-07-31');
    expect(patch.logged_at).toBeNull();
  });

  it('refuses a no-op move', () => {
    expect(planEntryDayMove({ date: '2026-08-01' }, 0)).toBeNull();
  });

  it('moves forward too', () => {
    expect(planEntryDayMove({ date: '2026-07-31' }, 1)!.date).toBe('2026-08-01');
  });
});

describe('isLateNightEntry', () => {
  const at = (h: number, m = 0) => new Date(2026, 7, 1, h, m, 0);

  it('offers the move at 01:00 on an entry logged today', () => {
    expect(isLateNightEntry(
      { date: '2026-08-01', logged_at: at(1).toISOString() },
      at(1, 30),
    )).toBe(true);
  });

  it('does not offer it once the morning has started', () => {
    expect(isLateNightEntry(
      { date: '2026-08-01', logged_at: at(9).toISOString() },
      at(9, 30),
    )).toBe(false);
  });

  it('does not offer it on an entry from an earlier day', () => {
    expect(isLateNightEntry(
      { date: '2026-07-30', logged_at: at(1).toISOString() },
      at(1, 30),
    )).toBe(false);
  });

  it('does not offer it for a lunch entry even while it is still late', () => {
    // logged at noon, being viewed at 01:00 the next night: the entry is not
    // part of the night that is still going on
    expect(isLateNightEntry(
      { date: '2026-08-01', logged_at: new Date(2026, 7, 1, 12, 0, 0).toISOString() },
      at(1, 30),
    )).toBe(false);
  });
});
