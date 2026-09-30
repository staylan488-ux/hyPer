import { describe, expect, it, vi } from 'vitest';
import { resolveBarcodeByPriority } from '@/lib/barcodePriority';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('barcode provider priority', () => {
  it('prefers FatSecret even when it answers last', async () => {
    const fatsecret = deferred<string | null>();
    const usda = deferred<string | null>();
    const off = deferred<string | null>();

    const result = resolveBarcodeByPriority([
      ['fatsecret', () => fatsecret.promise],
      ['usda', () => usda.promise],
      ['open_food_facts', () => off.promise],
    ]);
    off.resolve('OFF product');
    usda.resolve('USDA product');
    await flush();
    fatsecret.resolve('FatSecret product');

    await expect(result).resolves.toEqual({ provider: 'fatsecret', value: 'FatSecret product' });
  });

  it('falls through a FatSecret miss and a USDA error to Open Food Facts', async () => {
    const result = await resolveBarcodeByPriority([
      ['fatsecret', () => Promise.resolve(null)],
      ['usda', () => Promise.reject(new Error('edge down'))],
      ['open_food_facts', () => Promise.resolve('OFF product')],
    ]);

    expect(result).toEqual({ provider: 'open_food_facts', value: 'OFF product' });
  });

  it('returns null when every leg misses or fails, so the miss path runs', async () => {
    const result = await resolveBarcodeByPriority([
      ['fatsecret', () => Promise.reject(new Error('not configured'))],
      ['usda', () => Promise.resolve(null)],
      ['open_food_facts', () => { throw new Error('sync failure'); }],
    ]);

    expect(result).toBeNull();
  });

  it('does not leak a lower-priority rejection while a higher leg is pending', async () => {
    const fatsecret = deferred<string | null>();
    const usda = deferred<string | null>();

    const result = resolveBarcodeByPriority([
      ['fatsecret', () => fatsecret.promise],
      ['usda', () => usda.promise],
      ['open_food_facts', () => Promise.reject(new Error('offline'))],
    ]);
    usda.reject(new Error('timeout'));
    // give an unattached rejection time to be reported before the winner lands
    await flush();
    fatsecret.resolve('FatSecret product');

    await expect(result).resolves.toEqual({ provider: 'fatsecret', value: 'FatSecret product' });
  });

  it('starts every leg before any of them settles', async () => {
    const legs = [deferred<string | null>(), deferred<string | null>(), deferred<string | null>()];
    const runs = legs.map((leg) => vi.fn(() => leg.promise));

    const result = resolveBarcodeByPriority([
      ['fatsecret', runs[0]],
      ['usda', runs[1]],
      ['open_food_facts', runs[2]],
    ]);

    runs.forEach((run) => expect(run).toHaveBeenCalledOnce());
    legs.forEach((leg) => leg.resolve(null));
    await expect(result).resolves.toBeNull();
  });
});
