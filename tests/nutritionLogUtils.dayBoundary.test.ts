import { describe, expect, it } from 'vitest';

import { getLogDate, getLogTimestamp } from '@/components/nutrition/nutritionLogUtils';

describe('nutrition log day-boundary behavior', () => {
  it('prefers logged_at timestamp when present', () => {
    const timestamp = getLogTimestamp({
      date: '2026-02-14',
      logged_at: '2026-02-14T06:30:00.000Z',
      created_at: '2026-02-14T01:00:00.000Z',
    });

    expect(timestamp).toBe(new Date('2026-02-14T06:30:00.000Z').getTime());
  });

  it('falls back to created_at when logged_at is missing', () => {
    const timestamp = getLogTimestamp({
      date: '2026-02-14',
      logged_at: null,
      created_at: '2026-02-14T02:15:00.000Z',
    });

    expect(timestamp).toBe(new Date('2026-02-14T02:15:00.000Z').getTime());
  });

  it('uses local midday when both timestamps are missing', () => {
    const value = getLogDate({
      date: '2026-02-14',
      logged_at: null,
      created_at: null,
    });

    expect(value.getHours()).toBe(12);
    expect(value.getMinutes()).toBe(0);
    expect(value.getSeconds()).toBe(0);
  });

  it('sorts logs in chronological order around midnight boundaries', () => {
    const early = {
      date: '2026-02-14',
      logged_at: '2026-02-14T00:10:00.000Z',
      created_at: null,
    };
    const late = {
      date: '2026-02-14',
      logged_at: '2026-02-14T23:50:00.000Z',
      created_at: null,
    };

    const ordered = [late, early].sort((a, b) => getLogTimestamp(a) - getLogTimestamp(b));
    expect(ordered[0]).toBe(early);
    expect(ordered[1]).toBe(late);
  });
});
