// Per-account lookup limits, the shared Open Food Facts limit and the barcode
// answer cache for food-lookup. Kept free of Deno and network imports so tests
// can run it (index.ts wires in the database).

export interface LookupStore {
  /** Counts one lookup for the account; false once its minute or day limit is spent. */
  claimLookup(userId: string): Promise<boolean>;
  /** Counts one Open Food Facts call for everyone; false once this minute's share is spent. */
  claimOpenFoodFacts(): Promise<boolean>;
  /** A cached answer that has not expired, or null. */
  cacheGet(key: string): Promise<unknown | null>;
  cachePut(key: string, payload: unknown, ttlSeconds: number): Promise<void>;
}

/** A product's answer barely changes in a day; an unknown barcode may be added sooner. */
export const CACHE_SECONDS = { found: 24 * 60 * 60, missing: 60 * 60 } as const;

export const LOOKUP_LIMITED = {
  code: 'lookup_limited',
  error: 'Too many food lookups for now. Wait a minute, or enter the food yourself.',
} as const;
export const PROVIDER_BUSY = {
  code: 'provider_busy',
  error: 'This food database is busy. Try again in a minute.',
} as const;

export type ProviderAnswer =
  /** A product, or the provider's clear "no such product": both cacheable. */
  | { kind: 'found' | 'missing'; payload: unknown }
  /** Anything else is answered once and never cached. */
  | { kind: 'error'; status: number; payload: unknown };

/**
 * The answer for one barcode from one provider: from the cache when it holds
 * one, otherwise fetched (after `beforeFetch`, which may refuse) and cached.
 * A cache that cannot be read or written is skipped, never fatal.
 */
export async function cachedBarcodeAnswer(
  store: LookupStore,
  key: string,
  fetchAnswer: () => Promise<ProviderAnswer>,
  beforeFetch: () => Promise<boolean> = async () => true,
): Promise<{ status: number; payload: unknown; cached: boolean }> {
  const hit = await store.cacheGet(key).catch(() => null);
  if (hit !== null && hit !== undefined) return { status: 200, payload: hit, cached: true };
  if (!await beforeFetch()) return { status: 429, payload: { ...PROVIDER_BUSY }, cached: false };
  const answer = await fetchAnswer();
  if (answer.kind === 'error') return { status: answer.status, payload: answer.payload, cached: false };
  await store.cachePut(key, answer.payload, CACHE_SECONDS[answer.kind]).catch(() => {});
  return { status: 200, payload: answer.payload, cached: false };
}
