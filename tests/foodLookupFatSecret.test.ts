import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  extraLookupClaims,
  FATSECRET_FOODS_AT_ONCE,
  FATSECRET_FOODS_PER_REQUEST,
  fatSecretBarcodeId,
  fatSecretError,
  fatSecretFoodAnswer,
  fatSecretFoodParams,
  fatSecretFoods,
  fatSecretSearchFoods,
  fatSecretSearchParams,
  parseFoodIds,
  trimFatSecretFood,
} from '../supabase/functions/food-lookup/fatsecret';

const serving = { serving_id: '5522', serving_description: '1 container', metric_serving_amount: '150', metric_serving_unit: 'g', is_default: '1', calories: '120', carbohydrate: '6', protein: '16', fat: '3', sodium: '55', serving_url: 'https://example.test' };
const yogurt = { food_id: '4411', food_name: 'Greek Yogurt', brand_name: 'Chobani', food_type: 'Brand', food_url: 'https://example.test', servings: { serving: [serving] } };
const trimmed = {
  food_id: '4411', food_name: 'Greek Yogurt', brand_name: 'Chobani', food_type: 'Brand',
  servings: { serving: [{ serving_id: '5522', serving_description: '1 container', metric_serving_amount: '150', metric_serving_unit: 'g', is_default: '1', calories: '120', carbohydrate: '6', protein: '16', fat: '3' }] },
};

describe('what food-lookup asks FatSecret', () => {
  it('searches brands only, with the default serving marked', () => {
    expect(fatSecretSearchParams('chobani')).toEqual({
      method: 'foods.search.v6', search_expression: 'chobani', food_type: 'brand', max_results: '20', flag_default_serving: 'true',
    });
  });

  it('reads one food by its ID', () => {
    expect(fatSecretFoodParams('4411')).toEqual({ method: 'food.get.v6', food_id: '4411', flag_default_serving: 'true' });
  });

  it('takes a short list of numeric food IDs and nothing else', () => {
    expect(parseFoodIds('4411, 7,4411')).toEqual(['4411', '7']);
    expect(parseFoodIds('')).toBeNull();
    expect(parseFoodIds('4411;drop')).toBeNull();
    expect(parseFoodIds(['4411'])).toBeNull();
    expect(parseFoodIds(Array.from({ length: FATSECRET_FOODS_PER_REQUEST }, (_, index) => index + 1).join(','))).toHaveLength(FATSECRET_FOODS_PER_REQUEST);
    expect(parseFoodIds(Array.from({ length: FATSECRET_FOODS_PER_REQUEST + 1 }, (_, index) => index + 1).join(','))).toBeNull();
  });
});

describe('what a lookup by ID costs the account', () => {
  it('counts a long list as several lookups, five foods to one', () => {
    expect([1, 5, 6, 10, 11, 20].map(extraLookupClaims)).toEqual([0, 0, 1, 1, 2, 3]);
  });
});

describe("what food-lookup passes on of FatSecret's answers", () => {
  it('passes on only what the app reads of a food', () => {
    expect(trimFatSecretFood(yogurt)).toEqual(trimmed);
    // a single serving arrives as a bare object
    expect(trimFatSecretFood({ ...yogurt, servings: { serving } })).toEqual(trimmed);
    expect(trimFatSecretFood({ food_name: 'No id' })).toBeNull();
    expect(trimFatSecretFood(null)).toBeNull();
  });

  it('reads a search answer with many results, one result or none', () => {
    expect(fatSecretSearchFoods({ foods_search: { total_results: '2', results: { food: [yogurt, { ...yogurt, food_id: 7 }] } } })).toHaveLength(2);
    expect(fatSecretSearchFoods({ foods_search: { total_results: '1', results: { food: yogurt } } })).toEqual([trimmed]);
    expect(fatSecretSearchFoods({ foods_search: { total_results: '0' } })).toEqual([]);
    expect(fatSecretSearchFoods({})).toEqual([]);
  });

  it('tells a food FatSecret no longer has from a lookup that failed', () => {
    expect(fatSecretFoodAnswer({ food: yogurt })).toEqual({ kind: 'found', food: trimmed });
    expect(fatSecretFoodAnswer({ error: { code: 106, message: 'Invalid ID' } })).toEqual({ kind: 'missing' });
    expect(fatSecretFoodAnswer({ error: { code: 12, message: 'Method not accessible' } })).toEqual({ kind: 'error', code: 12 });
    expect(fatSecretFoodAnswer({})).toEqual({ kind: 'error', code: 0 });
    expect(fatSecretError({ error: { code: '21', message: 'Invalid IP' } })).toEqual({ code: 21, message: 'Invalid IP' });
    expect(fatSecretError({ food: yogurt })).toBeNull();
  });

  it("reads a barcode's food ID, and an unknown barcode as no product", () => {
    expect(fatSecretBarcodeId({ food_id: { value: '4411' } })).toEqual({ kind: 'found', foodId: '4411' });
    expect(fatSecretBarcodeId({ food_id: { value: 0 } })).toEqual({ kind: 'missing' });
    expect(fatSecretBarcodeId({ error: { code: 211, message: 'No food item detected' } })).toEqual({ kind: 'missing' });
    expect(fatSecretBarcodeId({ error: { code: 21, message: 'Invalid IP' } })).toEqual({ kind: 'error', code: 21 });
  });

  it('looks several foods up a few at a time, and leaves a failed one out of both lists', async () => {
    let running = 0;
    let most = 0;
    const getFood = vi.fn(async (id: string) => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      if (id === '2') return { error: { code: 106 } };
      if (id === '3') throw new Error('timeout');
      return { food: { ...yogurt, food_id: id } };
    });
    const ids = Array.from({ length: 12 }, (_, index) => String(index + 1));
    const answer = await fatSecretFoods(ids, getFood);
    expect(getFood).toHaveBeenCalledTimes(12);
    expect(most).toBeLessThanOrEqual(FATSECRET_FOODS_AT_ONCE);
    expect(answer.missing).toEqual(['2']);
    expect(answer.foods.map((food) => food.food_id).sort()).toEqual(ids.filter((id) => id !== '2' && id !== '3').sort());
  });
});

describe('what the function keeps of FatSecret', () => {
  const source = readFileSync(new URL('../supabase/functions/food-lookup/index.ts', import.meta.url), 'utf8');

  it("caches a barcode's food ID and never a food", () => {
    // FatSecret's terms: nothing but IDs may stay on the server past 24 hours.
    const cached = [...source.matchAll(/cachedBarcodeAnswer\(store, `([a-z_-]+):/g)].map((match) => match[1]);
    expect(cached).toEqual(['open_food_facts', 'fatsecret-id', 'usda']);
    expect(source).toContain("payload: { food_id: found.foodId }");
  });

  it('marks a barcode answer as coming from a function that can read the food again by ID', () => {
    expect(source).toContain('jsonResponse({ configured: true, food: food.food })');
    expect(source).not.toMatch(/jsonResponse\(\{ food:/);
  });

  it('answers FatSecret lookups only for builds that keep the details on the phone', () => {
    expect(source).toContain("Deno.env.get('FATSECRET_ENABLED') !== '1' || body.keeps !== 'device'");
  });
});
