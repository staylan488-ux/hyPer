import { describe, expect, it, vi } from 'vitest';

import { createKeyedSingleFlight } from '@/lib/singleFlight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createKeyedSingleFlight', () => {
  it('shares one in-flight run between concurrent callers of the same key', async () => {
    const flight = createKeyedSingleFlight<string>();
    const gate = deferred<string>();
    const fn = vi.fn(() => gate.promise);

    const first = flight.run('user-1', fn);
    const second = flight.run('user-1', fn);
    gate.resolve('done');

    await expect(Promise.all([first, second])).resolves.toEqual(['done', 'done']);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('runs different keys independently', async () => {
    const flight = createKeyedSingleFlight<string>();
    const fn = vi.fn(async () => 'ok');

    await Promise.all([flight.run('user-1', fn), flight.run('user-2', fn)]);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('starts a fresh run once the previous one has settled', async () => {
    const flight = createKeyedSingleFlight<string | null>();
    const fn = vi.fn(async () => null);

    await flight.run('user-1', fn);
    await flight.run('user-1', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears the key after a rejection so the next call retries', async () => {
    const flight = createKeyedSingleFlight<string>();
    const gate = deferred<string>();
    const failing = vi.fn(() => gate.promise);

    const first = flight.run('user-1', failing);
    const joined = flight.run('user-1', failing);
    gate.reject(new Error('offline'));

    await expect(first).rejects.toThrow('offline');
    await expect(joined).rejects.toThrow('offline');
    expect(failing).toHaveBeenCalledOnce();

    const retry = vi.fn(async () => 'recovered');
    await expect(flight.run('user-1', retry)).resolves.toBe('recovered');
    expect(retry).toHaveBeenCalledOnce();
  });

  it('turns a synchronous throw into a rejection and still clears the key', async () => {
    const flight = createKeyedSingleFlight<string>();

    await expect(flight.run('user-1', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(flight.run('user-1', async () => 'next')).resolves.toBe('next');
  });
});
