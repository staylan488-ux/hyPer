import { describe, expect, it } from 'vitest';

import type { RecentLog } from '@/lib/recentFoods';
import type { Food } from '@/types';
import { gapEveningStart, gapPlanFor, isGapEvening } from '../native/src/lib/closeGap';

// Close the gap on the phone: the same shortfall as the Fuel reminder, the
// evening from 6 PM (or an earlier reminder), and nothing on a day with
// nothing logged or no saved target.

const shake: Food = { id: 'shake', user_id: 'u', name: 'Protein shake', calories: 400, protein: 40, carbs: 0, fat: 0, serving_size: 1, serving_unit: 'serving', source: 'custom', fdc_id: null };
const logs: RecentLog[] = ['2026-11-06', '2026-11-07'].map((date) => ({ food_id: 'shake', servings: 1, source: 'manual', date, logged_at: `${date}T19:00:00Z`, food: shake }));
const totals = (calories: number, protein: number) => ({ calories, protein, carbs: 0, fat: 0 });
const input = { logs, day: '2026-11-08', totals: totals(2300, 120), target: { calories: 2800, protein: 160 }, goal: 'bulk' as const };

describe('the evening', () => {
  it('starts at 6 PM, or at the reminder’s time when it is on and earlier', () => {
    expect(gapEveningStart({ enabled: false, minutes: 17 * 60 })).toBe(18 * 60);
    expect(gapEveningStart({ enabled: true, minutes: 17 * 60 })).toBe(17 * 60);
    expect(gapEveningStart({ enabled: true, minutes: 21 * 60 })).toBe(18 * 60);
    expect(isGapEvening(new Date(2026, 10, 8, 17, 59), { enabled: false, minutes: 1200 })).toBe(false);
    expect(isGapEvening(new Date(2026, 10, 8, 18, 0), { enabled: false, minutes: 1200 })).toBe(true);
  });
});

describe('gapPlanFor', () => {
  it('picks for the reminder’s shortfall', () => {
    // 2,300 of 2,800 is short of a quarter for calories, but protein is 40 g short.
    expect(gapPlanFor(input)).toMatchObject({ aim: 'protein', protein: 40 });
    expect(gapPlanFor({ ...input, totals: totals(1900, 120) })).toMatchObject({ aim: 'calories', kcal: 400 });
  });

  it('suggests nothing without a saved target, logs, food logged today or a gap', () => {
    expect(gapPlanFor({ ...input, target: null })).toBeNull();
    expect(gapPlanFor({ ...input, logs: null })).toBeNull();
    expect(gapPlanFor({ ...input, totals: totals(0, 0) })).toBeNull();
    expect(gapPlanFor({ ...input, totals: totals(2700, 160) })).toBeNull();
  });
});
