import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ functions: { invoke: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));

import { FoodLookupError, foodLookupFailure, searchUsdaFoodsSecure, searchUsdaFoodsSecureStrict } from '@/lib/usdaClient';

// What supabase-js hands back for each way a function call can fail.
const noAnswer = { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Network request failed') };
const answered = (status: number) => ({ name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status } });

async function failure(error: unknown) {
  supabaseMock.functions.invoke.mockResolvedValue({ data: null, error });
  return foodLookupFailure(await searchUsdaFoodsSecureStrict('kiwi').catch((thrown: unknown) => thrown));
}

describe('why a food search failed', () => {
  beforeEach(() => {
    supabaseMock.functions.invoke.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('blames the connection only when the request got no answer', async () => {
    expect(await failure(noAnswer)).toBe('offline');
  });

  it('says the food database failed when hyPer answered with an error', async () => {
    // 502 is the function's answer when USDA itself fails: the phone's connection is fine.
    expect(await failure(answered(502))).toBe('unavailable');
    expect(await failure(answered(503))).toBe('unavailable');
    expect(await failure({ name: 'FunctionsRelayError', message: 'Relay Error invoking the Edge Function' })).toBe('unavailable');
  });

  it('says so when the account has searched too often', async () => {
    expect(await failure(answered(429))).toBe('limited');
  });

  it('throws an error that carries the reason', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: answered(502) });
    const thrown = await searchUsdaFoodsSecureStrict('kiwi').catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(FoodLookupError);
    expect((thrown as FoodLookupError).reason).toBe('unavailable');
  });

  it('treats an error from anywhere else as no answer', () => {
    expect(foodLookupFailure(new Error('offline'))).toBe('offline');
  });

  it('still answers the photo flow with no foods rather than throwing', async () => {
    supabaseMock.functions.invoke.mockResolvedValue({ data: null, error: answered(502) });
    await expect(searchUsdaFoodsSecure('kiwi')).resolves.toEqual([]);
  });
});
