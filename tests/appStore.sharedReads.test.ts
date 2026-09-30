import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Split, Workout, WorkoutSet } from '@/types';

type Result = { data: unknown; error: unknown; status?: number };

// Every query builder method chains; the terminal call (single, maybeSingle
// or awaiting the builder) answers with the next result queued for its table.
const backend = vi.hoisted(() => {
  const queues = new Map<string, Array<() => Promise<Result>>>();
  const calls: string[] = [];
  const next = (table: string) => {
    const queued = queues.get(table)?.shift();
    return queued ? queued() : Promise.resolve({ data: null, error: null, status: 200 });
  };
  const from = (table: string) => {
    calls.push(table);
    let answer: Promise<Result> | null = null;
    const settle = () => (answer ??= next(table));
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'upsert', 'insert', 'delete', 'eq', 'neq', 'in', 'order', 'limit', 'abortSignal']) {
      query[method] = () => query;
    }
    query.single = () => settle();
    query.maybeSingle = () => settle();
    query.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => settle().then(resolve, reject);
    return query;
  };
  return {
    queues,
    calls,
    client: {
      from,
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: backend.client }));

import { useAppStore } from '@/stores/appStore';

function hold(table: string) {
  let release!: (result: Result) => void;
  const promise = new Promise<Result>((resolve) => { release = resolve; });
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => promise);
  backend.queues.set(table, queue);
  return release;
}

function answer(table: string, result: Result) {
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => Promise.resolve(result));
  backend.queues.set(table, queue);
}

const callsTo = (table: string) => backend.calls.filter((name) => name === table).length;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function split(name: string): Split {
  return {
    id: 'split-1', user_id: 'user-1', name, days_per_week: 3, is_active: true,
    created_at: '2026-09-01T00:00:00.000Z', days: [],
  } as unknown as Split;
}

const openSet: WorkoutSet = {
  id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
};

function workoutWith(set: WorkoutSet): Workout {
  return {
    id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-09-30',
    notes: null, completed: false, created_at: new Date().toISOString(), sets: [set],
  };
}

beforeEach(() => {
  backend.queues.clear();
  backend.calls.length = 0;
  useAppStore.setState({
    splits: [], activeSplit: null, currentWorkout: null, currentWorkoutDayPlan: null,
    flexTemplates: [], workoutMode: 'split',
  });
});

describe('shared store reads', () => {
  it('makes one splits request for concurrent callers', async () => {
    answer('splits', { data: [split('Upper Lower')], error: null });

    await Promise.all([
      useAppStore.getState().fetchSplits(),
      useAppStore.getState().fetchSplits(),
      useAppStore.getState().fetchSplits(),
    ]);

    expect(callsTo('splits')).toBe(1);
    expect(useAppStore.getState().activeSplit?.name).toBe('Upper Lower');
  });

  it('reads splits again after a write, and a read from before it cannot overwrite', async () => {
    const releaseOld = hold('splits');
    const mountRead = useAppStore.getState().fetchSplits();
    await flush();

    answer('splits', { data: null, error: null }); // the update
    answer('splits', { data: [split('Renamed')], error: null }); // the read after it
    await expect(useAppStore.getState().updateSplit('split-1', { name: 'Renamed' })).resolves.toEqual({ ok: true });
    expect(useAppStore.getState().activeSplit?.name).toBe('Renamed');

    releaseOld({ data: [split('Old name')], error: null });
    await mountRead;

    expect(callsTo('splits')).toBe(3);
    expect(useAppStore.getState().activeSplit?.name).toBe('Renamed');
  });

  it('does not reuse a failed read', async () => {
    answer('splits', { data: null, error: { message: 'offline' } });
    await useAppStore.getState().fetchSplits();
    answer('splits', { data: [split('Upper Lower')], error: null });
    await useAppStore.getState().fetchSplits();

    expect(callsTo('splits')).toBe(2);
    expect(useAppStore.getState().activeSplit?.name).toBe('Upper Lower');
  });

  it('makes one live workout and one day plan request for concurrent callers', async () => {
    answer('workouts', { data: workoutWith(openSet), error: null });
    answer('workout_day_plans', { data: null, error: null });

    await Promise.all([
      useAppStore.getState().fetchCurrentWorkout(),
      useAppStore.getState().fetchCurrentWorkout(),
    ]);
    await Promise.all([
      useAppStore.getState().fetchCurrentWorkoutDayPlan('workout-1'),
      useAppStore.getState().fetchCurrentWorkoutDayPlan('workout-1'),
    ]);

    expect(callsTo('workouts')).toBe(1);
    expect(callsTo('workout_day_plans')).toBe(2); // one inside the workout read, one shared pair
    expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
  });

  it('does not join a live workout read that started before a set was logged', async () => {
    useAppStore.setState({ currentWorkout: workoutWith(openSet) });
    const releaseOld = hold('workouts');
    const oldRead = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    const logged = { ...openSet, weight: 100, reps: 8, rpe: 8, completed: true, completed_at: '2026-09-30T10:00:00.000Z' };
    answer('sets', { data: logged, error: null, status: 200 });
    await useAppStore.getState().logSet('exercise-1', 1, 100, 8, 8);

    answer('workouts', { data: workoutWith(logged), error: null });
    await useAppStore.getState().fetchCurrentWorkout();
    releaseOld({ data: workoutWith(openSet), error: null });
    await oldRead;

    expect(callsTo('workouts')).toBe(2);
    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(true);
  });

  it('shares the mode read, and a mode switch made meanwhile wins', async () => {
    const release = hold('program_preferences');
    const reads = Promise.all([
      useAppStore.getState().fetchWorkoutMode(),
      useAppStore.getState().fetchWorkoutMode(),
    ]);
    await flush();

    answer('program_preferences', { data: null, error: null });
    await useAppStore.getState().setWorkoutMode('flexible');
    release({ data: { workout_mode: 'split' }, error: null });
    await reads;

    expect(callsTo('program_preferences')).toBe(2); // one shared read, one save
    expect(useAppStore.getState().workoutMode).toBe('flexible');
  });

  it('shares the templates read and reads again after deleting one', async () => {
    const template = { id: 'template-1', user_id: 'user-1', label: 'Arms', items: [] };
    answer('flex_day_templates', { data: [template], error: null });
    await Promise.all([
      useAppStore.getState().fetchFlexTemplates(),
      useAppStore.getState().fetchFlexTemplates(),
    ]);
    expect(callsTo('flex_day_templates')).toBe(1);

    answer('flex_day_templates', { data: null, error: null }); // the delete
    answer('flex_day_templates', { data: [], error: null });
    await useAppStore.getState().deleteFlexTemplate('template-1');

    expect(callsTo('flex_day_templates')).toBe(3);
    expect(useAppStore.getState().flexTemplates).toEqual([]);
  });
});
