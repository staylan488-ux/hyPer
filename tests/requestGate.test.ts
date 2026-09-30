import { describe, expect, it } from 'vitest';
import { createRequestGate, type RequestGate } from '@/lib/requestGate';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

type Outcome = 'stale' | { miss: string } | { hit: string };

// Mirrors how FoodLogger gates a barcode lookup: check after every await and
// apply nothing once a newer lookup (or a tab change) superseded this one.
async function lookup(gate: RequestGate, barcode: string, source: Promise<string | null>): Promise<Outcome> {
  const isCurrent = gate.begin();
  const food = await source;
  if (!isCurrent()) return 'stale';
  return food ? { hit: food } : { miss: barcode };
}

describe('latest-request gate', () => {
  it('lets a single lookup that hits return its food', async () => {
    const gate = createRequestGate();
    await expect(lookup(gate, 'A', Promise.resolve('Oats'))).resolves.toEqual({ hit: 'Oats' });
  });

  it('lets a single miss reach the miss path', async () => {
    const gate = createRequestGate();
    await expect(lookup(gate, 'A', Promise.resolve(null))).resolves.toEqual({ miss: 'A' });
  });

  it('marks an older overlapping lookup stale on the hit path when it resolves last', async () => {
    const gate = createRequestGate();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();

    const older = lookup(gate, 'A', slow.promise);
    const newer = lookup(gate, 'B', fast.promise);
    fast.resolve('Yogurt');
    await expect(newer).resolves.toEqual({ hit: 'Yogurt' });
    slow.resolve('Granola');
    await expect(older).resolves.toBe('stale');
  });

  it('marks an older overlapping lookup stale on the miss path when it resolves last', async () => {
    const gate = createRequestGate();
    const slow = deferred<string | null>();
    const fast = deferred<string | null>();

    const older = lookup(gate, 'A', slow.promise);
    const newer = lookup(gate, 'B', fast.promise);
    fast.resolve(null);
    await expect(newer).resolves.toEqual({ miss: 'B' });
    slow.resolve(null);
    await expect(older).resolves.toBe('stale');
  });

  it('makes an in-flight lookup stale when the gate is invalidated (tab change)', async () => {
    const gate = createRequestGate();
    const pending = deferred<string | null>();

    const inFlight = lookup(gate, 'A', pending.promise);
    gate.invalidate();
    pending.resolve('Oats');
    await expect(inFlight).resolves.toBe('stale');
  });

  it('keeps a lookup current when nothing newer began', async () => {
    const gate = createRequestGate();
    const isCurrent = gate.begin();
    expect(isCurrent()).toBe(true);
    expect(isCurrent()).toBe(true);
  });
});
