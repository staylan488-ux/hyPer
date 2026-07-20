import { describe, expect, it } from 'vitest';

import {
  WorkerBusyError,
  createJobGate,
  createTTLCache,
  normalizeIdempotencyKey,
  parseCSVSet,
  userIsAllowed,
} from '../scripts/photo-food-worker-core.mjs';

describe('photo worker safety boundaries', () => {
  it('requires an explicit matching user in production mode', () => {
    const allowlist = parseCSVSet('user-1, user-2');
    expect(userIsAllowed('user-1', allowlist, true)).toBe(true);
    expect(userIsAllowed('user-3', allowlist, true)).toBe(false);
    expect(userIsAllowed('user-1', new Set(), true)).toBe(false);
    expect(userIsAllowed('user-1', new Set(), false)).toBe(true);
  });

  it('accepts bounded idempotency keys only', () => {
    expect(normalizeIdempotencyKey('photo:user-1:1234')).toBe('photo:user-1:1234');
    expect(normalizeIdempotencyKey('short')).toBeNull();
    expect(normalizeIdempotencyKey('bad key with spaces')).toBeNull();
  });

  it('limits active and queued inference jobs', async () => {
    const gate = createJobGate({ maxConcurrent: 1, maxQueued: 1 });
    const releaseFirst = await gate.acquire();
    const second = gate.acquire();
    await expect(gate.acquire()).rejects.toBeInstanceOf(WorkerBusyError);
    expect(gate.stats()).toMatchObject({ active: 1, queued: 1 });
    releaseFirst();
    const releaseSecond = await second;
    expect(gate.stats()).toMatchObject({ active: 1, queued: 0 });
    releaseSecond();
  });

  it('falls back safely when queue environment values are invalid', () => {
    const gate = createJobGate({ maxConcurrent: Number.NaN, maxQueued: Number.NaN });
    expect(gate.stats()).toMatchObject({ maxConcurrent: 1, maxQueued: 4 });
  });

  it('expires cached idempotent results', () => {
    const cache = createTTLCache({ ttlMs: 1_000, maxEntries: 2 });
    cache.set('job', { ok: true }, 1_000);
    expect(cache.get('job', 1_500)).toEqual({ ok: true });
    expect(cache.get('job', 2_001)).toBeUndefined();
  });
});
