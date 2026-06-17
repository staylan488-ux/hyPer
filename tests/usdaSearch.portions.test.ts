import { describe, expect, it, vi } from 'vitest';

import { applyPortion, fetchUsdaFoodDetail, selectPortionFromDetail } from '@/components/nutrition/usdaSearch';
import type { Food } from '@/types';

const baseFood: Food = {
  id: '123',
  user_id: null,
  name: 'Egg, whole, raw, fresh',
  calories: 143,
  protein: 12.6,
  carbs: 0.7,
  fat: 9.5,
  serving_size: 100,
  serving_unit: 'g',
  source: 'usda',
  fdc_id: '123',
};

describe('selectPortionFromDetail', () => {
  it('uses branded serving size and household serving text', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 40,
      servingSizeUnit: 'g',
      householdServingFullText: '1 PIECE',
      foodPortions: [],
    });

    expect(portion).toEqual({ size: 40, unit: 'g', label: '1 piece' });
  });

  it('falls back to "{size} {unit}" when there is no household text', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 30,
      servingSizeUnit: 'GRM',
    });

    expect(portion).toEqual({ size: 30, unit: 'g', label: '30 g' });
  });

  it('maps branded millilitre serving units to volume', () => {
    const portion = selectPortionFromDetail({
      dataType: 'Branded',
      servingSize: 240,
      servingSizeUnit: 'MLT',
      householdServingFullText: '1 cup',
    });

    expect(portion).toEqual({ size: 240, unit: 'ml', label: '1 cup' });
  });

  it('picks the primary food portion by sequence number', () => {
    const portion = selectPortionFromDetail({
      dataType: 'SR Legacy',
      foodPortions: [
        { gramWeight: 243, amount: 1, modifier: 'cup', sequenceNumber: 3 },
        { gramWeight: 50, amount: 1, modifier: 'large', sequenceNumber: 1 },
        { gramWeight: 44, amount: 1, modifier: 'medium', sequenceNumber: 2 },
      ],
    });

    expect(portion).toEqual({ size: 50, unit: 'g', label: '1 large' });
  });

  it('uses portionDescription when there is no modifier', () => {
    const portion = selectPortionFromDetail({
      dataType: 'SR Legacy',
      foodPortions: [{ gramWeight: 28, portionDescription: '1 slice', sequenceNumber: 1 }],
    });

    expect(portion).toEqual({ size: 28, unit: 'g', label: '1 slice' });
  });

  it('falls back to a gram-weight label when no descriptors exist', () => {
    const portion = selectPortionFromDetail({
      dataType: 'SR Legacy',
      foodPortions: [{ gramWeight: 28, sequenceNumber: 1 }],
    });

    expect(portion).toEqual({ size: 28, unit: 'g', label: '28 g' });
  });

  it('returns null when no usable portion exists', () => {
    expect(selectPortionFromDetail({ dataType: 'Foundation', foodPortions: [{ gramWeight: 0 }] })).toBeNull();
    expect(selectPortionFromDetail({ dataType: 'Branded', servingSize: 5, servingSizeUnit: 'IU' })).toBeNull();
    expect(selectPortionFromDetail({ dataType: 'Foundation' })).toBeNull();
    expect(selectPortionFromDetail(null)).toBeNull();
  });
});

describe('applyPortion', () => {
  it('rescales per-100g macros to the chosen portion', () => {
    const result = applyPortion(baseFood, { size: 50, unit: 'g', label: '1 large' });

    expect(result.serving_size).toBe(50);
    expect(result.serving_unit).toBe('g');
    expect(result.serving_label).toBe('1 large');
    expect(result.calories).toBeCloseTo(71.5, 5);
    expect(result.protein).toBeCloseTo(6.3, 5);
  });

  it('rounds serving_size to 2 decimals and macros to 1 decimal', () => {
    const result = applyPortion(baseFood, { size: 49.638, unit: 'g', label: '1 large' });

    expect(result.serving_size).toBe(49.64);
    expect(Number.isInteger(result.calories * 10)).toBe(true);
  });

  it('returns the food unchanged when there is no portion', () => {
    expect(applyPortion(baseFood, null)).toEqual(baseFood);
  });
});

describe('fetchUsdaFoodDetail', () => {
  it('fetches and returns the food detail JSON', async () => {
    const detail = {
      fdcId: 123,
      dataType: 'SR Legacy',
      foodPortions: [{ gramWeight: 50, amount: 1, modifier: 'large', sequenceNumber: 1 }],
    };
    const fetcher = vi.fn(async () => ({ json: async () => detail })) as unknown as typeof fetch;

    const result = await fetchUsdaFoodDetail('123', 'api-key', fetcher);

    expect(result).toEqual(detail);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/fdc/v1/food/123'));
  });

  it('returns null without an API key and does not call the network', async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;

    expect(await fetchUsdaFoodDetail('123', undefined, fetcher)).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('returns null and logs when the request throws', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    expect(await fetchUsdaFoodDetail('123', 'api-key', fetcher)).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
