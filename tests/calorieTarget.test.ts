import { describe, expect, it, vi } from 'vitest';

import { interpretFoodServing, resolveCaloriesLocally, servingNeedsAi } from '@/lib/foodTrial';
import {
  amountForCalories,
  amountForServings,
  equivalentWeightLabel,
  servingsForCalories,
  servingsForAmount,
} from '@/lib/foodUnits';

const trailMix = {
  name: 'Trail Mix',
  calories: 160,
  serving_size: 30,
  serving_unit: 'g',
  serving_label: '1/4 cup',
};

const water = {
  name: 'Sparkling Water',
  calories: 0,
  serving_size: 355,
  serving_unit: 'ml',
};

const scoop = {
  name: 'Whey Protein',
  calories: 120,
  serving_size: 1,
  serving_unit: 'scoop',
};

describe('calorie target helpers', () => {
  it('computes servings from a target calorie number', () => {
    expect(servingsForCalories(trailMix, '500')).toBeCloseTo(3.125, 6);
    expect(servingsForCalories(trailMix, '1,200')).toBeCloseTo(7.5, 6);
    expect(servingsForCalories(trailMix, '80.5')).toBeCloseTo(80.5 / 160, 6);
    expect(servingsForCalories(trailMix, '80,5')).toBeCloseTo(80.5 / 160, 6);
  });

  it('rejects zero-calorie foods, invalid numbers, and extreme targets', () => {
    expect(servingsForCalories(water, '500')).toBeNull();
    expect(servingsForCalories(trailMix, '')).toBeNull();
    expect(servingsForCalories(trailMix, '0')).toBeNull();
    expect(servingsForCalories(trailMix, '-100')).toBeNull();
    expect(servingsForCalories(trailMix, 'abc')).toBeNull();
    expect(servingsForCalories(trailMix, '200000')).toBeNull();
  });

  it('formats the matching amount in servings or physical units', () => {
    expect(amountForCalories(trailMix, '500', 'serving')).toBe('3.13');
    const grams = amountForCalories(trailMix, '500', 'g');
    expect(grams).toBe('94');
    // Round-tripping the displayed gram amount saves the exact same hundredths of a serving (3.13).
    const roundTripServings = servingsForAmount(trailMix, grams!, 'g');
    expect(Math.round(roundTripServings! * 100)).toBe(313);
    expect(amountForCalories(trailMix, '500', 'oz')).toBe('3.31');
    expect(amountForCalories(trailMix, '500', 'ml')).toBeNull();
    expect(amountForCalories(water, '500', 'ml')).toBeNull();
  });

  it('converts servings into the currently selected unit', () => {
    expect(amountForServings(trailMix, 3.13, 'g')).toBe('94');
    expect(amountForServings(trailMix, 3.13, 'serving')).toBe('3.13');
    expect(amountForServings(trailMix, 0, 'g')).toBeNull();
  });

  it('shows equivalent physical weight only when Amount is in servings and adds new info', () => {
    expect(equivalentWeightLabel(trailMix, 3.13, 'serving')).toBe('93.9 g');
    expect(equivalentWeightLabel(trailMix, 3.13, 'g')).toBeNull();
    expect(equivalentWeightLabel({ serving_size: 1, serving_unit: 'serving' }, 2, 'serving')).toBeNull();
    expect(equivalentWeightLabel(scoop, 2, 'serving')).toBeNull();
    expect(equivalentWeightLabel(trailMix, null, 'serving')).toBeNull();
  });
});

describe('helper-line calorie target parsing', () => {
  it('resolves cal, kcal, and calories locally without AI', () => {
    for (const input of ['500 cal', '500 kcal', '500 calories', '500cal', 'about 500 cal', 'I ate 500 kcal.']) {
      expect(servingNeedsAi(trailMix, input)).toBe(false);
      expect(resolveCaloriesLocally(trailMix, input)).toEqual({
        status: 'resolved',
        quantity: 500,
        optionId: 'calories',
        servings: 3.125,
        unit: 'kcal',
        basisQuantity: 160,
      });
    }
    expect(resolveCaloriesLocally(trailMix, '1,200 cals')).toEqual({
      status: 'resolved',
      quantity: 1200,
      optionId: 'calories',
      servings: 7.5,
      unit: 'kcal',
      basisQuantity: 160,
    });
  });

  it('returns clarification for zero-calorie foods, zero targets, or oversized targets', () => {
    expect(servingNeedsAi(water, '500 cal')).toBe(false);
    expect(resolveCaloriesLocally(water, '500 cal')?.status).toBe('clarification');
    expect(resolveCaloriesLocally(trailMix, '0 cal')?.status).toBe('clarification');
    expect(resolveCaloriesLocally(trailMix, '500000 kcal')?.status).toBe('clarification');
  });

  it('leaves non-calorie and compound inputs to the existing serving resolver', () => {
    expect(resolveCaloriesLocally(trailMix, '250 g')).toBeNull();
    expect(resolveCaloriesLocally(trailMix, '6 pieces')).toBeNull();
    expect(resolveCaloriesLocally(trailMix, '500 cal and 1 cup')).toBeNull();
  });

  it('interprets calorie targets offline without calling fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const result = await interpretFoodServing(trailMix, '500 cal', 'unused-token');
      expect(result).toEqual({
        status: 'resolved',
        quantity: 500,
        optionId: 'calories',
        servings: 3.125,
        unit: 'kcal',
        basisQuantity: 160,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
