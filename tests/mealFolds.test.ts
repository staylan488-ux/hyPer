import { afterEach, describe, expect, it, vi } from 'vitest';

import { foldHolds, MEAL_FOLD_LIMIT, mealFoldKey, wholeMealFolds, withMealFold, withoutMealFold } from '../native/src/lib/mealFolds';

// Fuel's folded meals (native/src/lib/mealFolds.ts), as kept on the phone: a
// fold holds over the entries it was made with, and new food opens the meal.

describe('a folded meal', () => {
  it('is named by its meal, or by the day for the entries in no meal', () => {
    expect(mealFoldKey('2026-11-10', 'g-lunch')).toBe('g-lunch');
    expect(mealFoldKey('2026-11-10')).toBe('none:2026-11-10');
  });

  it('holds while the meal has only the entries it was folded with', () => {
    expect(foldHolds(['a', 'b'], ['a', 'b'])).toBe(true);
    // One was deleted or moved out.
    expect(foldHolds(['a', 'b'], ['b'])).toBe(true);
    // Still loading: nothing has arrived to open it.
    expect(foldHolds(['a', 'b'], [])).toBe(true);
  });

  it('gives way to an entry it did not have', () => {
    expect(foldHolds(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(foldHolds(['a'], ['c'])).toBe(false);
  });

  it('is open when it was never folded', () => {
    expect(foldHolds(undefined, ['a'])).toBe(false);
    expect(foldHolds(undefined, [])).toBe(false);
  });
});

describe('the kept folds', () => {
  it('add a fold as the newest and fold a meal again over what it has now', () => {
    const folds = withMealFold(withMealFold({}, 'lunch', ['a']), 'dinner', ['b']);
    expect(folds).toEqual({ lunch: ['a'], dinner: ['b'] });
    const again = withMealFold(folds, 'lunch', ['a', 'c']);
    expect(Object.keys(again)).toEqual(['dinner', 'lunch']);
    expect(again.lunch).toEqual(['a', 'c']);
  });

  it('let the oldest go past the limit', () => {
    let folds = {};
    for (let index = 0; index <= MEAL_FOLD_LIMIT; index += 1) folds = withMealFold(folds, `meal-${index}`, ['a']);
    expect(Object.keys(folds)).toHaveLength(MEAL_FOLD_LIMIT);
    expect(folds).not.toHaveProperty('meal-0');
    expect(folds).toHaveProperty(`meal-${MEAL_FOLD_LIMIT}`);
  });

  it('open a meal and leave the others', () => {
    expect(withoutMealFold({ lunch: ['a'], dinner: ['b'] }, 'lunch')).toEqual({ dinner: ['b'] });
  });

  it('are made whole from whatever was saved', () => {
    expect(wholeMealFolds(null)).toEqual({});
    expect(wholeMealFolds(['lunch'])).toEqual({});
    expect(wholeMealFolds({ lunch: ['a'], dinner: 'b', snack: [1] })).toEqual({ lunch: ['a'] });
  });
});

describe('folds on this phone', () => {
  const stored = new Map<string, string>();
  const storage = { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => void stored.set(key, value) };

  afterEach(() => {
    stored.clear();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('show at once and are kept for the account, across launches', async () => {
    vi.stubGlobal('localStorage', storage);
    const first = await import('../native/src/lib/mealFolds');
    first.foldMeal('user-1', 'lunch', ['a', 'b']);
    expect(first.mealFoldsOf('user-1')).toEqual({ lunch: ['a', 'b'] });
    // Another account on this phone keeps its own.
    expect(first.mealFoldsOf('user-2')).toEqual({});

    // The next launch reads it back.
    vi.resetModules();
    const next = await import('../native/src/lib/mealFolds');
    expect(next.mealFoldsOf('user-1')).toEqual({ lunch: ['a', 'b'] });
    next.unfoldMeal('user-1', 'lunch');
    expect(next.mealFoldsOf('user-1')).toEqual({});
    expect(JSON.parse(stored.values().next().value!)).toEqual({});
  });

  it('are none when what is kept cannot be read', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '{not json', setItem: () => undefined });
    const { mealFoldsOf } = await import('../native/src/lib/mealFolds');
    expect(mealFoldsOf('user-1')).toEqual({});
  });

  it('fold nothing while no one is signed in', async () => {
    vi.stubGlobal('localStorage', storage);
    const { foldMeal } = await import('../native/src/lib/mealFolds');
    foldMeal(null, 'lunch', ['a']);
    expect(stored.size).toBe(0);
  });
});
