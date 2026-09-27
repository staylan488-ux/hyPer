import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: supabaseMock,
}));

import {
  getExerciseLibrary,
  invalidateExerciseLibrary,
  peekExerciseLibrary,
} from '@/lib/exerciseLibrary';

type Result = { data: unknown; error: unknown };

const rows = [
  { id: 'e1', name: 'Arnold Press', muscle_group: 'shoulders' },
  { id: 'e2', name: 'Push-Up', muscle_group: 'chest' },
];

/** Each call to from('exercises') answers with the next queued result. */
function queueResults(...results: Array<Result | Promise<Result>>) {
  const order = vi.fn(() => results.shift() ?? Promise.resolve({ data: rows, error: null }));
  const select = vi.fn(() => ({ order }));
  supabaseMock.from.mockImplementation(() => ({ select }));
  return { select, order };
}

beforeEach(() => {
  supabaseMock.from.mockReset();
  invalidateExerciseLibrary();
});

describe('exercise library cache', () => {
  it('shares one request between concurrent calls', async () => {
    const { order } = queueResults(Promise.resolve({ data: rows, error: null }));

    const [first, second] = await Promise.all([getExerciseLibrary(), getExerciseLibrary()]);

    expect(order).toHaveBeenCalledTimes(1);
    expect(order).toHaveBeenCalledWith('name');
    expect(first).toBe(second);
  });

  it('serves cached rows without another request', async () => {
    const { order } = queueResults(Promise.resolve({ data: rows, error: null }));

    expect(peekExerciseLibrary()).toBeNull();
    await getExerciseLibrary();

    expect(peekExerciseLibrary()).toEqual(rows);
    await expect(getExerciseLibrary()).resolves.toEqual(rows);
    expect(order).toHaveBeenCalledTimes(1);
  });

  it('refetches after invalidate and when forced', async () => {
    const { order } = queueResults(
      Promise.resolve({ data: rows, error: null }),
      Promise.resolve({ data: rows, error: null }),
      Promise.resolve({ data: [rows[0]], error: null }),
    );

    await getExerciseLibrary();
    invalidateExerciseLibrary();
    expect(peekExerciseLibrary()).toBeNull();
    await getExerciseLibrary();
    await getExerciseLibrary({ force: true });

    expect(order).toHaveBeenCalledTimes(3);
    expect(peekExerciseLibrary()).toEqual([rows[0]]);
  });

  it('does not cache a failed fetch and retries on the next call', async () => {
    const failure = { message: 'offline' };
    const { order } = queueResults(
      Promise.resolve({ data: null, error: failure }),
      Promise.resolve({ data: rows, error: null }),
    );

    await expect(getExerciseLibrary()).rejects.toBe(failure);
    expect(peekExerciseLibrary()).toBeNull();

    await expect(getExerciseLibrary()).resolves.toEqual(rows);
    expect(order).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good rows when a forced refresh fails', async () => {
    queueResults(
      Promise.resolve({ data: rows, error: null }),
      Promise.resolve({ data: null, error: { message: 'offline' } }),
    );

    await getExerciseLibrary();
    await expect(getExerciseLibrary({ force: true })).rejects.toBeTruthy();

    expect(peekExerciseLibrary()).toEqual(rows);
  });

  it('does not let a request from before invalidate refill the cache', async () => {
    let resolveStale!: (value: Result) => void;
    queueResults(new Promise<Result>((resolve) => { resolveStale = resolve; }));

    const stale = getExerciseLibrary();
    invalidateExerciseLibrary();
    resolveStale({ data: rows, error: null });
    await stale;

    expect(peekExerciseLibrary()).toBeNull();
  });
});
