import { describe, expect, it } from 'vitest';
import { mapFatSecretBarcodeFood } from '@/lib/fatSecret';

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
