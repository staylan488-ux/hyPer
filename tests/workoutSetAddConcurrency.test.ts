import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

// Keep the real query builder so each held response represents an actual
// pending insert, including its session lookup and serialized row values.
vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://workout-set-add.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});

import { resetAppData, useAppStore } from '@/stores/appStore';

const firstSet: WorkoutSet = {
  id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
};
const workout: Workout = {
  id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-10-25',
  notes: null, completed: false, sets: [firstSet],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function responseFor(init: RequestInit | undefined, id: string): Response {
  return Response.json({
    weight: null, reps: null, rpe: null, completed_at: null,
    ...JSON.parse(String(init?.body)), id,
  });
}

// Let SDK session lookup and all chained requests reach the fake transport.
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  useAppStore.setState({ currentWorkout: workout });
});

afterEach(() => vi.restoreAllMocks());

describe('adding workout sets while an insert is pending', () => {
  it('does not duplicate an inserted row already delivered by a concurrent read', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    const adding = useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();
    const alreadyRead = { ...firstSet, id: 'set-2', set_number: 2, weight: 200, reps: 5, completed: true };
    useAppStore.setState({ currentWorkout: { ...workout, sets: [firstSet, alreadyRead] } });
    pending.resolve(responseFor(fetchMock.mock.calls[0][1], 'set-2'));
    await adding;
    expect(useAppStore.getState().currentWorkout?.sets).toEqual([firstSet, alreadyRead]);
  });

  it('shares overlapping taps, then numbers the next intentional addition after the created set', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockImplementation(async (_input, init) => responseFor(init, 'unexpected-duplicate'));

    const firstAdd = useAppStore.getState().addWorkoutSet('exercise-1');
    const overlappingAdd = useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 2,
    });
    pending.resolve(responseFor(fetchMock.mock.calls[0][1], 'set-2'));
    await Promise.all([firstAdd, overlappingAdd]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id)).toEqual(['set-1', 'set-2']);

    fetchMock.mockImplementationOnce(async (_input, init) => responseFor(init, 'set-3'));
    await useAppStore.getState().addWorkoutSet('exercise-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.set_number)).toEqual([1, 2, 3]);
  });

  it.each(['live-first', 'history-first'])('shares additions between live workout and History (%s)', async (order) => {
    const pending = deferred<Response>();
    let insertInit: RequestInit | undefined;
    fetchMock.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') {
        insertInit = init;
        return pending.promise;
      }
      return Response.json([{ set_number: 1 }]);
    });

    const firstAdd = order === 'live-first'
      ? useAppStore.getState().addWorkoutSet('exercise-1')
      : useAppStore.getState().addSetToWorkout('workout-1', 'exercise-1');
    await flush();
    const overlappingAdd = order === 'live-first'
      ? useAppStore.getState().addSetToWorkout('workout-1', 'exercise-1')
      : useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();

    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    pending.resolve(responseFor(insertInit, 'set-2'));
    await Promise.all([firstAdd, overlappingAdd]);
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id)).toEqual(['set-1', 'set-2']);
  });

  it('releases a failed addition so the same movement can be retried', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(Response.json({ message: 'Insert rejected' }, { status: 400 }));

    await useAppStore.getState().addWorkoutSet('exercise-1');
    expect(consoleError).toHaveBeenCalled();
    expect(useAppStore.getState().currentWorkout?.sets).toEqual([firstSet]);

    fetchMock.mockImplementationOnce(async (_input, init) => responseFor(init, 'set-2'));
    await useAppStore.getState().addWorkoutSet('exercise-1');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.set_number)).toEqual([1, 2]);
  });

  it('allows another movement to add a set while the first movement is waiting', async () => {
    const secondExerciseSet = { ...firstSet, id: 'other-1', exercise_id: 'exercise-2' };
    useAppStore.setState({ currentWorkout: { ...workout, sets: [firstSet, secondExerciseSet] } });
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockImplementationOnce(async (_input, init) => responseFor(init, 'other-2'));

    const firstAdd = useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();
    await useAppStore.getState().addWorkoutSet('exercise-2');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout?.sets.find((set) => set.id === 'other-2'))
      .toMatchObject({ exercise_id: 'exercise-2', set_number: 2 });
    pending.resolve(responseFor(fetchMock.mock.calls[0][1], 'set-2'));
    await firstAdd;
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id))
      .toEqual(['set-1', 'other-1', 'other-2', 'set-2']);
  });

  it('does not block or replace an addition in a different workout', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockImplementationOnce(async (_input, init) => responseFor(init, 'replacement-2'));
    const firstAdd = useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();

    const replacementSet = { ...firstSet, id: 'replacement-1', workout_id: 'workout-2' };
    useAppStore.setState({ currentWorkout: { ...workout, id: 'workout-2', sets: [replacementSet] } });
    await useAppStore.getState().addWorkoutSet('exercise-1');
    pending.resolve(responseFor(fetchMock.mock.calls[0][1], 'stale-2'));
    await firstAdd;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout).toMatchObject({ id: 'workout-2' });
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id))
      .toEqual(['replacement-1', 'replacement-2']);
  });

  it('starts a fresh addition after an account reset and ignores the earlier response', async () => {
    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    fetchMock.mockImplementationOnce(async (_input, init) => responseFor(init, 'current-2'));
    const firstAdd = useAppStore.getState().addWorkoutSet('exercise-1');
    await flush();

    // The same account can sign back in with the same workout while its old
    // request is still pending; its earlier account scope is no longer valid.
    resetAppData();
    useAppStore.setState({ currentWorkout: workout });
    await useAppStore.getState().addWorkoutSet('exercise-1');
    pending.resolve(responseFor(fetchMock.mock.calls[0][1], 'stale-2'));
    await firstAdd;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(useAppStore.getState().currentWorkout?.sets.map((set) => set.id)).toEqual(['set-1', 'current-2']);
  });
});
