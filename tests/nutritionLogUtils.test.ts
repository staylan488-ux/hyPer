import { describe, expect, it } from 'vitest';
import { sumNutritionLogCalories } from '@/components/nutrition/nutritionLogUtils';

describe('nutrition log calorie totals', () => {
  it('sums calories after applying each entry serving count', () => {
    expect(sumNutritionLogCalories([
      { servings: 1.5, food: { calories: 200 } },
      { servings: 2, food: { calories: 75 } },
      { servings: 1, food: null },
    ])).toBe(450);
  });

  it('ignores invalid legacy values instead of poisoning the group total', () => {
    expect(sumNutritionLogCalories([
      { servings: Number.NaN, food: { calories: 200 } },
      { servings: 1, food: { calories: Number.NaN } },
      { servings: 1, food: { calories: 125 } },
    ])).toBe(125);
  });
});
