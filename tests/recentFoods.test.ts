import { describe, expect, it, vi } from 'vitest';

import type { Food } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  pruneHiddenRecentFoods,
  rankRecentFoods,
  recentFoodKey,
  RECENT_WINDOW_DAYS,
  usualAmountInput,
  type RecentLog,
} from '@/lib/recentFoods';

const food = (name: string, overrides: Partial<Food> = {}): Food => ({
  id: `${name}-row`,
  user_id: 'u1',
  name,
  calories: 100,
  protein: 10,
  carbs: 5,
  fat: 2,
  serving_size: 1,
  serving_unit: 'serving',
  source: 'manual_entry',
  fdc_id: null,
  ...overrides,
});

const log = (item: Food | null, date: string, overrides: Partial<RecentLog> = {}): RecentLog => ({
  food_id: item?.id ?? 'missing',
  servings: 1,
  source: 'manual',
  date,
  logged_at: `${date}T12:00:00`,
  created_at: `${date}T12:00:00`,
  food: item,
  ...overrides,
});

const TODAY = '2026-10-30';
const names = (logs: RecentLog[], options?: Parameters<typeof rankRecentFoods>[2]) =>
  rankRecentFoods(logs, TODAY, options).map((recent) => recent.food.name);

describe('Recent foods', () => {
  it('puts the foods eaten most often lately first', () => {
    const shake = food('Shake');
    const oats = food('Oats');
    const pizza = food('Pizza');
    const logs = [
      log(pizza, '2026-10-29'),
      log(shake, '2026-10-30'),
      log(shake, '2026-10-29'),
      log(shake, '2026-10-28'),
      log(oats, '2026-10-27'),
      log(oats, '2026-10-26'),
    ];
    expect(names(logs)).toEqual(['Shake', 'Oats', 'Pizza']);
  });

  it('counts days, not entries, and lets this week outrank an old habit', () => {
    const eggs = food('Eggs');
    const rice = food('Rice');
    // three eggs logged one by one on a single day
    const logs = [log(eggs, '2026-10-30'), log(eggs, '2026-10-30'), log(eggs, '2026-10-30')];
    // rice most days, three weeks ago
    for (const day of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) logs.push(log(rice, day));
    for (const day of ['2026-10-28', '2026-10-29']) logs.push(log(eggs, day));
    const ranked = rankRecentFoods(logs, TODAY);
    expect(ranked.map((recent) => recent.food.name)).toEqual(['Eggs', 'Rice']);
    expect(ranked[0].days).toBe(3);
  });

  it('breaks a tie with the one eaten last', () => {
    const tea = food('Tea');
    const coffee = food('Coffee');
    const logs = [
      log(tea, '2026-10-29', { logged_at: '2026-10-29T08:00:00' }),
      log(coffee, '2026-10-29', { logged_at: '2026-10-29T09:00:00' }),
    ];
    expect(names(logs)).toEqual(['Coffee', 'Tea']);
  });

  it('offers the amount logged most often, the latest on a tie', () => {
    const yogurt = food('Yogurt');
    const often = [
      log(yogurt, '2026-10-26', { servings: 2 }),
      log(yogurt, '2026-10-27', { servings: 2 }),
      log(yogurt, '2026-10-29', { servings: 1.5 }),
    ];
    expect(rankRecentFoods(often, TODAY)[0].servings).toBe(2);

    const tie = [log(yogurt, '2026-10-27', { servings: 2 }), log(yogurt, '2026-10-29', { servings: 1.5 })];
    expect(rankRecentFoods(tie, TODAY)[0].servings).toBe(1.5);
  });

  it('treats the same food in two rows as one, logging against the latest row and its source', () => {
    const older = food('Banana', { id: 'banana-1' });
    const newer = food(' banana ', { id: 'banana-2' });
    const ranked = rankRecentFoods(
      [log(older, '2026-10-20', { source: 'manual' }), log(newer, '2026-10-29', { source: 'gemini_estimate' })],
      TODAY,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].food.id).toBe('banana-2');
    expect(ranked[0].source).toBe('gemini_estimate');
    expect(ranked[0].days).toBe(2);
  });

  it('keeps foods with the same name but other macros or basis apart', () => {
    expect(recentFoodKey(food('Chicken'))).not.toBe(recentFoodKey(food('Chicken', { calories: 160 })));
    expect(recentFoodKey(food('Chicken', { serving_size: 100, serving_unit: 'g' }))).not.toBe(
      recentFoodKey(food('Chicken', { serving_size: 150, serving_unit: 'g' })),
    );
  });

  it('leaves out missing foods, empty amounts, future days and days past the window', () => {
    const apple = food('Apple');
    const start = new Date(`${TODAY}T12:00:00`);
    start.setDate(start.getDate() - RECENT_WINDOW_DAYS);
    const tooOld = start.toISOString().slice(0, 10);
    const logs = [
      log(null, '2026-10-29'),
      log(food('Zero'), '2026-10-29', { servings: 0 }),
      log(food('Tomorrow'), '2026-10-31'),
      log(food('Old'), tooOld),
      log(apple, '2026-10-29'),
    ];
    expect(names(logs)).toEqual(['Apple']);
  });

  it('keeps a hidden food out until it is logged again', () => {
    const soda = food('Soda');
    const logs = [log(soda, '2026-10-29', { created_at: '2026-10-29T18:00:00.000Z' })];
    const hiddenAfter = { [recentFoodKey(soda)]: Date.parse('2026-10-29T19:00:00.000Z') };
    expect(names(logs, { hidden: hiddenAfter })).toEqual([]);

    const loggedAgain = [...logs, log(soda, '2026-10-30', { created_at: '2026-10-30T09:00:00.000Z' })];
    expect(names(loggedAgain, { hidden: hiddenAfter })).toEqual(['Soda']);
  });

  it('shows at most the limit', () => {
    const logs = Array.from({ length: 30 }, (_, index) => log(food(`Food ${index}`), '2026-10-29'));
    expect(rankRecentFoods(logs, TODAY)).toHaveLength(25);
    expect(rankRecentFoods(logs, TODAY, { limit: 3 })).toHaveLength(3);
  });

  it('forgets hidden foods once the window has passed them', () => {
    const now = new Date('2026-10-30T12:00:00.000Z');
    const pruned = pruneHiddenRecentFoods({ fresh: Date.parse('2026-10-25T12:00:00.000Z'), stale: Date.parse('2026-09-01T12:00:00.000Z') }, now);
    expect(Object.keys(pruned)).toEqual(['fresh']);
  });
});

describe('usual amount in the food review', () => {
  it('reads a weighed food in its own unit', () => {
    expect(usualAmountInput({ serving_size: 100, serving_unit: 'g' }, 1.5)).toEqual({ amount: '150', unit: 'g' });
    expect(usualAmountInput({ serving_size: 240, serving_unit: 'ml' }, 2)).toEqual({ amount: '480', unit: 'ml' });
  });

  it('keeps servings for a food counted in servings', () => {
    expect(usualAmountInput({ serving_size: 1, serving_unit: 'serving' }, 2)).toEqual({ amount: '2', unit: 'serving' });
    expect(usualAmountInput({ serving_size: 1, serving_unit: 'meal' }, 1)).toEqual({ amount: '1', unit: 'serving' });
  });
});
