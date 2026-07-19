import { describe, expect, it } from 'vitest';
import { mapOpenFoodFactsProduct } from '@/lib/openFoodFacts';

describe('Open Food Facts product mapping', () => {
  it('uses labelled per-serving nutrition when available', () => {
    const food = mapOpenFoodFactsProduct({
      code: '0041570054161',
      status: 1,
      product: {
        product_name: 'Protein bar',
        brands: 'Example Foods',
        serving_size: '1 bar (55 g)',
        serving_quantity: 55,
        nutriments: {
          'energy-kcal_serving': 210,
          proteins_serving: 20,
          carbohydrates_serving: 23,
          fat_serving: 6,
          'energy-kcal_100g': 382,
        },
      },
    }, '0041570054161');

    expect(food).toEqual(expect.objectContaining({
      name: 'Protein bar · Example Foods',
      calories: 210,
      protein: 20,
      serving_size: 55,
      serving_unit: 'g',
      serving_label: '1 bar',
      source: 'open_food_facts',
      external_source: 'open_food_facts',
      external_id: '0041570054161',
    }));
  });

  it('falls back to a 100 g basis when serving nutrition is absent', () => {
    const food = mapOpenFoodFactsProduct({
      code: '4006381333931',
      status: 1,
      product: {
        product_name: 'Cereal',
        nutriments: {
          'energy-kcal_100g': '371.4',
          proteins_100g: '8.2',
          carbohydrates_100g: '76.5',
          fat_100g: '3.1',
        },
      },
    }, '4006381333931');

    expect(food).toEqual(expect.objectContaining({
      calories: 371.4,
      serving_size: 100,
      serving_unit: 'g',
    }));
  });

  it('preserves millilitre serving units for drinks', () => {
    const food = mapOpenFoodFactsProduct({
      code: '0041570054161',
      status: 1,
      product: {
        product_name: 'Almond milk',
        serving_size: '1 serving (240 ml)',
        serving_quantity: 240,
        serving_quantity_unit: 'ml',
        nutriments: {
          'energy-kcal_serving': 30,
          proteins_serving: 1,
          carbohydrates_serving: 1,
          fat_serving: 2.5,
        },
      },
    }, '0041570054161');

    expect(food).toEqual(expect.objectContaining({ serving_size: 240, serving_unit: 'ml' }));
  });

  it('rejects missing products and records without nutrition', () => {
    expect(mapOpenFoodFactsProduct({ status: 0 }, '0041570054161')).toBeNull();
    expect(mapOpenFoodFactsProduct({ status: 1, product: { product_name: 'Unknown' } }, '0041570054161')).toBeNull();
  });
});
