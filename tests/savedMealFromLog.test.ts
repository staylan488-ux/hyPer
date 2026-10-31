import { describe, expect, it } from 'vitest';

import { createMealIngredient, encodeMealComposition } from '@/lib/mealComposition';
import { canSaveAsMeal, isSavedMealFood, matchesSavedMeal, mealFromLoggedFoods, savedMealNamed } from '@/lib/savedMealFromLog';
import type { Food } from '@/types';

const food = (id: string, name: string, extra: Partial<Food> = {}): Food => ({
  id,
  user_id: 'u1',
  name,
  calories: 100,
  protein: 10,
  carbs: 5,
  fat: 2,
  serving_size: 100,
  serving_unit: 'g',
  source: 'usda',
  fdc_id: null,
  ...extra,
});

const ids = () => {
  let next = 0;
  return () => `id-${++next}`;
};

describe('save logged food as a meal', () => {
  it('keeps each food at the amount eaten, named after the foods', () => {
    const meal = mealFromLoggedFoods(
      [
        { food: food('rice', 'White rice'), servings: 1.5 },
        { food: food('chicken', 'Chicken breast', { calories: 165, protein: 31 }), servings: 2 },
      ],
      ids(),
    );
    expect(meal.name).toBe('White rice and Chicken breast');
    expect(meal.ingredients.map((part) => [part.id, part.food.id, part.servings])).toEqual([
      ['id-1', 'rice', 1.5],
      ['id-2', 'chicken', 2],
    ]);
  });

  it('opens a built meal into its ingredients, scaled by the amount eaten, and keeps its name', () => {
    const recipe = encodeMealComposition([
      createMealIngredient(food('oats', 'Oats'), 0.5, 'r1'),
      createMealIngredient(food('milk', 'Milk', { serving_unit: 'ml' }), 2, 'r2'),
    ]);
    const bowl = food('bowl', 'Oat bowl', { serving_size: 1, serving_unit: 'meal', source: 'manual_entry', description: recipe });
    const meal = mealFromLoggedFoods([{ food: bowl, servings: 2 }], ids());
    expect(meal.name).toBe('Oat bowl');
    expect(meal.ingredients.map((part) => [part.food.name, part.servings])).toEqual([
      ['Oats', 1],
      ['Milk', 4],
    ]);
    // every ingredient gets a fresh id, so the same meal can be saved twice
    expect(new Set(meal.ingredients.map((part) => part.id)).size).toBe(2);
    expect(meal.ingredients.map((part) => part.id)).not.toContain('r1');
  });

  it('reads numbers stored as text, names a repeated food once, and skips entries with nothing to save', () => {
    const coffee = { ...food('coffee', 'Coffee'), calories: '5' as unknown as number, fdc_id: 1234 as unknown as string };
    const meal = mealFromLoggedFoods(
      [
        { food: coffee, servings: '1' },
        { food: food('coffee-2', ' coffee '), servings: 1 },
        { food: null, servings: 1 },
        { food: food('zero', 'Water'), servings: 0 },
      ],
      ids(),
    );
    expect(meal.name).toBe('Coffee');
    expect(meal.ingredients).toHaveLength(2);
    expect(meal.ingredients[0].food).toMatchObject({ calories: 5, fdc_id: '1234' });
  });

  it('keeps a food from an unknown source, as a manual entry', () => {
    const odd = food('odd', 'Burrito', { source: 'gemini' as Food['source'] });
    const meal = mealFromLoggedFoods([{ food: odd, servings: 1 }], ids());
    expect(meal.ingredients[0].food.source).toBe('manual_entry');
  });

  it('shortens a long meal name', () => {
    const names = ['Eggs', 'Toast', 'Butter', 'Jam', 'Coffee'];
    const meal = mealFromLoggedFoods(names.map((name) => ({ food: food(name, name), servings: 1 })), ids());
    expect(meal.name).toBe('Eggs, Toast, Butter and 2 more');
  });

  it('offers saving unless the only food is a saved meal already', () => {
    expect(canSaveAsMeal([{ food: food('a', 'Oats'), servings: 1 }])).toBe(true);
    expect(canSaveAsMeal([{ food: food('s', 'Shake', { source: 'saved_meal' }), servings: 1 }])).toBe(false);
    expect(canSaveAsMeal([
      { food: food('s', 'Shake', { source: 'saved_meal' }), servings: 1 },
      { food: food('b', 'Banana'), servings: 1 },
    ])).toBe(true);
    expect(canSaveAsMeal([{ food: null, servings: 1 }])).toBe(false);
    expect(canSaveAsMeal([])).toBe(false);
    expect(isSavedMealFood({ source: 'custom' })).toBe(true);
    expect(isSavedMealFood({ source: 'manual_entry' })).toBe(false);
  });

  it('does not offer saving a built saved meal logged from Saved as it is saved', () => {
    // logged from Saved, a built meal is a fresh manual copy of the recipe
    const logged = food('copy', 'Test lunch', { calories: 473, protein: 55, carbs: 41, fat: 10, serving_size: 1, serving_unit: 'meal', source: 'manual_entry' });
    const saved = [{ name: 'test  LUNCH', calories: 473, protein: 55, carbs: 41, fat: 10.2 }];
    expect(matchesSavedMeal({ food: logged, servings: 1 }, saved)).toBe(true);
    expect(canSaveAsMeal([{ food: logged, servings: 1 }], saved)).toBe(false);
    // a different amount, a changed recipe or another name is a new meal to save
    expect(canSaveAsMeal([{ food: logged, servings: 2 }], saved)).toBe(true);
    expect(canSaveAsMeal([{ food: { ...logged, calories: 500 }, servings: 1 }], saved)).toBe(true);
    expect(canSaveAsMeal([{ food: { ...logged, name: 'Dinner bowl' }, servings: 1 }], saved)).toBe(true);
    // unknown saved meals: offered, and the sheet says what it replaces
    expect(canSaveAsMeal([{ food: logged, servings: 1 }], null)).toBe(true);
    // part of a bigger meal, it can be saved with the rest
    expect(canSaveAsMeal([{ food: logged, servings: 1 }, { food: food('b', 'Banana'), servings: 1 }], saved)).toBe(true);
  });

  it('finds the saved meal a name would replace, ignoring case and spacing', () => {
    const meals = [{ id: 'm1', name: 'Chicken and rice' }, { id: 'm2', name: 'Shake' }];
    expect(savedMealNamed(meals, '  chicken  AND rice ')?.id).toBe('m1');
    expect(savedMealNamed(meals, 'Chicken and rice', 'm1')).toBeUndefined();
    expect(savedMealNamed(meals, 'Oats')).toBeUndefined();
    expect(savedMealNamed(meals, ' ')).toBeUndefined();
    expect(savedMealNamed(null, 'Shake')).toBeUndefined();
  });
});
