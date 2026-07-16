import { describe, expect, it } from 'vitest';
import { cronometerGroupDestination, legacyMealTypeForGroup, nutritionGroupLabel } from '@/lib/nutritionGroups';
import type { NutritionGroup } from '@/types';

const groups: NutritionGroup[] = [
  { id: 'breakfast', user_id: 'u1', date: '2026-07-16', kind: 'meal', label: 'breakfast', sort_order: 0 },
  { id: 'meal-a', user_id: 'u1', date: '2026-07-16', kind: 'meal', label: null, sort_order: 1 },
  { id: 'snack-a', user_id: 'u1', date: '2026-07-16', kind: 'snack', label: null, sort_order: 2 },
  { id: 'meal-b', user_id: 'u1', date: '2026-07-16', kind: 'meal', label: null, sort_order: 3 },
];

describe('nutrition group labels', () => {
  it('preserves named meals and numbers unnamed meals/snacks independently', () => {
    expect(nutritionGroupLabel(groups[0], groups)).toBe('Breakfast');
    expect(nutritionGroupLabel(groups[1], groups)).toBe('Meal 1');
    expect(nutritionGroupLabel(groups[2], groups)).toBe('Snack 1');
    expect(nutritionGroupLabel(groups[3], groups)).toBe('Meal 2');
  });

  it('maps groups to the backward-compatible meal_type field', () => {
    expect(legacyMealTypeForGroup(groups[0])).toBe('breakfast');
    expect(legacyMealTypeForGroup(groups[1])).toBeNull();
    expect(legacyMealTypeForGroup(groups[2])).toBe('snack');
  });
});
describe('Cronometer group mapping', () => {
  it('maps named groups and numbered meals/snacks', () => {
    expect(cronometerGroupDestination('Lunch')).toEqual({ kind: 'meal', label: 'lunch' });
    expect(cronometerGroupDestination('Supper')).toEqual({ kind: 'meal', label: 'dinner' });
    expect(cronometerGroupDestination('Meal 3')).toEqual({ kind: 'meal', label: null, ordinal: 3 });
    expect(cronometerGroupDestination('Snacks 2')).toEqual({ kind: 'snack', label: null, ordinal: 2 });
  });

  it('leaves unknown custom groups unassigned', () => {
    expect(cronometerGroupDestination('Supplements')).toBeNull();
  });
});
