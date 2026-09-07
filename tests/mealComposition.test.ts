import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Food } from '@/types';
import {
  clearMealDraft, createMealIngredient, decodeMealComposition, encodeMealComposition,
  getMealTotals, loadMealDraft, MEAL_COMPOSITION_PREFIX, saveMealDraft, scaleMealIngredients,
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
const ingredients = [createMealIngredient(milk, 1.5, 'one'), createMealIngredient(powder, 2, 'two')];
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
    const snapshot = createMealIngredient(food, 1, 'milk');
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

  it.each([0, -1, NaN, Infinity])('rejects invalid ingredient or meal quantity %s', (quantity) => {
    expect(() => createMealIngredient(milk, quantity, 'bad')).toThrow();
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
