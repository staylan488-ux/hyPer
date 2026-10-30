import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NutritionGroup } from '@/types';

const mocks = vi.hoisted(() => ({ from: vi.fn(), upsert: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

import { alreadyOnDay, buildRepeatedEntries, entriesInMeal, matchingGroup, repeatLogSource, saveRepeatedEntries } from '@/lib/repeatEntries';

const group = (id: string, date: string, label: NutritionGroup['label'], kind: NutritionGroup['kind'] = 'meal', sort_order = 0): NutritionGroup =>
  ({ id, user_id: 'u1', date, kind, label, sort_order }) as NutritionGroup;

const yesterday = [
  group('y-breakfast', '2026-10-29', 'breakfast', 'meal', 0),
  group('y-snack1', '2026-10-29', null, 'snack', 1),
  group('y-lunch', '2026-10-29', 'lunch', 'meal', 2),
  group('y-snack2', '2026-10-29', null, 'snack', 3),
  group('y-dinner', '2026-10-29', 'dinner', 'meal', 4),
];
const today = [
  group('t-breakfast', '2026-10-30', 'breakfast', 'meal', 0),
  group('t-snack1', '2026-10-30', null, 'snack', 1),
  group('t-lunch', '2026-10-30', 'lunch', 'meal', 2),
  group('t-dinner', '2026-10-30', 'dinner', 'meal', 3),
];

describe('copy a meal to another day', () => {
  it('goes to the same named meal', () => {
    expect(matchingGroup(yesterday[0], yesterday, today)?.id).toBe('t-breakfast');
    expect(matchingGroup(yesterday[4], yesterday, today)?.id).toBe('t-dinner');
  });

  it('goes to the snack with the same number, else Unassigned', () => {
    expect(matchingGroup(yesterday[1], yesterday, today)?.id).toBe('t-snack1');
    expect(matchingGroup(yesterday[3], yesterday, today)).toBeNull();
  });

  it('keeps Unassigned entries Unassigned, and a missing named meal falls to Unassigned', () => {
    expect(matchingGroup(null, yesterday, today)).toBeNull();
    expect(matchingGroup(yesterday[0], yesterday, today.slice(1))).toBeNull();
  });

  it('writes the same foods and amounts at their own times on the new day', () => {
    const rows = buildRepeatedEntries(
      [
        { food_id: 'oats', servings: 1.5, source: 'usda', date: '2026-10-29', logged_at: new Date(2026, 9, 29, 7, 45).toISOString() },
        { food_id: 'coffee', servings: 1, source: 'gemini_estimate', date: '2026-10-29', logged_at: null, created_at: new Date(2026, 9, 29, 8, 10).toISOString() },
      ],
      '2026-10-30',
      today[0],
    );
    expect(rows).toEqual([
      { food_id: 'oats', servings: 1.5, meal_type: 'breakfast', group_id: 't-breakfast', source: 'usda', date: '2026-10-30', logged_at: new Date(2026, 9, 30, 7, 45).toISOString() },
      { food_id: 'coffee', servings: 1, meal_type: 'breakfast', group_id: 't-breakfast', source: 'gemini_estimate', date: '2026-10-30', logged_at: new Date(2026, 9, 30, 8, 10).toISOString() },
    ]);
  });

  it('logs a copy of an imported entry as manual', () => {
    expect(repeatLogSource('cronometer_csv')).toBe('manual');
    expect(repeatLogSource(null)).toBe('manual');
    expect(repeatLogSource('meal_builder')).toBe('meal_builder');
  });

  it('asks before a second copy only when the day already has every food', () => {
    const meal = [{ food_id: 'oats' }, { food_id: 'coffee' }];
    expect(alreadyOnDay(meal, [{ food_id: 'coffee' }])).toBe(false);
    expect(alreadyOnDay(meal, [{ food_id: 'coffee' }, { food_id: 'oats' }, { food_id: 'eggs' }])).toBe(true);
    expect(alreadyOnDay([], [{ food_id: 'oats' }])).toBe(false);
  });

  it("compares with the target meal only, so staples eaten at other meals don't ask", () => {
    const todayLogs = [
      { food_id: 'oats', group_id: 't-breakfast' },
      { food_id: 'rice', group_id: 't-lunch' },
      { food_id: 'banana', group_id: 't-snack1' },
      { food_id: 'shake', group_id: null },
      { food_id: 'bar', group_id: 'gone-meal' },
    ];
    const meal = [{ food_id: 'oats' }, { food_id: 'rice' }, { food_id: 'banana' }];
    expect(alreadyOnDay(meal, todayLogs)).toBe(true);
    expect(alreadyOnDay(meal, entriesInMeal(todayLogs, today, today[0]))).toBe(false);
    expect(entriesInMeal(todayLogs, today, today[0]).map((log) => log.food_id)).toEqual(['oats']);
    // Unassigned also holds entries whose meal is gone
    expect(entriesInMeal(todayLogs, today, null).map((log) => log.food_id)).toEqual(['shake', 'bar']);
  });
});

describe('saving a copy', () => {
  beforeEach(() => {
    mocks.from.mockReset().mockReturnValue({ upsert: mocks.upsert });
    mocks.upsert.mockReset().mockResolvedValue({ error: null });
  });

  const rows = buildRepeatedEntries(
    [{ food_id: 'oats', servings: 1, source: 'usda', date: '2026-10-29', logged_at: null }],
    '2026-10-30',
    null,
  );

  it('upserts every row under its retry-safe id in one request', async () => {
    await expect(saveRepeatedEntries('u1', rows, ['id-1'])).resolves.toEqual({ ok: true });
    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('nutrition_logs');
    expect(mocks.upsert).toHaveBeenCalledExactlyOnceWith([{ id: 'id-1', user_id: 'u1', ...rows[0] }], { onConflict: 'id' });
  });

  it('reports the error code on failure', async () => {
    mocks.upsert.mockResolvedValue({ error: { code: '23503', message: 'fk' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(saveRepeatedEntries('u1', rows, ['id-1'])).resolves.toEqual({ ok: false, code: '23503' });
  });

  it('writes nothing when the ids do not match the rows', async () => {
    await expect(saveRepeatedEntries('u1', rows, [])).resolves.toEqual({ ok: false, code: null });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
