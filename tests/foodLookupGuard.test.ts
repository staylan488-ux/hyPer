import { describe, expect, it, vi } from 'vitest';
import { CACHE_SECONDS, cachedBarcodeAnswer, type LookupStore } from '../supabase/functions/food-lookup/guard';

function memoryStore(): LookupStore & { cache: Map<string, { payload: unknown; ttl: number }> } {
  const cache = new Map<string, { payload: unknown; ttl: number }>();
  return {
    cache,
    claimLookup: vi.fn(async () => true),
    claimOpenFoodFacts: vi.fn(async () => true),
    cacheGet: vi.fn(async key => cache.get(key)?.payload ?? null),
    cachePut: vi.fn(async (key, payload, ttl) => { cache.set(key, { payload, ttl }); }),
  };
}

describe('barcode answers', () => {
  it('fetches a product once and answers later lookups from the cache', async () => {
    const store = memoryStore();
    const fetchAnswer = vi.fn(async () => ({ kind: 'found' as const, payload: { product: 'oats' } }));
    expect(await cachedBarcodeAnswer(store, 'off:123', fetchAnswer)).toEqual({ status: 200, payload: { product: 'oats' }, cached: false });
    expect(await cachedBarcodeAnswer(store, 'off:123', fetchAnswer)).toEqual({ status: 200, payload: { product: 'oats' }, cached: true });
    expect(fetchAnswer).toHaveBeenCalledOnce();
    expect(store.cache.get('off:123')?.ttl).toBe(CACHE_SECONDS.found);
  });

  it('keeps an unknown barcode for a shorter time, and never caches an error', async () => {
    const store = memoryStore();
    await cachedBarcodeAnswer(store, 'off:404', async () => ({ kind: 'missing', payload: { status: 0 } }));
    expect(store.cache.get('off:404')?.ttl).toBe(CACHE_SECONDS.missing);
    const failed = await cachedBarcodeAnswer(store, 'off:500', async () => ({ kind: 'error', status: 502, payload: { error: 'down' } }));
    expect(failed).toEqual({ status: 502, payload: { error: 'down' }, cached: false });
    expect(store.cache.has('off:500')).toBe(false);
  });

  it('refuses before calling the provider when its shared limit is spent, but still serves the cache', async () => {
    const store = memoryStore();
    store.cache.set('off:123', { payload: { product: 'oats' }, ttl: 1 });
    const fetchAnswer = vi.fn(async () => ({ kind: 'found' as const, payload: {} }));
    const busy = async () => false;
    expect(await cachedBarcodeAnswer(store, 'off:123', fetchAnswer, busy)).toMatchObject({ status: 200, cached: true });
    expect(await cachedBarcodeAnswer(store, 'off:999', fetchAnswer, busy)).toMatchObject({ status: 429, payload: { code: 'provider_busy' } });
    expect(fetchAnswer).not.toHaveBeenCalled();
  });

  it('carries on without the cache when it cannot be read or written', async () => {
    const store = memoryStore();
    store.cacheGet = vi.fn(async () => { throw new Error('db down'); });
    store.cachePut = vi.fn(async () => { throw new Error('db down'); });
    expect(await cachedBarcodeAnswer(store, 'off:1', async () => ({ kind: 'found', payload: { ok: true } }))).toMatchObject({ status: 200, payload: { ok: true } });
  });
});
