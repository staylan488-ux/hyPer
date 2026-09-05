import { describe, expect, it } from 'vitest';
import { buildClarifiedMealHint, isValidTrialReview } from '@/components/nutrition/foodTrialReview';
import type { TrialFoodItem } from '@/lib/foodTrial';

const label: TrialFoodItem = { name: 'Samosas', quantity: 6, unit: 'piece', basisQuantity: 3, calories: 200, protein: 8, carbs: 20, fat: 10, evidence: 'label', notes: 'Label per three pieces', sourceIndexes: [], amountConfirmed: false };

describe('Gemini meal review validation', () => {
  it('allows a reviewed label amount without an extra confirmation checkbox', () => {
    expect(isValidTrialReview([label])).toBe(true);
    expect(isValidTrialReview([{ ...label, amountConfirmed: true }])).toBe(true);
  });
  it('allows estimates to be reviewed without claiming a measured portion', () => {
    expect(isValidTrialReview([{ ...label, evidence: 'estimate' }])).toBe(true);
  });
  it('prevents empty or incomplete analyses from saving', () => {
    expect(isValidTrialReview([])).toBe(false);
    for (const patch of [{ name: ' ' }, { unit: '' }, { quantity: 0 }, { basisQuantity: 0 }, { calories: -1 }, { protein: NaN }, { fat: Infinity }]) {
      expect(isValidTrialReview([{ ...label, amountConfirmed: true, ...patch }])).toBe(false);
    }
  });
  it('supports mixed label and photo estimates without redundant confirmations', () => {
    expect(isValidTrialReview([label, { ...label, evidence: 'estimate' }])).toBe(true);
  });
  it('prevents multiple foods from overwriting the same past entry', () => {
    const confirmed = { ...label, amountConfirmed: true };
    expect(isValidTrialReview([confirmed, confirmed], true)).toBe(false);
    expect(isValidTrialReview([confirmed], true)).toBe(true);
    expect(isValidTrialReview([confirmed, confirmed])).toBe(true);
  });
  it('rejects finite inputs whose portion arithmetic overflows', () => {
    expect(isValidTrialReview([{ ...label, amountConfirmed: true, quantity: Number.MAX_VALUE, calories: Number.MAX_VALUE }])).toBe(false);
  });
});

describe('one-detail meal clarification', () => {
  it('preserves the meal and question when adding the user’s answer', () => {
    expect(buildClarifiedMealHint('Chicken samosas', 'How many pieces?', 'Six')).toBe('Chicken samosas\nQuestion: How many pieces?\nAnswer: Six');
  });
  it('allows a new label photo to answer the clarification', () => {
    expect(buildClarifiedMealHint('Six samosas', 'Which package size?', '')).toContain('Photo selection updated for clarification.');
  });
  it('does not silently truncate a material amount or earlier detail at the request limit', () => {
    expect(() => buildClarifiedMealHint('x'.repeat(1490), 'How much?', 'Six pieces')).toThrow('too long');
  });
});
