import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Food, NutritionGroup } from '@/types';

// Shared Fuel rules moved out of the web components so the native app uses the
// same ones (FoodLogger, Nutrition, NutritionGroupLedger, BarcodeScanner).

const mocks = vi.hoisted(() => ({
  insertOneServingFood: vi.fn(),
  findSavedFoodByBarcode: vi.fn(),
  fatsecret: vi.fn(),
  usda: vi.fn(),
  off: vi.fn(),
  detail: vi.fn(),
}));

vi.mock('@/lib/foodPersistence', async (original) => ({
  ...(await original<typeof import('@/lib/foodPersistence')>()),
  insertOneServingFood: mocks.insertOneServingFood,
}));
vi.mock('@/lib/savedBarcodeFoods', () => ({ findSavedFoodByBarcode: mocks.findSavedFoodByBarcode }));
vi.mock('@/lib/usdaClient', () => ({
  searchFatSecretByBarcodeSecure: mocks.fatsecret,
  searchUsdaFoodByBarcodeSecure: mocks.usda,
  searchOpenFoodFactsByBarcodeSecure: mocks.off,
  fetchUsdaFoodDetailSecure: mocks.detail,
  searchUsdaFoodsSecure: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { lookupBarcode } from '@/lib/barcodeLookup';
import { amountError, amountForUnit, formatMacroInput, servingsForAmount } from '@/lib/foodUnits';
import { fuelDaySummary, fuelDayTitle, fuelTargets } from '@/lib/fuelSummary';
import { resolveManualFood } from '@/lib/manualFood';
import { buildCalendarDays, weekDays } from '@/lib/nutritionCalendar';
import { offersMoveToPreviousDay } from '@/lib/nutritionDay';
import { servingLabel, sortLedgerEntries, sourceLabel } from '@/lib/nutritionLedger';
import { buildPhotoHint, groundPhotoItems, logPhotoItems, photoItemStatus, photoItemTotals, type PhotoReviewItem } from '@/lib/photoReview';
import { buildEntryPayload, chosenFoodLogSource } from '@/lib/saveNutritionEntry';
import { filterSavedMeals, foodValuesMatch, savedMealSuggestions } from '@/lib/savedMeals';

const food = (overrides: Partial<Food> = {}): Food => ({
  id: 'f1',
  user_id: 'u1',
  name: 'Greek yogurt',
  calories: 100,
  protein: 10,
  carbs: 4,
  fat: 2,
  serving_size: 1,
  serving_unit: 'serving',
  source: 'saved_meal',
  fdc_id: null,
  ...overrides,
});

const group = (id: string, label: NutritionGroup['label'], kind: NutritionGroup['kind'] = 'meal'): NutritionGroup =>
  ({ id, user_id: 'u1', date: '2026-10-27', kind, label, sort_order: 0 }) as NutritionGroup;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Fuel summary', () => {
  it('falls back to the default targets for missing or zero values', () => {
    expect(fuelTargets({ calories: 0, protein: 180, carbs: null, fat: 70 })).toEqual({ calories: 2000, protein: 180, carbs: 200, fat: 70 });
  });

  it('says what is left today, what is over, or which day a past entry adds to', () => {
    const day = new Date(2026, 9, 27, 12);
    const totals = { calories: 1500, protein: 100, carbs: 0, fat: 0 };
    expect(fuelDaySummary({ totals, target: { calories: 2000, protein: 150 }, live: true, selectedDate: day }).logLine).toBe(
      '500 kcal left · 50 g protein to go',
    );
    expect(
      fuelDaySummary({ totals: { ...totals, calories: 2100, protein: 160 }, target: { calories: 2000, protein: 150 }, live: true, selectedDate: day }).logLine,
    ).toBe('100 kcal over target');
    expect(fuelDaySummary({ totals, target: null, live: false, selectedDate: day }).logLine).toBe('Adds to Tuesday, Oct 27');
  });

  it('titles today, another day, and a day in another year', () => {
    const now = new Date(2026, 9, 27, 9);
    expect(fuelDayTitle(new Date(2026, 9, 27, 12), now)).toBe('Today · Oct 27');
    expect(fuelDayTitle(new Date(2026, 9, 26, 12), now)).toBe('Monday, Oct 26');
    expect(fuelDayTitle(new Date(2025, 11, 31, 12), now)).toBe('Wednesday, Dec 31 · 2025');
  });
});

describe('food units', () => {
  const chicken = food({ serving_size: 100, serving_unit: 'g' });

  it('turns an amount into servings, or says why it cannot', () => {
    expect(servingsForAmount(chicken, '1.5', 'serving')).toBe(1.5);
    expect(servingsForAmount(chicken, '150', 'g')).toBeCloseTo(1.5);
    expect(amountError(chicken, '0', 'g')).toBe('Enter a valid amount greater than zero.');
    expect(amountError(food(), '2', 'g')).toBe("Can't convert g to serving for this food.");
  });

  it('converts the amount when the unit changes', () => {
    expect(amountForUnit(chicken, '2', 'serving', 'g')).toBe('200');
    expect(amountForUnit(chicken, '250', 'g', 'serving')).toBe('2.5');
    expect(formatMacroInput(12.04)).toBe('12');
    expect(formatMacroInput(12.36)).toBe('12.4');
  });
});

describe('saved meals', () => {
  const meals = [food({ id: 'a', name: 'Oat bowl' }), food({ id: 'b', name: 'Banana oat shake' }), food({ id: 'c', name: 'Rice' })];

  it('suggests starts-with matches before contains matches, from two letters', () => {
    expect(savedMealSuggestions(meals, 'o').map((meal) => meal.id)).toEqual([]);
    expect(savedMealSuggestions(meals, 'OA').map((meal) => meal.id)).toEqual(['a', 'b']);
    expect(filterSavedMeals(meals, ' rice ').map((meal) => meal.id)).toEqual(['c']);
  });

  it('matches names case-insensitively and macros within 0.05', () => {
    expect(foodValuesMatch(food(), { name: ' greek  YOGURT', calories: 100.04, protein: 10, carbs: 4, fat: 2 })).toBe(true);
    expect(foodValuesMatch(food(), { name: 'Greek yogurt', calories: 101, protein: 10, carbs: 4, fat: 2 })).toBe(false);
  });
});

describe('manual food choice', () => {
  const values = { name: 'Greek yogurt', calories: 100, protein: 10, carbs: 4, fat: 2 };
  const base = { userId: 'u1', values, selectedSavedMeal: null, saveAsReusable: false, savedMeals: [], cachedOneOff: null };

  it('uses an unchanged picked saved meal, then an equal saved meal when saving as reusable', async () => {
    expect(await resolveManualFood({ ...base, selectedSavedMeal: food({ id: 'picked' }) })).toEqual({ foodId: 'picked', createdSavedMeal: false, oneOff: null });
    expect(await resolveManualFood({ ...base, saveAsReusable: true, savedMeals: [food({ id: 'same' })] })).toMatchObject({ foodId: 'same', createdSavedMeal: false });
    expect(mocks.insertOneServingFood).not.toHaveBeenCalled();
  });

  it('creates a saved meal when saving as reusable without a match', async () => {
    mocks.insertOneServingFood.mockResolvedValue({ id: 'new-meal', error: null });
    expect(await resolveManualFood({ ...base, saveAsReusable: true })).toMatchObject({ foodId: 'new-meal', createdSavedMeal: true });
    expect(mocks.insertOneServingFood).toHaveBeenCalledWith('u1', values, 'saved_meal');
  });

  it('keeps an edited entry on its original row when the food is unchanged', async () => {
    expect(await resolveManualFood({ ...base, originalEntry: { food_id: 'orig', food: values } })).toMatchObject({ foodId: 'orig' });
  });

  it('reuses the one-off row of a failed attempt, else creates one', async () => {
    mocks.insertOneServingFood.mockResolvedValue({ id: 'one-off', error: null });
    const first = await resolveManualFood(base);
    expect(first).toMatchObject({ foodId: 'one-off', oneOff: { id: 'one-off' } });
    const retry = await resolveManualFood({ ...base, cachedOneOff: first.foodId ? first.oneOff : null });
    expect(retry).toMatchObject({ foodId: 'one-off' });
    expect(mocks.insertOneServingFood).toHaveBeenCalledTimes(1);
    expect(mocks.insertOneServingFood).toHaveBeenCalledWith('u1', values, 'manual_entry');
  });

  it('reports which insert failed', async () => {
    mocks.insertOneServingFood.mockResolvedValue({ id: null, error: new Error('x') });
    expect(await resolveManualFood({ ...base, saveAsReusable: true })).toEqual({ foodId: null, error: 'saved_meal' });
    expect(await resolveManualFood(base)).toEqual({ foodId: null, error: 'entry' });
  });
});

describe('entry payload and source', () => {
  it('mirrors the group and keeps the chosen local day and time', () => {
    const payload = buildEntryPayload({
      foodId: 'f1',
      servings: 2,
      source: 'usda',
      entryDate: new Date(2026, 9, 26, 12),
      time: '07:45',
      group: group('g1', 'breakfast'),
    });
    expect(payload).toMatchObject({ food_id: 'f1', servings: 2, source: 'usda', date: '2026-10-26', group_id: 'g1', meal_type: 'breakfast' });
    expect(new Date(payload.logged_at).getHours()).toBe(7);
    expect(buildEntryPayload({ foodId: 'f', servings: 1, source: 'manual', entryDate: new Date(), time: '12:00', group: group('s', null, 'snack') }).meal_type).toBe('snack');
  });

  it('names the source for a list food or each barcode provider', () => {
    expect(chosenFoodLogSource(food({ source: 'usda' }))).toBe('usda');
    expect(chosenFoodLogSource(food())).toBe('manual');
    expect(chosenFoodLogSource(food(), 'open_food_facts')).toBe('barcode_open_food_facts');
    expect(chosenFoodLogSource(food(), 'saved')).toBe('barcode_saved');
    expect(chosenFoodLogSource(food(), 'fatsecret')).toBe('barcode_fatsecret');
    expect(chosenFoodLogSource(food({ source: 'usda' }), 'usda')).toBe('barcode');
  });
});

describe('barcode lookup', () => {
  it('answers from the saved catalog without asking any provider', async () => {
    mocks.findSavedFoodByBarcode.mockResolvedValue(food({ name: 'Saved bar' }));
    expect(await lookupBarcode('0041570054161')).toMatchObject({ status: 'found', provider: 'saved' });
    expect(mocks.fatsecret).not.toHaveBeenCalled();
  });

  it('takes providers in priority order and misses when none has it', async () => {
    mocks.findSavedFoodByBarcode.mockResolvedValue(null);
    mocks.fatsecret.mockResolvedValue(null);
    mocks.usda.mockResolvedValue(null);
    mocks.off.mockResolvedValue(food({ name: 'OFF bar', source: 'open_food_facts' }));
    expect(await lookupBarcode('0041570054161')).toMatchObject({ status: 'found', provider: 'open_food_facts' });
    mocks.off.mockRejectedValue(new Error('down'));
    expect(await lookupBarcode('0041570054161')).toEqual({ status: 'miss' });
  });

  it('applies nothing when a newer lookup started', async () => {
    mocks.findSavedFoodByBarcode.mockResolvedValue(food());
    expect(await lookupBarcode('0041570054161', () => false)).toEqual({ status: 'stale' });
  });
});

describe('photo review', () => {
  const item = (overrides: Partial<PhotoReviewItem> = {}): PhotoReviewItem => ({
    id: 'i1',
    name: 'Rice',
    searchQuery: 'rice',
    amountGrams: 200,
    modelAmountGrams: 100,
    modelCalories: 130,
    modelProtein: 2.7,
    modelCarbs: 28,
    modelFat: 0.3,
    confidence: 0.8,
    notes: '',
    groundedFood: null,
    groundingCandidates: [],
    ...overrides,
  });

  it('builds the context line', () => {
    expect(buildPhotoHint({ plateDiameter: ' 27 ', ingredients: '', details: 'no skin' })).toBe(
      'Measured plate diameter: 27 cm. Oils, sauces, dressings, or hidden ingredients were not specified. Other details: no skin.',
    );
  });

  it('scales the model or the chosen USDA match to the reviewed grams', () => {
    expect(photoItemTotals(item())).toEqual({ calories: 260, protein: 5.4, carbs: 56, fat: 0.6 });
    const usda = food({ source: 'usda', calories: 120, protein: 3, carbs: 25, fat: 1, serving_size: 100, serving_unit: 'g' });
    expect(photoItemTotals(item({ groundedFood: usda })).calories).toBe(240);
    expect(photoItemStatus(item())).toBe('80% estimate');
    expect(photoItemStatus(item({ groundingCandidates: [usda] }))).toBe('Match not chosen');
  });

  it('offers only gram USDA candidates, three at most, and survives a failed search', async () => {
    const grams = (id: string) => food({ id, serving_unit: 'g' });
    const items = await groundPhotoItems(
      [{ name: 'Rice', search_query: 'rice', estimated_grams: 150, calories: 200, protein_g: 4, carbs_g: 44, fat_g: 0.4, confidence: 0.9, notes: '' }],
      async () => [grams('1'), food({ id: 'ml', serving_unit: 'ml' }), grams('2'), grams('3'), grams('4')],
      1,
    );
    expect(items[0].groundingCandidates.map((candidate) => candidate.id)).toEqual(['1', '2', '3']);
    const failed = await groundPhotoItems([{ name: 'X', search_query: 'x', estimated_grams: 1, calories: 1, protein_g: 0, carbs_g: 0, fat_g: 0, confidence: 1, notes: '' }], async () => {
      throw new Error('down');
    });
    expect(failed[0].groundingCandidates).toEqual([]);
  });

  it('logs one combined meal, or each item with a retry-the-rest message on failure', async () => {
    const ensureFood = vi.fn(async (row: Food) => `food-${row.name}`);
    const saveEntry = vi.fn(async () => true);
    await logPhotoItems({ items: [item(), item({ id: 'i2', name: 'Chicken' })], combine: true, summary: 'Plate', provider: 'anthropic', ensureFood, saveEntry });
    expect(saveEntry).toHaveBeenCalledTimes(1);
    expect(saveEntry).toHaveBeenCalledWith('food-Rice and Chicken', 1, 'photo_anthropic');

    const logged: string[] = [];
    saveEntry.mockReset();
    saveEntry.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(
      logPhotoItems({
        items: [item(), item({ id: 'i2', name: 'Chicken' })],
        combine: false,
        summary: '',
        provider: 'openai',
        ensureFood,
        saveEntry,
        onItemLogged: (id) => logged.push(id),
      }),
    ).rejects.toThrow('Could not log Chicken. 1 already logged item was removed from this review. Retry only the remaining items.');
    expect(logged).toEqual(['i1']);
  });
});

describe('day ledger and calendar', () => {
  it('labels sources and servings as the web ledger does', () => {
    expect(sourceLabel('photo_anthropic')).toBe('Claude photo');
    expect(sourceLabel('barcode_saved')).toBe('Manual');
    expect(servingLabel({ servings: 1.5, food: { serving_size: 100, serving_unit: 'g' } })).toBe('150 g');
    expect(servingLabel({ servings: 2, food: { serving_size: 1, serving_unit: 'serving' } })).toBe('2 servings');
  });

  it('orders a group by sort order, then time', () => {
    const entries = [
      { id: 'b', sort_order: 1, logged_at: '2026-10-27T08:00:00Z', date: '2026-10-27' },
      { id: 'a', sort_order: 0, logged_at: '2026-10-27T09:00:00Z', date: '2026-10-27' },
      { id: 'c', sort_order: 1, logged_at: '2026-10-27T07:00:00Z', date: '2026-10-27' },
    ];
    expect(sortLedgerEntries(entries).map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
  });

  it('builds Sunday-first weeks and months', () => {
    const days = buildCalendarDays(new Date(2026, 9, 15));
    expect(days[0].getDay()).toBe(0);
    expect(days.length % 7).toBe(0);
    expect(weekDays(new Date(2026, 9, 27)).map((day) => day.getDate())).toEqual([25, 26, 27, 28, 29, 30, 31]);
  });

  it('offers Move to yesterday only before 05:00 on today with a late entry', () => {
    const late = new Date(2026, 9, 27, 1, 30);
    const entries = [{ date: '2026-10-27', logged_at: new Date(2026, 9, 27, 0, 40).toISOString() }];
    expect(offersMoveToPreviousDay(entries, late)).toBe(true);
    expect(offersMoveToPreviousDay(entries, new Date(2026, 9, 27, 6))).toBe(false);
  });
});
