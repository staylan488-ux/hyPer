import { describe, expect, it, vi } from 'vitest';
import { searchUsdaFoodByBarcode } from '@/components/nutrition/usdaSearch';

describe('USDA barcode lookup', () => {
  it('uses kcal energy when a kJ energy row appears first', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      foods: [{
        fdcId: 10,
        description: 'Energy unit test',
        gtinUpc: '0012345678905',
        servingSize: 100,
        servingSizeUnit: 'g',
        foodNutrients: [
          { nutrientId: 1062, nutrientName: 'Energy', unitName: 'kJ', value: 1674 },
          { nutrientId: 1008, nutrientName: 'Energy', unitName: 'kcal', value: 400 },
          { nutrientId: 1003, nutrientName: 'Protein', unitName: 'g', value: 20 },
        ],
      }],
    }), { status: 200 }));

    const food = await searchUsdaFoodByBarcode('012345678905', 'test-key', fetcher as typeof fetch);
    expect(food?.calories).toBe(400);
    expect(food?.protein).toBe(20);
  });

  it('returns only an exact equivalent GTIN match', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      foods: [
        { fdcId: 1, description: 'Wrong product', gtinUpc: '4006381333931', foodNutrients: [] },
        {
          fdcId: 2,
          description: 'Exact product',
          gtinUpc: '0012345678905',
          servingSize: 30,
          servingSizeUnit: 'g',
          householdServingFullText: '1 bar',
          foodNutrients: [
            { nutrientName: 'Energy', value: 400 },
            { nutrientName: 'Protein', value: 20 },
            { nutrientName: 'Carbohydrate', value: 50 },
            { nutrientName: 'Total lipid (fat)', value: 10 },
          ],
        },
      ],
    }), { status: 200 }));

    const food = await searchUsdaFoodByBarcode('012345678905', 'test-key', fetcher as typeof fetch);
    expect(food).toEqual(expect.objectContaining({
      name: 'Exact product',
      fdc_id: '2',
      calories: 120,
      serving_size: 30,
      serving_label: '1 bar',
    }));
  });

  it('rejects a bad checksum without making a request', async () => {
    const fetcher = vi.fn();
    await expect(searchUsdaFoodByBarcode('012345678904', 'test-key', fetcher as typeof fetch)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('queries USDA with expanded UPC-A and accepts an exact UPC-E equivalent', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      foods: [
        { fdcId: 3, description: 'UPC-E product', gtinUpc: '042100005264', foodNutrients: [] },
      ],
    }), { status: 200 }));

    const food = await searchUsdaFoodByBarcode('04252614', 'test-key', fetcher as typeof fetch);

    expect(food?.name).toBe('UPC-E product');
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('query=042100005264'));
  });
});
