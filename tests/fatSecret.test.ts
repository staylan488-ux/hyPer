import { describe, expect, it } from 'vitest';
import { mapFatSecretBarcodeFood, mapFatSecretFood, mapFatSecretSearch } from '@/lib/fatSecret';

describe('FatSecret barcode response mapping', () => {
  it('chooses the flagged package serving and preserves storable identifiers', () => {
    const food = mapFatSecretBarcodeFood({
      food: {
        food_id: '50953',
        food_name: 'Whole Grain Cheerios',
        brand_name: 'General Mills',
        servings: {
          serving: [
            {
              serving_id: '0',
              serving_description: '100 g',
              metric_serving_amount: '100',
              metric_serving_unit: 'g',
              calories: '333',
              carbohydrate: '66.67',
              protein: '10',
              fat: '6.67',
            },
            {
              serving_id: '100675',
              serving_description: '1 cup',
              metric_serving_amount: '30',
              metric_serving_unit: 'g',
              measurement_description: 'serving',
              is_default: '1',
              calories: '100',
              carbohydrate: '20.00',
              protein: '3.00',
              fat: '2.00',
            },
          ],
        },
      },
    });

    expect(food).toEqual(expect.objectContaining({
      id: 'fatsecret:50953:100675',
      name: 'Whole Grain Cheerios · General Mills',
      calories: 100,
      protein: 3,
      carbs: 20,
      fat: 2,
      serving_size: 30,
      serving_unit: 'g',
      serving_label: '1 cup',
      source: 'fatsecret',
      external_source: 'fatsecret',
      external_id: '50953:100675',
    }));
  });

  it('accepts a singleton serving object and an ounce basis', () => {
    const food = mapFatSecretBarcodeFood({
      food: {
        food_id: 42,
        food_name: 'Sparkling drink',
        servings: {
          serving: {
            serving_id: 77,
            serving_description: '1 can',
            metric_serving_amount: 12,
            metric_serving_unit: 'oz',
            calories: 5,
            carbohydrate: 1.2,
            protein: 0,
            fat: 0,
          },
        },
      },
    });

    expect(food).toEqual(expect.objectContaining({
      name: 'Sparkling drink',
      serving_size: 12,
      serving_unit: 'oz',
      serving_label: '1 can',
    }));
  });

  it('rejects provider errors, incomplete identities, and incomplete macros', () => {
    expect(mapFatSecretBarcodeFood({ error: { code: 211, message: 'No food item detected' } })).toBeNull();
    expect(mapFatSecretBarcodeFood({ food: { food_name: 'Missing ID' } })).toBeNull();
    expect(mapFatSecretBarcodeFood({
      food: {
        food_id: '1',
        food_name: 'Incomplete',
        servings: {
          serving: {
            serving_id: '2',
            calories: '100',
            protein: '3',
            carbohydrate: '20',
          },
        },
      },
    })).toBeNull();
  });
});

describe('FatSecret foods by serving, and brand search', () => {
  const serving = (id: string, description: string, calories: string, extra: Record<string, string> = {}) => ({
    serving_id: id, serving_description: description, metric_serving_amount: '150', metric_serving_unit: 'g',
    calories, carbohydrate: '6', protein: '16', fat: '3', ...extra,
  });
  const yogurt = {
    food_id: '4411', food_name: 'Greek Yogurt', brand_name: 'Chobani', food_type: 'Brand',
    servings: { serving: [serving('5521', '100 g', '80'), serving('5522', '1 container', '120', { is_default: '1' })] },
  };

  it('reads the serving a log was saved with, not the default one', () => {
    expect(mapFatSecretFood(yogurt, '5521')).toMatchObject({ id: 'fatsecret:4411:5521', calories: 80, external_id: '4411:5521' });
    expect(mapFatSecretFood(yogurt, '5522')).toMatchObject({ id: 'fatsecret:4411:5522', calories: 120, serving_label: '1 container' });
    expect(mapFatSecretFood(yogurt)).toMatchObject({ id: 'fatsecret:4411:5522' });
  });

  it('has no food for a serving FatSecret no longer lists', () => {
    expect(mapFatSecretFood(yogurt, '9999')).toBeNull();
    expect(mapFatSecretFood(null, '5522')).toBeNull();
  });

  it('lists brand results once each, in FatSecret\'s order, and leaves plain food to the app\'s own list', () => {
    const foods = mapFatSecretSearch({
      configured: true,
      foods: [
        yogurt,
        { food_id: '1', food_name: 'Banana', food_type: 'Generic', servings: { serving: serving('2', '1 medium', '105') } },
        { food_id: '7', food_name: 'Big Mac', brand_name: "McDonald's", food_type: 'Brand', servings: { serving: serving('8', '1 burger', '590') } },
        yogurt,
        { food_id: '9', food_name: 'No numbers', food_type: 'Brand', servings: { serving: [] } },
      ],
    });
    expect(foods.map((food) => food.name)).toEqual(['Greek Yogurt · Chobani', "Big Mac · McDonald's"]);
    expect(foods.every((food) => food.source === 'fatsecret' && food.external_source === 'fatsecret')).toBe(true);
  });

  it('has no results for an answer that is not a list', () => {
    expect(mapFatSecretSearch(null)).toEqual([]);
    expect(mapFatSecretSearch({ configured: true })).toEqual([]);
    expect(mapFatSecretSearch({ foods: 'x' as never })).toEqual([]);
  });
});
