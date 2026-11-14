import { describe, expect, it } from 'vitest';

import {
  daysInRange,
  fromFirstLogged,
  loggedDays,
  longestNutritionSpan,
  nutritionRangeSpan,
  spanWords,
  weeklyAverages,
} from '@/lib/nutritionRange';
import { historySpan, historyWeeks, historyWeekTitle } from '../native/src/lib/fuelHistory';

// Progress's nutrition ranges (src/lib/nutritionRange.ts) and Fuel's history
// weeks (native/src/lib/fuelHistory.ts). Every span ends yesterday; weeks
// start on Monday; a day with nothing logged never counts as 0.

const day = (date: string, calories: number, protein = calories / 20) => ({ date, calories, protein });

describe('nutrition ranges', () => {
  // Saturday, November 14, 2026.
  const today = '2026-11-14';

  it('ends every range yesterday, at 7, 14 and 30 days', () => {
    expect(nutritionRangeSpan(today, 'week')).toEqual({ firstKey: '2026-11-07', lastKey: '2026-11-13', days: 7 });
    expect(nutritionRangeSpan(today, 'twoWeeks')).toEqual({ firstKey: '2026-10-31', lastKey: '2026-11-13', days: 14 });
    expect(nutritionRangeSpan(today, 'month')).toEqual({ firstKey: '2026-10-15', lastKey: '2026-11-13', days: 30 });
  });

  it('starts three months on a Monday, thirteen weeks with the latest one so far', () => {
    expect(nutritionRangeSpan(today, 'threeMonths')).toEqual({ firstKey: '2026-08-17', lastKey: '2026-11-13', days: 89 });
    expect(longestNutritionSpan(today)).toEqual(nutritionRangeSpan(today, 'threeMonths'));
    // On a Monday, yesterday's week is a whole one.
    expect(nutritionRangeSpan('2026-11-16', 'threeMonths')).toEqual({ firstKey: '2026-08-17', lastKey: '2026-11-15', days: 91 });
  });

  it('crosses daylight saving time and a year end by the calendar', () => {
    expect(nutritionRangeSpan('2026-11-02', 'week').days).toBe(7);
    expect(nutritionRangeSpan('2027-01-03', 'twoWeeks')).toEqual({ firstKey: '2026-12-20', lastKey: '2027-01-02', days: 14 });
  });

  it('takes a range out of the longer read', () => {
    const read = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-13'].map((date) => day(date, 2000));
    expect(daysInRange(read, today, 'week').map((entry) => entry.date)).toEqual(['2026-11-07', '2026-11-13']);
  });

  it('starts where the logging does, and is empty with nothing logged', () => {
    const days = [day('2026-11-01', 0), day('2026-11-02', 0, 20), day('2026-11-03', 0), day('2026-11-04', 2000)];
    expect(fromFirstLogged(days).map((entry) => entry.date)).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(fromFirstLogged([day('2026-11-01', 0)])).toEqual([]);
    expect(loggedDays(days)).toBe(2);
  });

  it('averages each Monday-to-Sunday week over its logged days only', () => {
    const days = [
      day('2026-11-01', 2400), // Sunday: the week of Oct 26
      day('2026-11-02', 2000, 100),
      day('2026-11-03', 0, 0),
      day('2026-11-04', 3000, 0),
      day('2026-11-09', 0, 0),
    ];
    expect(weeklyAverages(days)).toEqual([
      { date: '2026-10-26', calories: 2400, protein: 120, logged: 1 },
      // Protein's average is of the one day with protein logged.
      { date: '2026-11-02', calories: 2500, protein: 100, logged: 2 },
      { date: '2026-11-09', calories: 0, protein: 0, logged: 0 },
    ]);
  });

  it('names a span as the app writes dates', () => {
    expect(spanWords('2026-10-29', '2026-11-04')).toEqual({ written: 'Oct 29–Nov 4', spoken: 'October 29 to November 4' });
    expect(spanWords('2026-11-01', '2026-11-07').written).toBe('Nov 1–7');
    expect(spanWords('2026-11-03', '2026-11-03')).toEqual({ written: 'Nov 3', spoken: 'November 3' });
  });
});

describe("Fuel's history weeks", () => {
  it('reads whole weeks ending yesterday', () => {
    expect(historySpan('2026-11-14', 12)).toEqual({ firstKey: '2026-08-24', lastKey: '2026-11-13', days: 82 });
    expect(historySpan('2026-11-14', 1)).toEqual({ firstKey: '2026-11-09', lastKey: '2026-11-13', days: 5 });
  });

  it('lists only logged days, newest week and day first', () => {
    const weeks = historyWeeks([
      day('2026-11-02', 2000),
      day('2026-11-03', 0, 0),
      day('2026-11-04', 2500),
      day('2026-11-08', 0, 0),
      day('2026-11-10', 2600),
      day('2026-11-12', 0, 30),
    ]);
    expect(weeks.map((week) => [week.start, week.days.map((entry) => entry.date)])).toEqual([
      ['2026-11-09', ['2026-11-12', '2026-11-10']],
      ['2026-11-02', ['2026-11-04', '2026-11-02']],
    ]);
    expect(historyWeeks([day('2026-11-03', 0, 0)])).toEqual([]);
  });

  it('heads this week, last week, then dates', () => {
    expect(historyWeekTitle('2026-11-09', '2026-11-14')).toBe('This week');
    expect(historyWeekTitle('2026-11-02', '2026-11-14')).toBe('Last week');
    expect(historyWeekTitle('2026-10-26', '2026-11-14')).toBe('Oct 26–Nov 1');
    expect(historyWeekTitle('2026-10-12', '2026-11-14')).toBe('Oct 12–18');
    // On a Monday, the week before is last week.
    expect(historyWeekTitle('2026-11-09', '2026-11-16')).toBe('Last week');
  });
});
