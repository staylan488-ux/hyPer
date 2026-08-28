import { describe, expect, it, vi } from 'vitest';
import { withTimeout } from '../src/lib/withTimeout';

describe('withTimeout', () => {
  it('resolves with the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, 'late')).resolves.toBe(42);
  });

  it('rejects with the original error when the promise fails in time', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000, 'late')).rejects.toThrow('boom');
  });

  it('rejects with the timeout message when the promise never settles', async () => {
    vi.useFakeTimers();
    const hung = new Promise<never>(() => {});
    const guarded = withTimeout(hung, 5000, 'gave up waiting');
    const outcome = expect(guarded).rejects.toThrow('gave up waiting');
    await vi.advanceTimersByTimeAsync(5001);
    await outcome;
    vi.useRealTimers();
  });

  it('does not reject after a successful settle even when the timer later fires', async () => {
    vi.useFakeTimers();
    const guarded = withTimeout(Promise.resolve('ok'), 5000, 'late');
    await expect(guarded).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(6000);
    vi.useRealTimers();
  });
});
