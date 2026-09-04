import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

// Exercise the installed Supabase SDK too: its fetch wrapper starts only after
// session lookup, and PostgREST returns network failures as response objects.
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://workout-save.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});

import { supabase } from '@/lib/supabase';
import { SET_SAVE_TIMEOUT_MS } from '@/lib/saveWorkoutSet';
import { useAppStore } from '@/stores/appStore';

const firstSet: WorkoutSet = {
  id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
};
const workout: Workout = {
  id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-09-04',
  notes: null, completed: false, sets: [firstSet],
};

function responseFor(init?: RequestInit, target = firstSet): Response {
  return Response.json({ ...target, ...JSON.parse(String(init?.body)) });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  useAppStore.setState({ currentWorkout: workout });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('workout set save recovery', () => {
  it('aborts a hung request and retries the same row, values, and timestamp', async () => {
    fetchMock.mockImplementationOnce(() => new Promise(() => {}));
    fetchMock.mockImplementationOnce(async (_url, init) => responseFor(init));

    const save = useAppStore.getState().logSet('exercise-1', 1, 185, 8, 8.5);
    await vi.advanceTimersByTimeAsync(SET_SAVE_TIMEOUT_MS);
    await save;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [[firstUrl, firstInit], [retryUrl, retryInit]] = fetchMock.mock.calls;
    expect(new URL(String(firstUrl)).searchParams.get('id')).toBe('eq.set-1');
    expect(new URL(String(firstUrl)).searchParams.get('workout_id')).toBe('eq.workout-1');
    expect(retryUrl).toBe(firstUrl);
    expect(retryInit?.body).toBe(firstInit?.body);
    expect(firstInit?.signal?.aborted).toBe(true);
    expect(retryInit?.signal?.aborted).toBe(false);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({
      weight: 185, reps: 8, rpe: 8.5, completed: true,
    });
  });

  it('settles after two hung attempts and allows another save without reloading', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const result = useAppStore.getState().logSet('exercise-1', 1, 185, 8, 8.5)
      .then(() => 'saved', () => 'failed');
    let settled = false;
    void result.then(() => { settled = true; });

    await vi.advanceTimersByTimeAsync(2 * SET_SAVE_TIMEOUT_MS);
    expect(settled).toBe(true);
    expect(await result).toBe('failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.signal?.aborted)).toBe(true);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toEqual(firstSet);

    fetchMock.mockImplementation(async (_url, init) => responseFor(init));
    await useAppStore.getState().logSet('exercise-1', 1, 185, 8, 8.5);
    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(true);
  });

  it('bounds a stalled session lookup before fetch even starts', async () => {
    vi.spyOn(supabase.auth, 'getSession').mockImplementation(() => new Promise(() => {}));
    const result = useAppStore.getState().logSet('exercise-1', 1, 185, 8)
      .then(() => 'saved', () => 'failed');
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(2 * SET_SAVE_TIMEOUT_MS);

    expect(settled).toBe(true);
    expect(await result).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(false);
  });

  it('ignores a late response from an expired attempt after a later edit succeeds', async () => {
    const late = deferred<Response>();
    fetchMock.mockImplementationOnce(() => late.promise);
    fetchMock.mockImplementation(async (_url, init) => responseFor(init));
    const save = useAppStore.getState().logSet('exercise-1', 1, 185, 8, 8.5);
    await vi.advanceTimersByTimeAsync(SET_SAVE_TIMEOUT_MS);
    await save;
    await useAppStore.getState().logSet('exercise-1', 1, 195, 6, 9);

    late.resolve(responseFor(fetchMock.mock.calls[0][1]));
    await vi.advanceTimersByTimeAsync(0);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({ weight: 195, reps: 6, rpe: 9 });
  });

  it.each([0, 408, 429, 500, 502, 503, 504])('recovers from transient status %s', async (status) => {
    fetchMock.mockImplementationOnce(async () => {
      if (status === 0) throw new TypeError('Failed to fetch');
      return Response.json({ message: 'Temporarily unavailable' }, { status });
    });
    fetchMock.mockImplementationOnce(async (_url, init) => responseFor(init));

    await useAppStore.getState().logSet('exercise-1', 1, 185, 8);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({ completed: true, rpe: null });
  });

  it.each([400, 401, 403, 406])('reports status %s without retrying or marking the set complete', async (status) => {
    fetchMock.mockResolvedValue(Response.json({ message: 'Save rejected' }, { status }));
    await expect(useAppStore.getState().logSet('exercise-1', 1, 185, 8)).rejects.toMatchObject({ message: 'Save rejected' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toEqual(firstSet);
  });

  it('does not report success when the server returns no saved row', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(useAppStore.getState().logSet('exercise-1', 1, 185, 8)).rejects.toThrow('not returned');
    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(false);
  });

  it('does not write a delayed result into a different current workout', async () => {
    const delayed = deferred<Response>();
    fetchMock.mockReturnValue(delayed.promise);
    const save = useAppStore.getState().logSet('exercise-1', 1, 185, 8);
    await vi.advanceTimersByTimeAsync(0);
    const replacement = { ...workout, id: 'workout-2', sets: [{ ...firstSet, id: 'set-2', workout_id: 'workout-2' }] };
    useAppStore.setState({ currentWorkout: replacement });
    delayed.resolve(responseFor(fetchMock.mock.calls[0][1]));
    await save;
    expect(useAppStore.getState().currentWorkout).toEqual(replacement);
  });

  it('keeps results of simultaneous saves of different sets', async () => {
    const secondSet = { ...firstSet, id: 'set-2', set_number: 2 };
    useAppStore.setState({ currentWorkout: { ...workout, sets: [firstSet, secondSet] } });
    const first = deferred<Response>();
    fetchMock.mockReturnValueOnce(first.promise);
    fetchMock.mockImplementationOnce(async (_url, init) => responseFor(init, secondSet));
    const firstSave = useAppStore.getState().logSet('exercise-1', 1, 185, 8);
    await vi.advanceTimersByTimeAsync(0);
    await useAppStore.getState().logSet('exercise-1', 2, 195, 6);
    first.resolve(responseFor(fetchMock.mock.calls[0][1]));
    await firstSave;
    expect(useAppStore.getState().currentWorkout?.sets.map(s => [s.weight, s.reps, s.completed]))
      .toEqual([[185, 8, true], [195, 6, true]]);
  });

  it('does not resurrect a workout completed while a save was pending', async () => {
    const delayed = deferred<Response>();
    fetchMock.mockReturnValue(delayed.promise);
    const save = useAppStore.getState().logSet('exercise-1', 1, 185, 8);
    await vi.advanceTimersByTimeAsync(0);
    useAppStore.setState({ currentWorkout: null });
    delayed.resolve(responseFor(fetchMock.mock.calls[0][1]));
    await save;
    expect(useAppStore.getState().currentWorkout).toBeNull();
  });

  it('rejects missing workouts or sets instead of reporting success', async () => {
    await expect(useAppStore.getState().logSet('missing', 1, 185, 8)).rejects.toThrow('no longer');
    useAppStore.setState({ currentWorkout: null });
    await expect(useAppStore.getState().logSet('exercise-1', 1, 185, 8)).rejects.toThrow('No active workout');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
