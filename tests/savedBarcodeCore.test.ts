import { describe, expect, it } from 'vitest';

import {
  PERSONAL_BARCODE_SOURCE,
  mapSavedBarcodeFood,
  pickSavedBarcodeFood,
  type SavedBarcodeFoodRow,
} from '@/lib/savedBarcodeCore';

function row(overrides: Partial<SavedBarcodeFoodRow>): SavedBarcodeFoodRow {
  return {
    id: 'food-1',
    user_id: 'user-1',
    name: 'Peanut butter',
    calories: 190,
    protein: 8,
    carbs: 7,
    fat: 16,
    serving_size: 32,
    serving_unit: 'g',
    source: 'saved_meal',
    fdc_id: null,
    external_source: PERSONAL_BARCODE_SOURCE,
    external_id: '0123456789012',
    ...overrides,
  };
}

describe('saved barcode catalog selection', () => {
  it('returns null for an empty catalog', () => {
    expect(pickSavedBarcodeFood([])).toBeNull();
  });

  it('prefers the owner-created product over a cached provider record', () => {
    const providerRow = row({ id: 'off-1', external_source: 'open_food_facts' });
    const personalRow = row({ id: 'mine-1', external_source: PERSONAL_BARCODE_SOURCE });
    expect(pickSavedBarcodeFood([providerRow, personalRow])?.id).toBe('mine-1');
  });

  it('falls back to the most recent provider record when no personal product exists', () => {
    const newest = row({ id: 'off-newest', external_source: 'open_food_facts' });
    const older = row({ id: 'off-older', external_source: 'open_food_facts' });
    expect(pickSavedBarcodeFood([newest, older])?.id).toBe('off-newest');
  });
});

describe('saved barcode food mapping', () => {
  it('maps numeric strings and fills safe defaults', () => {
    const mapped = mapSavedBarcodeFood(row({
      calories: '190.0',
      protein: '8.0',
      serving_size: null,
      serving_unit: null,
      name: null,
    }));
    expect(mapped).toMatchObject({
      name: 'Saved product',
      calories: 190,
      protein: 8,
      serving_size: 1,
      serving_unit: 'serving',
      source: 'custom',
      external_id: '0123456789012',
    });
  });
});
