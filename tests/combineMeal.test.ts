import { describe, expect, it } from 'vitest';

import { combineIntoOneMeal, combinedMealName, type CombinableItem } from '@/lib/combineMeal';

function item(overrides: Partial<CombinableItem> = {}): CombinableItem {
  return {
    name: 'Chicken breast, grilled',
    amountGrams: 155,
    calories: 256,
    protein: 48,
    carbs: 0,
    fat: 5.5,
    ...overrides,
  };
}

const plate = () => [
  item(),
  item({ name: 'White rice, cooked', amountGrams: 190, calories: 247, protein: 5.1, carbs: 53.6, fat: 0.6 }),
  item({ name: 'Olive oil', amountGrams: 8, calories: 71, protein: 0, carbs: 0, fat: 8 }),
];

describe('combineIntoOneMeal', () => {
  it('sums the components exactly as reviewed', () => {
    const meal = combineIntoOneMeal(plate())!;
    expect(meal.calories).toBe(574);
    expect(meal.protein).toBe(53.1);
    expect(meal.carbs).toBe(53.6);
    expect(meal.fat).toBe(14.1);
    expect(meal.totalGrams).toBe(353);
  });

  it('carries the model summary through as the description', () => {
    const meal = combineIntoOneMeal(plate(), 'Grilled chicken with rice, cooked in oil.')!;
    expect(meal.description).toBe('Grilled chicken with rice, cooked in oil.');
  });

  it('falls back to a component list when the model gave no summary', () => {
    const meal = combineIntoOneMeal(plate(), '   ')!;
    expect(meal.description).toContain('Chicken breast, grilled 155g');
    expect(meal.description).toContain('Olive oil 8g');
  });

  it('returns null for an empty breakdown rather than logging nothing', () => {
    expect(combineIntoOneMeal([])).toBeNull();
  });

  it('never produces a zero serving size', () => {
    // a serving size of zero divides by zero downstream
    const meal = combineIntoOneMeal([item({ amountGrams: 0 })])!;
    expect(meal.totalGrams).toBe(1);
  });

  it('ignores non-finite numbers instead of poisoning the total', () => {
    const meal = combineIntoOneMeal([item(), item({ calories: Number.NaN, protein: Number.NaN })])!;
    expect(Number.isFinite(meal.calories)).toBe(true);
    expect(meal.calories).toBe(256);
  });
});

describe('combinedMealName', () => {
  it('names a single item as itself', () => {
    expect(combinedMealName([item({ name: 'Banana' })])).toBe('Banana');
  });

  it('joins two or three components readably', () => {
    expect(combinedMealName([item({ name: 'Eggs' }), item({ name: 'Toast' })]))
      .toBe('Eggs and Toast');
    expect(combinedMealName([item({ name: 'Eggs' }), item({ name: 'Toast' }), item({ name: 'Butter' })]))
      .toBe('Eggs, Toast and Butter');
  });

  it('counts the rest past three so the title stays one line', () => {
    const many = ['Eggs', 'Toast', 'Butter', 'Jam', 'Coffee'].map((name) => item({ name }));
    expect(combinedMealName(many)).toBe('Eggs, Toast, Butter and 2 more');
  });

  it('degrades to a generic name when nothing is named', () => {
    expect(combinedMealName([item({ name: '  ' })])).toBe('Meal');
  });
});
