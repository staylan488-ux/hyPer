import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMealIngredient, decodeMealComposition, type MealDraft } from '@/lib/mealComposition';
import { saveComposedMeal } from '@/lib/saveMealComposition';

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(), from: vi.fn(), upsert: vi.fn(), update: vi.fn(), eq: vi.fn(),
  persistNutritionEntry: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: mocks.getUser }, from: mocks.from } }));
vi.mock('@/lib/saveNutritionEntry', () => ({ persistNutritionEntry: mocks.persistNutritionEntry }));

const draft: MealDraft = {
  name: ' Protein shake ', time: '13:15', groupId: 'lunch-group', method: 'barcode',
  date: '2026-09-06', entryId: '22222222-2222-4222-8222-222222222222', saveAsReusableMeal: false, locked: true,
  ingredients: [createMealIngredient({
    id: 'milk', user_id: null, name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5,
    serving_size: 240, serving_unit: 'ml', source: 'open_food_facts', fdc_id: null,
  }, 1.5, 'milk')],
};

beforeEach(() => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-a' } }, error: null });
  mocks.from.mockReturnValue(mocks);
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.update.mockReturnValue(mocks);
  mocks.eq.mockImplementation((column: string) => column === 'user_id' ? Promise.resolve({ error: null }) : mocks);
  mocks.persistNutritionEntry.mockResolvedValue(undefined);
});

describe('composed meal persistence', () => {
  it('saves a complete recipe snapshot before logging it with selected time and destination', async () => {
    await saveComposedMeal(draft, 'user-a', { mealType: 'lunch' });

    expect(mocks.from).toHaveBeenCalledExactlyOnceWith('foods');
    const [food, config] = mocks.upsert.mock.calls[0];
    expect(food).toEqual({
      id: draft.entryId, user_id: 'user-a', name: 'Protein shake',
      calories: 180, protein: 12, carbs: 18, fat: 7.5,
      serving_size: 1, serving_unit: 'meal', source: 'manual_entry', description: expect.any(String),
    });
    expect(config).toEqual({ onConflict: 'id' });
    expect(decodeMealComposition(food.description)?.ingredients).toEqual(draft.ingredients);
    expect(mocks.persistNutritionEntry).toHaveBeenCalledExactlyOnceWith({
      food_id: draft.entryId, servings: 1, meal_type: 'lunch', group_id: 'lunch-group',
      source: 'meal_builder', date: '2026-09-06', logged_at: new Date(2026, 8, 6, 13, 15).toISOString(),
    }, undefined, draft.entryId, 'user-a');
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.persistNutritionEntry.mock.invocationCallOrder[0]);
  });

  it('saves reusable meals only when opted in', async () => {
    await saveComposedMeal({ ...draft, saveAsReusableMeal: true }, 'user-a');
    expect(mocks.upsert.mock.calls[0][0].source).toBe('saved_meal');
  });

  it('retries uncertain log saves using the exact same food and log identities', async () => {
    mocks.persistNutritionEntry.mockRejectedValueOnce(new Error('Connection lost'));
    await expect(saveComposedMeal(draft, 'user-a')).rejects.toThrow('Connection lost');
    await saveComposedMeal(draft, 'user-a');
    expect(mocks.upsert.mock.calls[0]).toEqual(mocks.upsert.mock.calls[1]);
    expect(mocks.persistNutritionEntry.mock.calls[0]).toEqual(mocks.persistNutritionEntry.mock.calls[1]);
    expect(mocks.persistNutritionEntry.mock.calls[1][2]).toBe(draft.entryId);
  });

  it('edits the target log through a fresh food snapshot without changing the original recipe', async () => {
    const original = JSON.stringify(draft);
    await saveComposedMeal(draft, 'user-a', { editEntryId: 'existing-log' });
    expect(mocks.persistNutritionEntry.mock.calls[0].slice(1)).toEqual(['existing-log', draft.entryId, 'user-a']);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(JSON.stringify(draft)).toBe(original);
  });

  it('replaces a saved template while retaining its old snapshot for historical logs', async () => {
    await saveComposedMeal(draft, 'user-a', { editSavedMealId: 'old-template' });
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({ id: draft.entryId, source: 'saved_meal' });
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith({ source: 'manual_entry' });
    expect(mocks.eq.mock.calls).toEqual([['id', 'old-template'], ['user_id', 'user-a']]);
    expect(mocks.upsert.mock.invocationCallOrder[0]).toBeLessThan(mocks.update.mock.invocationCallOrder[0]);
    expect(mocks.persistNutritionEntry).not.toHaveBeenCalled();
  });

  it('fails a template demotion and lets a retry reuse the new template identity', async () => {
    const error = { message: 'Unable to demote template' };
    mocks.eq.mockImplementation((column: string) => column === 'user_id' ? Promise.resolve({ error }) : mocks);
    await expect(saveComposedMeal(draft, 'user-a', { editSavedMealId: 'old-template' })).rejects.toBe(error);
    mocks.eq.mockImplementation((column: string) => column === 'user_id' ? Promise.resolve({ error: null }) : mocks);
    await saveComposedMeal(draft, 'user-a', { editSavedMealId: 'old-template' });
    expect(mocks.upsert.mock.calls[0]).toEqual(mocks.upsert.mock.calls[1]);
    expect(mocks.persistNutritionEntry).not.toHaveBeenCalled();
  });

  it('does not drop description or write a log when the food save fails', async () => {
    const error = { message: 'column foods.description does not exist' };
    mocks.upsert.mockResolvedValue({ error });
    await expect(saveComposedMeal(draft, 'user-a')).rejects.toBe(error);
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.persistNutritionEntry).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([null, { id: 'user-b' }])('rejects a missing or different authenticated user before writes', async (user) => {
    mocks.getUser.mockResolvedValue({ data: { user }, error: null });
    await expect(saveComposedMeal(draft, 'user-a')).rejects.toThrow('account changed');
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.persistNutritionEntry).not.toHaveBeenCalled();
  });

  it('propagates authentication errors before writes', async () => {
    const error = new Error('Auth unavailable');
    mocks.getUser.mockResolvedValue({ data: { user: null }, error });
    await expect(saveComposedMeal(draft, 'user-a')).rejects.toBe(error);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('rejects incomplete meals, impossible dates and conflicting edit targets before writes', async () => {
    await expect(saveComposedMeal({ ...draft, name: ' ' }, 'user-a')).rejects.toThrow();
    await expect(saveComposedMeal({ ...draft, ingredients: [] }, 'user-a')).rejects.toThrow();
    await expect(saveComposedMeal({ ...draft, date: '2026-02-30' }, 'user-a')).rejects.toThrow();
    await expect(saveComposedMeal(draft, 'user-a', { editEntryId: 'log', editSavedMealId: 'food' })).rejects.toThrow();
    await expect(saveComposedMeal(draft, 'user-a', { editSavedMealId: draft.entryId })).rejects.toThrow();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
