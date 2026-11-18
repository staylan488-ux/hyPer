import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Food } from '@/types';
import {
  clearMealDraft, createMealIngredient, decodeMealComposition, encodeMealComposition,
  getMealTotals, loadMealDraft, mealAmount, MEAL_COMPOSITION_PREFIX, rescaleMealIngredients, saveMealDraft, scaleMealIngredients,
  wholeMealIngredients,
  type MealDraft,
} from '@/lib/mealComposition';

const milk: Food = {
  id: 'milk', user_id: null, name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5,
  serving_size: 240, serving_unit: 'ml', source: 'open_food_facts', fdc_id: null,
};
const powder: Food = {
  id: 'powder', user_id: 'user-a', name: 'Protein powder', calories: 110, protein: 24, carbs: 2, fat: 1,
  serving_size: 30, serving_unit: 'g', source: 'custom', fdc_id: null,
};
const ingredients = [createMealIngredient(milk, 1.5, '00000000-0000-4000-8000-000000000001'), createMealIngredient(powder, 2, '00000000-0000-4000-8000-000000000002')];
const draft: MealDraft = {
  name: 'Protein shake', ingredients, time: '13:15', groupId: null, method: 'barcode',
  date: '2026-09-06', entryId: '22222222-2222-4222-8222-222222222222', saveAsReusableMeal: false, locked: false,
};

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { data.set(key, value); }),
    removeItem: vi.fn((key: string) => { data.delete(key); }),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('meal composition', () => {
  it('totals independent ingredient serving bases without rounding intermediate values', () => {
    expect(getMealTotals(ingredients)).toEqual({ calories: 400, protein: 60, carbs: 22, fat: 9.5 });
    expect(getMealTotals([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it('snapshots foods so a later food edit cannot change a draft', () => {
    const food = { ...milk };
    const snapshot = createMealIngredient(food, 1, '00000000-0000-4000-8000-000000000003');
    food.calories = 500;
    expect(snapshot.food.calories).toBe(120);
  });

  it('round trips ingredients through description without changing serving bases', () => {
    const parsed = decodeMealComposition(encodeMealComposition(ingredients));
    expect(parsed).toEqual({ version: 1, ingredients });
    expect(parsed?.ingredients[0].food.serving_size).toBe(240);
    expect(parsed?.ingredients[1].servings).toBe(2);
  });

  it('scales meal servings into quantities for editing without mutating the recipe', () => {
    const scaled = scaleMealIngredients(ingredients, 0.5);
    expect(scaled.map((item) => item.servings)).toEqual([0.75, 1]);
    expect(getMealTotals(scaled).calories).toBe(200);
    expect(ingredients.map((item) => item.servings)).toEqual([1.5, 2]);
    scaled[0].food.calories = 999;
    expect(ingredients[0].food.calories).toBe(120);
  });

  it('rescales a draft to another amount of the meal and back, each ingredient keeping its share', () => {
    const half = rescaleMealIngredients({ ingredients }, 0.5);
    expect(half.map((item) => item.servings)).toEqual([0.75, 1]);
    expect(ingredients.map((item) => item.servings)).toEqual([1.5, 2]);
    // one ingredient changed on its own keeps its change through the next rescale
    const changed = half.map((item, index) => (index === 0 ? { ...item, servings: 0.5 } : item));
    expect(rescaleMealIngredients({ ingredients: changed, amount: 0.5 }, 1).map((item) => item.servings)).toEqual([1, 2]);
    // a third and back lands on the same figures
    const third = rescaleMealIngredients({ ingredients }, 0.33);
    expect(wholeMealIngredients({ ingredients: third, amount: 0.33 }).map((item) => item.servings)).toEqual([1.5, 2]);
    expect(wholeMealIngredients({ ingredients })).toBe(ingredients);
    expect(() => rescaleMealIngredients({ ingredients }, 0)).toThrow();
    expect(() => rescaleMealIngredients({ ingredients }, NaN)).toThrow();
    // an ingredient that would come to nothing
    expect(() => rescaleMealIngredients({ ingredients: [createMealIngredient(milk, 1e-9, 'trace')] }, 0.01)).toThrow();
  });

  it('keeps a meal amount as a log does: two decimals, never nothing', () => {
    expect(mealAmount(0.5)).toBe(0.5);
    expect(mealAmount(0.333)).toBe(0.33);
    expect(mealAmount(2)).toBe(2);
    expect(mealAmount(0.004)).toBeNull();
    expect(mealAmount(0)).toBeNull();
    expect(mealAmount(-1)).toBeNull();
    expect(mealAmount(NaN)).toBeNull();
  });

  it.each([0, -1, NaN, Infinity])('rejects invalid ingredient or meal quantity %s', (quantity) => {
    expect(() => createMealIngredient(milk, quantity, '00000000-0000-4000-8000-000000000004')).toThrow();
    expect(() => scaleMealIngredients(ingredients, quantity)).toThrow();
  });

  it('keeps ordinary AI description text out of composition parsing', () => {
    for (const value of [null, undefined, '', 'Chicken with rice', '{"ingredients":[]}', 'hyper:meal-composition:v2:{}']) {
      expect(decodeMealComposition(value)).toBeNull();
    }
  });

  it('rejects corrupt JSON, unknown versions, duplicate IDs and malformed foods', () => {
    expect(decodeMealComposition(MEAL_COMPOSITION_PREFIX + '{')).toBeNull();
    const invalid = [
      { version: 2, ingredients },
      { version: 1, ingredients: [] },
      { version: 1, ingredients: [ingredients[0], ingredients[0]] },
      { version: 1, ingredients: [{ ...ingredients[0], servings: '2' }] },
      { version: 1, ingredients: [{ ...ingredients[0], food: { ...milk, calories: -5 } }] },
      { version: 1, ingredients: [{ ...ingredients[0], food: { ...milk, source: 'unknown' } }] },
      { version: 1, ingredients: [{ ...ingredients[0], food: { ...milk, serving_size: 0 } }] },
      { version: 1, ingredients: [{ ...ingredients[0], food: { ...milk, name: {} } }] },
      { version: 1, ingredients: [{ ...ingredients[0], servings: 1e308 }] },
    ];
    for (const value of invalid) {
      expect(decodeMealComposition(MEAL_COMPOSITION_PREFIX + JSON.stringify(value))).toBeNull();
    }
  });
});

describe('meal draft persistence', () => {
  it('restores a draft and retry identity after the logger is dismissed', () => {
    expect(saveMealDraft('user-a', draft)).toBe(true);
    expect(loadMealDraft('user-a')).toEqual(draft);
    expect(loadMealDraft('user-b')).toBeNull();
  });

  it('keeps the amount of a meal being logged, and refuses one that is not an amount', () => {
    const half = { ...draft, amount: 0.5 };
    expect(saveMealDraft('user-a', half)).toBe(true);
    expect(loadMealDraft('user-a')).toEqual(half);
    expect(saveMealDraft('user-a', { ...draft, amount: 0 })).toBe(false);
    expect(saveMealDraft('user-a', { ...draft, amount: NaN })).toBe(false);
  });

  it('isolates new and edited meals and clears only the requested draft', () => {
    saveMealDraft('user-a', draft);
    const edit = { ...draft, name: 'Edited shake', foodId: 'cached-food', locked: true };
    saveMealDraft('user-a', edit, 'edit:log-one');
    expect(loadMealDraft('user-a', 'edit:log-one')).toEqual(edit);
    clearMealDraft('user-a', 'edit:log-one');
    expect(loadMealDraft('user-a', 'edit:log-one')).toBeNull();
    expect(loadMealDraft('user-a')).toEqual(draft);
  });

  it('does not persist drafts for signed out users or invalid quantities', () => {
    expect(saveMealDraft('', draft)).toBe(false);
    expect(loadMealDraft('')).toBeNull();
    expect(saveMealDraft('user-a', { ...draft, ingredients: [{ ...ingredients[0], servings: 0 }] })).toBe(false);
    expect(saveMealDraft('user-a', { ...draft, entryId: 'not-a-uuid' })).toBe(false);
    expect(saveMealDraft('user-a', { ...draft, time: '25:99' })).toBe(false);
  });

  it('rejects corrupt or malformed persisted state', () => {
    vi.mocked(localStorage.getItem).mockReturnValue('{broken');
    expect(loadMealDraft('user-a')).toBeNull();
    vi.mocked(localStorage.getItem).mockReturnValue(JSON.stringify({ ...draft, ingredients: [null] }));
    expect(loadMealDraft('user-a')).toBeNull();
  });

  it('reports blocked writes and tolerates unavailable reads and clears', () => {
    vi.mocked(localStorage.setItem).mockImplementation(() => { throw new Error('Quota exceeded'); });
    vi.mocked(localStorage.getItem).mockImplementation(() => { throw new Error('Storage disabled'); });
    vi.mocked(localStorage.removeItem).mockImplementation(() => { throw new Error('Storage disabled'); });
    expect(saveMealDraft('user-a', draft)).toBe(false);
    expect(loadMealDraft('user-a')).toBeNull();
    expect(() => clearMealDraft('user-a')).not.toThrow();
  });
});
