import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workout } from '@/types';

type Result = { data: unknown; error: unknown };
const backend = vi.hoisted(() => {
  const queues = new Map<string, Array<() => Promise<Result>>>();
  const writes: string[] = [];
  const client = {
    auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })) },
    from: (table: string) => {
      let result: Promise<Result> | undefined;
      const settle = () => result ??= queues.get(table)?.shift()?.() ?? Promise.resolve({ data: null, error: null });
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit', 'insert', 'delete']) {
        query[method] = () => { if (method === 'insert' || method === 'delete') writes.push(`${table}.${method}`); return query; };
      }
      query.single = settle;
      query.maybeSingle = settle;
      query.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => settle().then(resolve, reject);
      return query;
    },
  };
  return { queues, writes, client };
});
vi.mock('@/lib/supabase', () => ({ supabase: backend.client }));

import { resetAppData, useAppStore } from '@/stores/appStore';

function answer(table: string, data: unknown, error: unknown = null) {
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => Promise.resolve({ data, error }));
  backend.queues.set(table, queue);
}
function hold(table: string) {
  let release!: (result: Result) => void;
  const promise = new Promise<Result>((resolve) => { release = resolve; });
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => promise);
  backend.queues.set(table, queue);
  return release;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const workout: Workout = { id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-11-03', notes: null, completed: false, sets: [] };
const plan = { id: 'plan-1', workout_id: workout.id, day_label: 'Pull', items: [] };

beforeEach(() => {
  resetAppData();
  backend.queues.clear();
  backend.writes.length = 0;
  backend.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
});

describe('all workout Start routes coordinate', () => {
  it('creates one workout for concurrent flexible, quick-start and program starts', async () => {
    const releaseExisting = hold('workouts');
    answer('workouts', workout);
    answer('workouts', workout);
    answer('workout_day_plans', plan);
    const store = useAppStore.getState();
    const flexible = store.startFlexibleWorkout('Pull');
    await flush();
    const quickStart = store.startFlexibleWorkoutFromTemplate('Push');
    const program = store.startWorkout('split-day-1');
    releaseExisting({ data: null, error: null });
    expect(await Promise.all([flexible, quickStart, program])).toEqual([workout, workout, workout]);
    expect(backend.writes).toEqual(['workouts.insert', 'workout_day_plans.insert']);
    expect(useAppStore.getState().currentWorkout).toEqual(workout);
  });

  it('preserves the flexible-start refusal when a program start wins', async () => {
    const releaseExisting = hold('workouts');
    const programWorkout = { ...workout, split_day_id: 'split-day-1' };
    answer('workouts', programWorkout);
    answer('workouts', programWorkout);
    answer('split_exercises', []);
    const program = useAppStore.getState().startWorkout('split-day-1');
    await flush();
    const flexible = useAppStore.getState().startFlexibleWorkout('Pull');
    releaseExisting({ data: null, error: null });
    expect(await program).toEqual(programWorkout);
    expect(await flexible).toBeNull();
    expect(backend.writes).toEqual(['workouts.insert']);
  });

  it('releases a failed shared attempt so either route can retry', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const releaseExisting = hold('workouts');
    const first = useAppStore.getState().startFlexibleWorkout('Pull');
    const second = useAppStore.getState().startWorkout('split-day-1');
    const failed = Promise.allSettled([first, second]);
    releaseExisting({ data: null, error: new Error('offline') });
    expect((await failed).map((result) => result.status)).toEqual(['rejected', 'rejected']);
    answer('workouts', null);
    answer('workouts', workout);
    answer('workouts', workout);
    answer('workout_day_plans', plan);
    expect(await useAppStore.getState().startFlexibleWorkout('Pull')).toEqual(workout);
    expect(backend.writes.filter((write) => write === 'workouts.insert')).toHaveLength(1);
    quiet.mockRestore();
  });

  it('does not make a new account join the previous account’s start', async () => {
    const releaseOld = hold('workouts');
    const old = useAppStore.getState().startFlexibleWorkout('Old');
    const oldResult = old.catch((error: unknown) => error);
    await flush();
    resetAppData();
    backend.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-2' } } }, error: null });
    const nextWorkout = { ...workout, id: 'workout-2', user_id: 'user-2' };
    answer('workouts', null);
    answer('workouts', nextWorkout);
    answer('workouts', nextWorkout);
    answer('workout_day_plans', { ...plan, workout_id: nextWorkout.id });
    expect(await useAppStore.getState().startFlexibleWorkout('New')).toEqual(nextWorkout);
    releaseOld({ data: null, error: null });
    expect(await oldResult).toBeInstanceOf(Error);
    expect(useAppStore.getState().currentWorkout).toEqual(nextWorkout);
  });
});
