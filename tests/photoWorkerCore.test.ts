import { describe, expect, it, vi } from 'vitest';

import { WorkerBusyError, createInflightJobs, createJobGate, createProviderHealth, createTTLCache, isCredentialFailure, normalizeIdempotencyKey, parseCSVSet, runGatedJob, userIsAllowed } from '../scripts/photo-food-worker-core.mjs';

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

describe('isCredentialFailure', () => {
  it('recognises the expired-OAuth failure that broke Codex', () => {
    expect(isCredentialFailure(new Error(
      'codex exited with code 1: Your access token could not be refreshed. Please log out and sign in again.',
    ))).toBe(true);
  });

  it('recognises a bare 401', () => {
    expect(isCredentialFailure(new Error('HTTP error: 401 Unauthorized'))).toBe(true);
  });

  it('does NOT treat a timeout as a broken credential', () => {
    // setting a healthy provider aside over one slow call would take it dark
    expect(isCredentialFailure(new Error('codex timed out after 240 seconds.'))).toBe(false);
  });

  it('does not treat a schema or parse failure as a credential problem', () => {
    expect(isCredentialFailure(new Error('The model returned no food estimate.'))).toBe(false);
    expect(isCredentialFailure(new Error('Unexpected token < in JSON at position 0'))).toBe(false);
  });

  it('does not match 401 inside an unrelated number', () => {
    expect(isCredentialFailure(new Error('used 24016 tokens'))).toBe(false);
  });

  it('survives a non-Error value', () => {
    expect(isCredentialFailure(undefined)).toBe(false);
    expect(isCredentialFailure('401 unauthorized')).toBe(true);
  });
});

describe('createProviderHealth', () => {
  it('offers a provider until it is marked dead', () => {
    const health = createProviderHealth();
    expect(health.isDead('openai')).toBe(false);
    health.markDead('openai');
    expect(health.isDead('openai')).toBe(true);
  });

  it('sets aside only the provider that failed', () => {
    const health = createProviderHealth();
    health.markDead('openai');
    expect(health.isDead('anthropic')).toBe(false);
  });

  it('offers it again once the window passes', () => {
    let clock = 1_000;
    const health = createProviderHealth({ deadMs: 5_000, now: () => clock });
    health.markDead('openai');
    expect(health.isDead('openai')).toBe(true);
    clock += 4_999;
    expect(health.isDead('openai')).toBe(true);
    clock += 2;
    expect(health.isDead('openai')).toBe(false);
    expect(health.deadProviders()).toEqual([]);
  });

  it('re-marking extends the window from now', () => {
    let clock = 0;
    const health = createProviderHealth({ deadMs: 1_000, now: () => clock });
    health.markDead('openai');
    clock += 900;
    health.markDead('openai');
    clock += 200;
    expect(health.isDead('openai')).toBe(true);
  });
});

describe('createInflightJobs', () => {
  it('runs a computation and returns its result', async () => {
    const jobs = createInflightJobs();
    await expect(jobs.run('k', async () => 'answer')).resolves.toBe('answer');
  });

  it('attaches a concurrent identical request to the running job', async () => {
    // the retry-after-timeout case: the second request must NOT start a second
    // model run - it waits for the first and gets the same result object
    const jobs = createInflightJobs();
    let runs = 0;
    let release!: (value: string) => void;
    const gate = new Promise<string>((resolve) => { release = resolve; });

    const first = jobs.run('k', async () => { runs += 1; return gate; });
    const second = jobs.run('k', async () => { runs += 1; return gate; });
    expect(jobs.size()).toBe(1);
    release('one result');
    expect(await first).toBe('one result');
    expect(await second).toBe('one result');
    expect(runs).toBe(1);
  });

  it('clears the entry once the job settles, so a retry after FAILURE starts fresh', async () => {
    const jobs = createInflightJobs();
    await expect(jobs.run('k', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(jobs.size()).toBe(0);
    await expect(jobs.run('k', async () => 'recovered')).resolves.toBe('recovered');
  });

  it('propagates the failure to every attached request', async () => {
    const jobs = createInflightJobs();
    let reject!: (error: Error) => void;
    const gate = new Promise((_, rej) => { reject = rej; });
    const a = jobs.run('k', () => gate);
    const b = jobs.run('k', () => gate);
    reject(new Error('model died'));
    await expect(a).rejects.toThrow('model died');
    await expect(b).rejects.toThrow('model died');
  });

  it('runs directly with no key rather than colliding all keyless requests', async () => {
    const jobs = createInflightJobs();
    const [a, b] = await Promise.all([
      jobs.run(null, async () => 'a'),
      jobs.run(null, async () => 'b'),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(jobs.size()).toBe(0);
  });

  it('does not collide different keys', async () => {
    const jobs = createInflightJobs();
    const [a, b] = await Promise.all([
      jobs.run('k1', async () => 'a'),
      jobs.run('k2', async () => 'b'),
    ]);
    expect(a).toBe('a');
    expect(b).toBe('b');
  });
});

describe('runGatedJob', () => {
  const setup = (gateOptions = { maxConcurrent: 1, maxQueued: 4 }) => {
    const gate = createJobGate(gateOptions);
    const inflight = createInflightJobs();
    const failures = createTTLCache({ ttlMs: 90_000 });
    const run = (key: string | null, compute: () => Promise<unknown>) =>
      runGatedJob({ key, compute, gate, inflight, failures });
    return { gate, inflight, failures, run };
  };

  it('attaches a retry to a job that is still QUEUED, so it runs once', async () => {
    const { gate, run } = setup();
    // another long job holds the only slot
    const releaseOther = await gate.acquire();
    const compute = vi.fn(async () => ({ items: ['rice'] }));

    const original = run('user:/analyze:key-1', compute);
    await Promise.resolve();
    const retry = run('user:/analyze:key-1', compute);
    await Promise.resolve();
    // one queue place, not two
    expect(gate.stats().queued).toBe(1);

    releaseOther();
    const [first, second] = await Promise.all([original, retry]);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(gate.stats().active).toBe(0);
  });

  it('keeps a full queue a retryable busy answer, never a remembered failure', async () => {
    const { gate, failures, run } = setup({ maxConcurrent: 1, maxQueued: 0 });
    const releaseOther = await gate.acquire();
    const compute = vi.fn(async () => 'never');

    await expect(run('user:/describe:key-2', compute)).rejects.toBeInstanceOf(WorkerBusyError);
    expect(compute).not.toHaveBeenCalled();
    expect(failures.get('user:/describe:key-2')).toBeUndefined();

    // and the next try, once the slot frees, runs for real
    releaseOther();
    await expect(run('user:/describe:key-2', compute)).resolves.toBe('never');
  });

  it('remembers a real failure and still releases the slot', async () => {
    const { gate, failures, run } = setup();
    await expect(run('user:/coach:key-3', async () => { throw new Error('model timed out after 480s'); }))
      .rejects.toThrow('timed out');
    expect(failures.get('user:/coach:key-3')).toBe('model timed out after 480s');
    expect(gate.stats().active).toBe(0);
  });

  it('still takes a slot for a keyless request', async () => {
    const { gate, run } = setup();
    let activeDuringRun = -1;
    await run(null, async () => { activeDuringRun = gate.stats().active; });
    expect(activeDuringRun).toBe(1);
    expect(gate.stats().active).toBe(0);
  });
});
