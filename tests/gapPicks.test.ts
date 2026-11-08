import { describe, expect, it } from 'vitest';

import { gapPickNames, gapPicksLine, planGapPicks, type GapPicksInput } from '@/lib/gapPicks';
import { recentFoodKey, type RecentLog } from '@/lib/recentFoods';
import type { Food } from '@/types';

// Close-the-gap picks: the set of one to three usual foods (eaten on two days
// or more of Recent's four weeks) that best covers what today still needs, at
// the amounts usually logged. While gaining, a little past the calories is
// free; on other goals a protein set stays within the calories left.

const TODAY = '2026-11-08';
const food = (id: string, name: string, calories: number, protein: number, extra: Partial<Food> = {}): Food => ({
  id, user_id: 'u', name, calories, protein, carbs: 0, fat: 0, serving_size: 1, serving_unit: 'serving', source: 'custom', fdc_id: null, ...extra,
});
const ate = (item: Food, date: string, servings = 1): RecentLog => ({
  food_id: item.id, servings, source: 'manual', date, logged_at: `${date}T19:00:00Z`, food: item,
});
/** Eaten on each of these days before today. */
const eaten = (item: Food, daysAgo: number[], servings = 1) =>
  daysAgo.map((ago) => ate(item, `2026-11-${String(8 - ago).padStart(2, '0')}`, servings));

const shake = food('shake', 'Protein shake', 400, 40);
const toast = food('toast', 'Peanut butter toast', 350, 12);
const yogurt = food('yogurt', 'Greek yogurt', 150, 15);
const rice = food('rice', 'Chicken and rice', 650, 45);
const coffee = food('coffee', 'Coffee', 5, 0);
const nuts = food('nuts', 'Trail mix', 280, 8);

const plan = (logs: RecentLog[], overrides: Partial<GapPicksInput> = {}) =>
  planGapPicks({ logs, todayKey: TODAY, need: { kcal: 850, protein: 40 }, kcalRoom: null, ...overrides });
const names = (result: ReturnType<typeof planGapPicks>) => result?.picks.map((pick) => pick.food.name);

describe('planGapPicks while gaining', () => {
  it('picks the set of usual foods that covers the calories, with the protein when that is short too', () => {
    const result = plan([...eaten(shake, [1, 2, 3]), ...eaten(toast, [1, 2]), ...eaten(yogurt, [1, 4]), ...eaten(nuts, [2, 5])]);
    expect(result).toMatchObject({ aim: 'calories', covers: true });
    expect(result!.kcal).toBeGreaterThanOrEqual(850 * 0.9);
    expect(result!.protein).toBeGreaterThanOrEqual(40);
    expect(result!.picks.length).toBeGreaterThanOrEqual(2);
    expect(result!.picks.length).toBeLessThanOrEqual(3);
    expect(names(result)).toContain('Protein shake');
  });

  it('uses the amount usually logged', () => {
    const result = plan([...eaten(shake, [1, 2, 3], 2), ...eaten(toast, [1, 2])], { need: { kcal: 800, protein: null } });
    expect(result!.picks[0]).toMatchObject({ key: recentFoodKey(shake), servings: 2, kcal: 800, protein: 80 });
    expect(names(result)).toEqual(['Protein shake']);
  });

  it('goes a little past the gap freely, but not far past it', () => {
    // 650 + 400 = 1,050 for a 900 gap: within the slack.
    const close = plan([...eaten(rice, [1, 2]), ...eaten(shake, [1, 3])], { need: { kcal: 900, protein: null } });
    expect(names(close)).toEqual(['Chicken and rice', 'Protein shake']);
    // For a 300 gap the 650 meal is far past: the smaller food does it.
    const small = plan([...eaten(rice, [1, 2]), ...eaten(toast, [1, 3])], { need: { kcal: 300, protein: null } });
    expect(names(small)).toEqual(['Peanut butter toast']);
  });

  it('suggests only usual foods: never a one-off, a hidden food or one too small to help', () => {
    const logs = [ate(rice, '2026-11-07'), ...eaten(coffee, [1, 2, 3]), ...eaten(shake, [1, 2]), ...eaten(toast, [2, 3])];
    expect(names(plan(logs))).not.toContain('Chicken and rice');
    expect(names(plan(logs))).not.toContain('Coffee');
    const hidden = { [recentFoodKey(shake)]: Date.parse('2026-11-08T12:00:00Z') };
    expect(names(plan(logs, { hidden }))).toEqual(['Peanut butter toast']);
  });

  it('puts a food already eaten today after an equal one that was not', () => {
    const twin = food('bagel', 'Bagel', 350, 12);
    const logs = [...eaten(toast, [1, 2]), ...eaten(twin, [1, 2])];
    const need = { kcal: 350, protein: null };
    expect(names(plan(logs, { need, eatenToday: new Set([recentFoodKey(toast)]) }))).toEqual(['Bagel']);
    expect(names(plan(logs, { need, eatenToday: new Set([recentFoodKey(twin)]) }))).toEqual(['Peanut butter toast']);
    // By default today's own logs say what was eaten.
    expect(names(plan([...logs, ate(toast, TODAY)], { need }))).toEqual(['Bagel']);
  });

  it('shows nothing when the usual foods would barely dent the gap, or there are none', () => {
    expect(plan([...eaten(yogurt, [1, 2])], { need: { kcal: 1500, protein: null } })).toBeNull();
    expect(plan([])).toBeNull();
    expect(plan([...eaten(shake, [1, 2])], { need: { kcal: null, protein: null } })).toBeNull();
  });

  it('says when the set falls short of the gap', () => {
    const result = plan([...eaten(toast, [1, 2]), ...eaten(yogurt, [1, 2])], { need: { kcal: 900, protein: null } });
    expect(result).toMatchObject({ covers: false, kcal: 500 });
  });
});

describe('planGapPicks for protein', () => {
  it('on a cut, brings the protein within the calories left', () => {
    const logs = [...eaten(rice, [1, 2]), ...eaten(shake, [1, 2]), ...eaten(yogurt, [1, 3]), ...eaten(nuts, [1, 2])];
    const result = plan(logs, { need: { kcal: null, protein: 40 }, kcalRoom: 450 });
    expect(result).toMatchObject({ aim: 'protein', covers: true });
    expect(result!.kcal).toBeLessThanOrEqual(450);
    expect(names(result)).toEqual(['Protein shake']);
  });

  it('on a cut with no calories left, suggests nothing', () => {
    expect(plan([...eaten(shake, [1, 2])], { need: { kcal: null, protein: 40 }, kcalRoom: 0 })).toBeNull();
  });

  it('leaves out foods with little protein', () => {
    expect(plan([...eaten(nuts, [1, 2])], { need: { kcal: null, protein: 30 }, kcalRoom: null })).toBeNull();
  });
});

describe('the reminder’s line', () => {
  const result = (picks: Food[], covers: boolean, aim: 'calories' | 'protein' = 'calories') => ({
    aim,
    covers,
    kcal: 0,
    protein: 0,
    picks: picks.map((item) => ({ key: item.id, food: item, servings: 1, source: 'manual', days: 2, addedAt: 0, kcal: 0, protein: 0 })),
  });

  it('names the picks as a list', () => {
    expect(gapPickNames(result([shake], true))).toBe('Protein shake');
    expect(gapPickNames(result([shake, toast], true))).toBe('Protein shake and Peanut butter toast');
    expect(gapPickNames(result([shake, toast, yogurt], true))).toBe('Protein shake, Peanut butter toast and Greek yogurt');
  });

  it('says whether they cover it', () => {
    expect(gapPicksLine(result([shake, toast], true))).toBe('Protein shake and Peanut butter toast would cover it.');
    expect(gapPicksLine(result([shake], true, 'protein'))).toBe('Protein shake would cover the protein.');
    expect(gapPicksLine(result([yogurt], false))).toBe('Greek yogurt would get you closer.');
  });
});
