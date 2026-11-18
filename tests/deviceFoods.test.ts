import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_ONLY_FOOD_NAME,
  deviceFoodIds,
  deviceFoodKey,
  deviceFoodStub,
  forgetDeviceFoodsForTest,
  isDeviceFoodStub,
  keepDeviceFood,
  readDeviceFood,
  withDeviceFood,
} from '@/lib/deviceFoods';

const yogurt = {
  id: 'row-1', user_id: 'u1', name: 'Greek Yogurt · Chobani', calories: 120, protein: 16, carbs: 6, fat: 3,
  serving_size: 150, serving_unit: 'g', serving_label: '1 container',
  source: 'fatsecret' as const, fdc_id: null, external_source: 'fatsecret', external_id: '4411:5522',
};
const details = { name: yogurt.name, calories: 120, protein: 16, carbs: 6, fat: 3, serving_size: 150, serving_unit: 'g', serving_label: '1 container' };
const stubRow = { id: 'row-1', user_id: 'u1', ...deviceFoodStub('4411:5522') };

let stored: Map<string, string>;
beforeEach(() => {
  forgetDeviceFoodsForTest();
  stored = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
  });
});

describe('which foods stay on the phone', () => {
  it('is a FatSecret food named by its food and serving IDs', () => {
    expect(deviceFoodKey(yogurt)).toBe('fatsecret:4411:5522');
    expect(deviceFoodKey({ source: 'fatsecret', external_id: '4411:5522' })).toBe('fatsecret:4411:5522');
    expect(deviceFoodIds('fatsecret:4411:5522')).toEqual({ foodId: '4411', servingId: '5522' });
  });

  it('is no other food, and no FatSecret food without both IDs', () => {
    expect(deviceFoodKey({ source: 'usda', external_id: '4411:5522' })).toBeNull();
    expect(deviceFoodKey({ source: 'open_food_facts', external_source: 'open_food_facts', external_id: '0123456789012' })).toBeNull();
    // a saved meal bound to a barcode keeps its own source
    expect(deviceFoodKey({ source: 'fatsecret', external_source: 'barcode', external_id: '0123456789012' })).toBeNull();
    expect(deviceFoodKey({ source: 'fatsecret', external_source: 'fatsecret', external_id: '4411' })).toBeNull();
    expect(deviceFoodKey({ source: 'fatsecret', external_source: 'fatsecret', external_id: null })).toBeNull();
    expect(deviceFoodIds('fatsecret:4411')).toBeNull();
  });
});

describe("the phone's copy", () => {
  it('keeps a food under its IDs, in the phone storage, and reads it back', () => {
    expect(keepDeviceFood(yogurt)).toBe(true);
    expect(readDeviceFood('fatsecret:4411:5522')).toEqual(details);
    expect(JSON.parse(stored.get('hyper:device-food:fatsecret:4411:5522') ?? '')).toEqual(details);
    // a later launch reads the storage, not this session's memory
    forgetDeviceFoodsForTest();
    expect(readDeviceFood('fatsecret:4411:5522')).toEqual(details);
  });

  it('never keeps a stub over the real details', () => {
    keepDeviceFood(yogurt);
    expect(keepDeviceFood(stubRow)).toBe(false);
    expect(readDeviceFood('fatsecret:4411:5522')).toEqual(details);
  });

  it('keeps nothing that is not a whole food', () => {
    expect(keepDeviceFood({ ...yogurt, calories: Number.NaN })).toBe(false);
    expect(keepDeviceFood({ ...yogurt, name: ' ' })).toBe(false);
    expect(keepDeviceFood({ ...yogurt, serving_size: 0 })).toBe(false);
    expect(keepDeviceFood({ ...yogurt, source: 'usda' as const, external_source: undefined })).toBe(false);
    expect(readDeviceFood('fatsecret:4411:5522')).toBeNull();
    stored.set('hyper:device-food:fatsecret:1:2', '{not json');
    expect(readDeviceFood('fatsecret:1:2')).toBeNull();
  });

  it('still holds a food for the session when the phone storage is missing or refuses', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('locked'); }, setItem: () => { throw new Error('full'); } });
    expect(keepDeviceFood(yogurt)).toBe(true);
    expect(readDeviceFood('fatsecret:4411:5522')).toEqual(details);
  });
});

describe('what the server keeps, and what a screen sees', () => {
  it('keeps only the IDs on the server', () => {
    expect(deviceFoodStub('4411:5522')).toEqual({
      name: DEVICE_ONLY_FOOD_NAME, calories: 0, protein: 0, carbs: 0, fat: 0, serving_size: 1, serving_unit: 'serving',
      source: 'fatsecret', fdc_id: null, external_source: 'fatsecret', external_id: '4411:5522',
    });
    expect(isDeviceFoodStub(stubRow)).toBe(true);
    expect(isDeviceFoodStub(yogurt)).toBe(false);
    expect(isDeviceFoodStub({ name: DEVICE_ONLY_FOOD_NAME, source: 'manual_entry' })).toBe(false);
  });

  it("fills a stub in from the phone, keeping the row's own id", () => {
    keepDeviceFood(yogurt);
    expect(withDeviceFood(stubRow)).toEqual({ ...stubRow, ...details });
  });

  it('leaves a stub the phone knows nothing about as it is', () => {
    expect(withDeviceFood(stubRow)).toBe(stubRow);
    expect(isDeviceFoodStub(withDeviceFood(stubRow))).toBe(true);
  });

  it('hands a row saved in full by an older build to the phone', () => {
    const legacy = { ...yogurt, serving_label: undefined };
    expect(withDeviceFood(legacy)).toBe(legacy);
    expect(readDeviceFood('fatsecret:4411:5522')).toEqual({ ...details, serving_label: undefined });
  });

  it('reads a row whose numbers arrive as text', () => {
    const legacy = { ...yogurt, calories: '120.0', protein: '16', carbs: '6', fat: '3', serving_size: '150' };
    withDeviceFood(legacy);
    expect(readDeviceFood('fatsecret:4411:5522')).toMatchObject({ calories: 120, protein: 16, serving_size: 150 });
  });

  it('does not touch any other food', () => {
    const egg = { id: 'e', name: 'Egg', source: 'usda', external_source: null, external_id: null };
    expect(withDeviceFood(egg)).toBe(egg);
    expect(stored.size).toBe(0);
  });
});
