import { describe, expect, it } from 'vitest';

import type { RecentLog } from '@/lib/recentFoods';
import type { Food } from '@/types';
import { gapEveningStart, gapLogAllTitle, gapPlanFor, gapRowLine, gapWithWords, isGapEvening } from '../native/src/lib/closeGap';
import { askGapSheet, GAP_SHEET_ASK_MS, takeGapSheetAsk } from '../native/src/lib/gapSheetAsk';

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

describe('the words', () => {
  const pick = (kcal: number, protein: number) => ({ kcal, protein });

  it('Fuel’s row says where the picks take the day, in the plan’s measure', () => {
    const eaten = { calories: 171, protein: 2 };
    expect(gapRowLine({ aim: 'calories', picks: [pick(985, 38), pick(807, 43), pick(448, 48)] as never }, eaten)).toBe('3 of your usuals reach 2,411 kcal');
    expect(gapRowLine({ aim: 'calories', picks: [pick(807, 43)] as never }, eaten)).toBe('One of your usuals reaches 978 kcal');
    expect(gapRowLine({ aim: 'protein', picks: [pick(400, 40), pick(150, 15)] as never }, { calories: 2300, protein: 105 })).toBe('2 of your usuals reach 160 g protein');
  });

  it('the sheet’s figure names the picks it counts, and nothing once they are all logged', () => {
    expect(gapWithWords(3, 3)).toBe(' with all three');
    expect(gapWithWords(2, 2)).toBe(' with both');
    expect(gapWithWords(1, 1)).toBe(' with this');
    expect(gapWithWords(3, 1)).toBe(' with the rest');
    expect(gapWithWords(3, 0)).toBe('');
  });

  it('the sheet’s button says how many it logs, then Done', () => {
    expect(gapLogAllTitle(3, 3)).toBe('Log all three');
    expect(gapLogAllTitle(2, 2)).toBe('Log both');
    expect(gapLogAllTitle(1, 1)).toBe('Log it');
    expect(gapLogAllTitle(3, 2)).toBe('Log the other two');
    expect(gapLogAllTitle(3, 1)).toBe('Log the other one');
    expect(gapLogAllTitle(3, 0)).toBe('Done');
  });
});

describe('the reminder’s ask for the sheet', () => {
  it('is taken once, and only while it is fresh', () => {
    expect(takeGapSheetAsk(1_000)).toBe(false);
    askGapSheet(1_000);
    expect(takeGapSheetAsk(1_000 + GAP_SHEET_ASK_MS)).toBe(true);
    expect(takeGapSheetAsk(1_000 + GAP_SHEET_ASK_MS)).toBe(false);
    askGapSheet(1_000);
    expect(takeGapSheetAsk(1_001 + GAP_SHEET_ASK_MS)).toBe(false);
  });
});
