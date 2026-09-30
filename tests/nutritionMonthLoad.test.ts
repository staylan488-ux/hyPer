import { describe, expect, it } from 'vitest';
import {
  createLatestRequestGate,
  nutritionMonthKey,
  shouldEnsureDefaultGroups,
} from '@/lib/nutritionMonthLoad';

const ready = {
  loading: false,
  loadedMonthKey: '2026-09',
  selectedDateKey: '2026-09-14',
  failedDates: new Set<string>(),
};

describe('nutrition month key', () => {
  it('keys a date by its local year and month', () => {
    expect(nutritionMonthKey(new Date(2026, 8, 30, 23, 59))).toBe('2026-09');
    expect(nutritionMonthKey(new Date(2027, 0, 1))).toBe('2027-01');
  });
});

describe('default meal group creation', () => {
  it('runs once the selected date’s month has loaded', () => {
    expect(shouldEnsureDefaultGroups(ready)).toBe(true);
  });

  it('waits while a month is loading or nothing has loaded yet', () => {
    expect(shouldEnsureDefaultGroups({ ...ready, loading: true })).toBe(false);
    expect(shouldEnsureDefaultGroups({ ...ready, loadedMonthKey: null })).toBe(false);
  });

  it('does not run while the loaded month is not the selected date’s month', () => {
    // The "Jump to date" sheet browsed back to August; September 14 stays selected.
    expect(shouldEnsureDefaultGroups({ ...ready, loadedMonthKey: '2026-08' })).toBe(false);
    // A date picked in October before October's groups arrive.
    expect(shouldEnsureDefaultGroups({ ...ready, selectedDateKey: '2026-10-01' })).toBe(false);
  });

  it('does not retry a date whose insert already failed', () => {
    const failedDates = new Set(['2026-09-14']);
    expect(shouldEnsureDefaultGroups({ ...ready, failedDates })).toBe(false);
    expect(shouldEnsureDefaultGroups({ ...ready, failedDates, selectedDateKey: '2026-09-15' })).toBe(true);
  });
});

describe('latest request gate', () => {
  it('applies only the newest of two out-of-order responses', async () => {
    const gate = createLatestRequestGate();
    const applied: string[] = [];
    let releaseOlder!: () => void;
    const olderArrives = new Promise<void>((resolve) => { releaseOlder = resolve; });

    const load = async (month: string, arrives: Promise<void>) => {
      const token = gate.begin();
      await arrives;
      if (gate.isCurrent(token)) applied.push(month);
    };

    const older = load('2026-08', olderArrives);
    const newer = load('2026-09', Promise.resolve());
    await newer;
    releaseOlder();
    await older;

    expect(applied).toEqual(['2026-09']);
  });

  it('keeps a lone request current', () => {
    const gate = createLatestRequestGate();
    const token = gate.begin();
    expect(gate.isCurrent(token)).toBe(true);
    gate.begin();
    expect(gate.isCurrent(token)).toBe(false);
  });
});
