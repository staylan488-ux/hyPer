import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn<(name: string, options: { body: Record<string, string> }) => Promise<{ data: unknown; error: unknown }>>(async () => ({ data: null, error: null })),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { refillDeviceFoods, refillDeviceFoodsFor, resetDeviceFoodRefillForTest, resolveDeviceFoods } from '@/lib/deviceFoodRefill';
import { deviceFoodStub, forgetDeviceFoodsForTest, isDeviceFoodStub, readDeviceFood } from '@/lib/deviceFoods';
import { FATSECRET_FOODS_PER_REQUEST, fetchFatSecretFoodsSecure, searchFatSecretFoodsSecure } from '@/lib/usdaClient';

const fsFood = (foodId: string, servingIds: string[]) => ({
  food_id: foodId, food_name: `Food ${foodId}`, brand_name: 'Brand', food_type: 'Brand',
  servings: { serving: servingIds.map((id) => ({ serving_id: id, serving_description: '1 bar', metric_serving_amount: '45', metric_serving_unit: 'g', calories: '200', carbohydrate: '20', protein: '15', fat: '7' })) },
});
const answer = (data: unknown) => ({ data, error: null });

beforeEach(() => {
  vi.useRealTimers();
  mocks.invoke.mockReset();
  forgetDeviceFoodsForTest();
  resetDeviceFoodRefillForTest();
  vi.stubGlobal('localStorage', undefined);
});

describe('asking FatSecret through food-lookup', () => {
  it('says the phone keeps the details, on every FatSecret request', async () => {
    mocks.invoke.mockResolvedValue(answer({ configured: true, foods: [] }));
    await searchFatSecretFoodsSecure('chobani');
    await fetchFatSecretFoodsSecure(['fatsecret:1:2']);
    expect(mocks.invoke.mock.calls.map((call) => call[1].body)).toEqual([
      { action: 'fatsecret-search', query: 'chobani', keeps: 'device' },
      { action: 'fatsecret-foods', ids: '1', keeps: 'device' },
    ]);
  });

  it('has no brand results when FatSecret is switched off', async () => {
    mocks.invoke.mockResolvedValue(answer({ configured: false }));
    expect(await searchFatSecretFoodsSecure('chobani')).toBeNull();
    expect(await fetchFatSecretFoodsSecure(['fatsecret:1:2'])).toEqual({ configured: false });
  });

  it('asks for each food once, and sorts the answer by key: read, gone, or neither', async () => {
    mocks.invoke.mockResolvedValue(answer({ configured: true, foods: [fsFood('1', ['2', '3'])], missing: ['5'] }));
    const result = await fetchFatSecretFoodsSecure(['fatsecret:1:2', 'fatsecret:1:3', 'fatsecret:1:4', 'fatsecret:5:6', 'fatsecret:7:8', 'not-a-key']);
    expect(mocks.invoke.mock.calls[0][1].body.ids).toBe('1,5,7');
    if (!result.configured) throw new Error('expected an answer');
    expect([...result.foods.keys()]).toEqual(['fatsecret:1:2', 'fatsecret:1:3']);
    expect(result.foods.get('fatsecret:1:3')).toMatchObject({ name: 'Food 1 · Brand', calories: 200, external_id: '1:3' });
    // a serving FatSecret dropped and a food it no longer has are gone; food 7 simply did not come back
    expect(result.gone).toEqual(['fatsecret:1:4', 'fatsecret:5:6']);
  });

  it('throws when the lookup fails, so a failure is never read as "gone"', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { name: 'FunctionsHttpError', message: 'bad gateway', context: { status: 502 } } });
    await expect(fetchFatSecretFoodsSecure(['fatsecret:1:2'])).rejects.toMatchObject({ reason: 'unavailable' });
  });
});

describe('filling in what the phone does not hold', () => {
  const stub = (externalId: string) => ({ id: `row-${externalId}`, ...deviceFoodStub(externalId) });

  it('asks in batches, keeps what comes back, and asks nothing for foods already held', async () => {
    mocks.invoke.mockImplementation(async (_name, options) => answer({
      configured: true, foods: options.body.ids.split(',').map((id) => fsFood(id, ['1'])), missing: [],
    }));
    const keys = Array.from({ length: FATSECRET_FOODS_PER_REQUEST + 5 }, (_, index) => `fatsecret:${index + 1}:1`);
    expect(await refillDeviceFoods(keys)).toEqual({ incomplete: false });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(readDeviceFood('fatsecret:25:1')?.name).toBe('Food 25 · Brand');
    expect(await refillDeviceFoods(keys)).toEqual({ incomplete: false });
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('shares one request between reads that want the same food at once', async () => {
    mocks.invoke.mockResolvedValue(answer({ configured: true, foods: [fsFood('1', ['2'])] }));
    const [first, second] = await Promise.all([resolveDeviceFoods([stub('1:2')]), resolveDeviceFoods([stub('1:2')])]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    expect(first.foods[0]).toMatchObject({ id: 'row-1:2', name: 'Food 1 · Brand', calories: 200 });
    expect(second.foods[0].name).toBe('Food 1 · Brand');
  });

  it('goes on without a slow answer, and has it for the next read', async () => {
    vi.useFakeTimers();
    let respond!: (value: { data: unknown; error: null }) => void;
    mocks.invoke.mockReturnValue(new Promise((resolve) => { respond = resolve; }));
    const reading = resolveDeviceFoods([stub('1:2')], 6_000);
    await vi.advanceTimersByTimeAsync(6_000);
    const slow = await reading;
    expect(slow.incomplete).toBe(true);
    expect(isDeviceFoodStub(slow.foods[0])).toBe(true);

    respond(answer({ configured: true, foods: [fsFood('1', ['2'])] }));
    await vi.advanceTimersByTimeAsync(0);
    expect(await resolveDeviceFoods([stub('1:2')])).toMatchObject({ incomplete: false, foods: [{ name: 'Food 1 · Brand' }] });
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it('tries a failed food again after a minute, not before', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValueOnce({ data: null, error: { name: 'FunctionsFetchError', message: 'offline' } });
    expect((await refillDeviceFoods(['fatsecret:1:2'])).incomplete).toBe(true);
    expect((await refillDeviceFoods(['fatsecret:1:2'])).incomplete).toBe(true);
    expect(mocks.invoke).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(60_000);
    mocks.invoke.mockResolvedValue(answer({ configured: true, foods: [fsFood('1', ['2'])] }));
    expect((await refillDeviceFoods(['fatsecret:1:2'])).incomplete).toBe(false);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('asks nothing for ten minutes once FatSecret says it is off, and calls the read complete', async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(answer({ configured: false }));
    expect(await refillDeviceFoods(['fatsecret:1:2'])).toEqual({ incomplete: false });
    expect(await refillDeviceFoods(['fatsecret:3:4'])).toEqual({ incomplete: false });
    expect(mocks.invoke).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await refillDeviceFoods(['fatsecret:3:4']);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('starts a refill for a list without holding the list up', async () => {
    mocks.invoke.mockResolvedValue(answer({ configured: true, foods: [fsFood('1', ['2'])] }));
    refillDeviceFoodsFor([stub('1:2'), { name: 'Oats', source: 'usda' }]);
    expect(mocks.invoke).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(readDeviceFood('fatsecret:1:2')?.calories).toBe(200));
  });

  it('asks nothing when no brand food is missing', async () => {
    expect(await resolveDeviceFoods([{ name: 'Oats', source: 'usda' }])).toEqual({ foods: [{ name: 'Oats', source: 'usda' }], incomplete: false });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
