import { describe, expect, it } from 'vitest';
import { logMacro, sumMacros, sumShownMacros } from '@/lib/nutritionMacros';
import { sumNutritionLogCalories } from '@/components/nutrition/nutritionLogUtils';

interface Food { calories: number; protein: number; carbs: number; fat: number }

// The reducer Fuel and Today used before the shared helper.
function previousReducer(logs: Array<{ servings: number; food: Food | null }>) {
  return logs.reduce(
    (acc, log) => {
      const food = log.food;
      return {
        calories: acc.calories + (food?.calories || 0) * log.servings,
        protein: acc.protein + (food?.protein || 0) * log.servings,
        carbs: acc.carbs + (food?.carbs || 0) * log.servings,
        fat: acc.fat + (food?.fat || 0) * log.servings,
      };
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

const day = [
  { servings: 1.5, food: { calories: 212.4, protein: 17.3, carbs: 20.1, fat: 7.7 } },
  { servings: 0.33, food: { calories: 95.25, protein: 0.4, carbs: 25.13, fat: 0.31 } },
  { servings: 2, food: { calories: 143, protein: 12.6, carbs: 0.72, fat: 9.51 } },
  { servings: 1, food: null },
  { servings: 3.75, food: { calories: 52.1, protein: 1.07, carbs: 11.6, fat: 0.17 } },
];

describe('shared macro totals', () => {
  it('matches the previous page reducer exactly on normal data', () => {
    expect(sumMacros(day)).toEqual(previousReducer(day));
  });

  it('accepts DECIMAL values that arrive as strings', () => {
    expect(sumMacros([
      { servings: '1.50', food: { calories: '200.00', protein: '10.5', carbs: '20', fat: '4.25' } },
      { servings: 2, food: { calories: '75', protein: 3, carbs: null, fat: '1' } },
    ])).toEqual({ calories: 450, protein: 21.75, carbs: 30, fat: 8.375 });
  });

  it('counts a missing food as nothing', () => {
    expect(sumMacros([{ servings: 1, food: null }])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(logMacro({ servings: 1, food: null }, 'calories')).toBeNull();
  });

  it('skips non-finite values per macro instead of poisoning the total', () => {
    expect(sumMacros([
      { servings: Number.NaN, food: { calories: 200, protein: 10, carbs: 10, fat: 10 } },
      { servings: 1, food: { calories: Number.NaN, protein: 'n/a', carbs: 5, fat: Number.POSITIVE_INFINITY } },
      { servings: 1, food: { calories: 125, protein: 6 } },
    ])).toEqual({ calories: 125, protein: 6, carbs: 5, fat: 0 });
  });

  it('totals what the rows show: each entry rounded once, then summed', () => {
    const rowsShown = (macro: 'calories' | 'protein') => day.reduce((total, log) => {
      const value = Number(log.food?.[macro]);
      return Number.isFinite(value) ? total + Math.round(value * log.servings) : total;
    }, 0);
    // Rows read 26 g, 0 g, 25 g, 0 g, 4 g of protein: the header says their sum, 55 g.
    expect(sumShownMacros(day).protein).toBe(rowsShown('protein'));
    expect(sumShownMacros(day).protein).toBe(55);
    expect(sumNutritionLogCalories(day)).toBe(rowsShown('calories'));
    expect(sumShownMacros([{ servings: 1, food: null }])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});
