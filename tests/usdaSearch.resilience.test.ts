import { describe, expect, it, vi } from 'vitest';

import { searchUsdaFoods } from '@/components/nutrition/usdaSearch';

describe('USDA search resilience', () => {
  it('maps USDA API foods into app foods', async () => {
    const fetcher = vi.fn(async () => ({
      json: async () => ({
        foods: [
          {
            fdcId: 123,
            description: 'Greek Yogurt',
            foodNutrients: [
              { nutrientName: 'Energy', value: 100 },
              { nutrientName: 'Protein', value: 17 },
              { nutrientName: 'Carbohydrate, by difference', value: 6 },
              { nutrientName: 'Total lipid (fat)', value: 0 },
            ],
          },
        ],
      }),
    })) as unknown as typeof fetch;

    const foods = await searchUsdaFoods('yogurt', 'api-key', fetcher);

    expect(foods).toHaveLength(1);
    expect(foods[0]).toMatchObject({
      id: '123',
      name: 'Greek Yogurt',
      calories: 100,
      protein: 17,
      carbs: 6,
      fat: 0,
      source: 'usda',
      fdc_id: '123',
    });
  });

  it('returns empty list when query is blank', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    const foods = await searchUsdaFoods('   ', 'api-key', fetcher);

    expect(foods).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns empty list when API key is missing', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    const foods = await searchUsdaFoods('rice', undefined, fetcher);

    expect(foods).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails gracefully when network request throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const foods = await searchUsdaFoods('oats', 'api-key', fetcher);

    expect(foods).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('rethrows a failed request only when the caller opts in', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('network down');
    const fetcher = vi.fn(async () => {
      throw failure;
    }) as unknown as typeof fetch;

    await expect(searchUsdaFoods('oats', 'api-key', fetcher, { rethrow: true })).rejects.toBe(failure);
    await expect(searchUsdaFoods('oats', 'api-key', fetcher, { rethrow: false })).resolves.toEqual([]);
    await expect(searchUsdaFoods('oats', 'api-key', fetcher)).resolves.toEqual([]);
    consoleErrorSpy.mockRestore();
  });

  it('still reports a successful search with no foods as an empty list when rethrowing', async () => {
    const fetcher = vi.fn(async () => ({ json: async () => ({ foods: [] }) })) as unknown as typeof fetch;

    await expect(searchUsdaFoods('zzzz', 'api-key', fetcher, { rethrow: true })).resolves.toEqual([]);
  });
});
