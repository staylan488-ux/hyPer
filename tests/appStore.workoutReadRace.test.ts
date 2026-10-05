import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workout, WorkoutSet } from '@/types';

type Result = { data: unknown; error: unknown; status?: number };

// Every query builder method chains; the terminal call (single, maybeSingle
// or awaiting the builder) answers with the next result queued for its table.
const backend = vi.hoisted(() => {
  const queues = new Map<string, Array<() => Promise<Result>>>();
  const calls: string[] = [];
  const mutations: string[] = [];
  const next = (table: string) => {
    const queued = queues.get(table)?.shift();
    return queued ? queued() : Promise.resolve({ data: null, error: null, status: 200 });
  };
  const from = (table: string) => {
    calls.push(table);
    let answer: Promise<Result> | null = null;
    const settle = () => (answer ??= next(table));
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'in', 'order', 'limit', 'abortSignal', 'gte', 'lte']) {
      query[method] = () => {
        if (['update', 'insert', 'delete'].includes(method)) mutations.push(`${table}.${method}`);
        return query;
      };
    }
    query.single = () => settle();
    query.maybeSingle = () => settle();
    query.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => settle().then(resolve, reject);
    return query;
  };
  return {
    queues,
    calls,
    mutations,
    client: {
      from,
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null }) },
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: backend.client }));

import { recallTodayDay, rememberTodayDay } from '@/lib/todayDay';
import { getWorkoutWriteSeq, resetAppData, useAppStore } from '@/stores/appStore';

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

const openSet: WorkoutSet = {
  id: 'set-1', workout_id: 'workout-1', exercise_id: 'exercise-1', set_number: 1,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
};

const loggedSet: WorkoutSet = {
  ...openSet, weight: 100, reps: 8, rpe: 8, completed: true, completed_at: '2026-09-30T10:00:00.000Z',
};

function workoutWith(set: WorkoutSet): Workout {
  return {
    id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-09-30',
    notes: null, completed: false, created_at: new Date().toISOString(), sets: [set],
  };
}

// Lets the read reach its held query before the test moves on.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  backend.queues.clear();
  backend.calls.length = 0;
  backend.mutations.length = 0;
  useAppStore.setState({
    currentWorkout: workoutWith(openSet),
    currentWorkoutDayPlan: null,
    calculateWeeklyVolume: async () => {},
  });
});

describe('fetchCurrentWorkout against overlapping workout writes', () => {
  it('keeps a set logged while an older read was in flight', async () => {
    const releaseRead = hold('workouts');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    answer('sets', { data: loggedSet, error: null, status: 200 });
    await useAppStore.getState().logSet('exercise-1', 1, 100, 8, 8);
    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(true);

    // The read saw the row from before the save.
    releaseRead({ data: workoutWith(openSet), error: null });
    await read;

    expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({ completed: true, weight: 100, reps: 8 });
    expect(backend.calls).not.toContain('workout_day_plans');
  });

  it('drops a read that started while the set was saving and answered after it', async () => {
    const releaseSave = hold('sets');
    const save = useAppStore.getState().logSet('exercise-1', 1, 100, 8, 8);
    await flush();

    const releaseRead = hold('workouts');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    releaseSave({ data: loggedSet, error: null, status: 200 });
    await save;
    releaseRead({ data: workoutWith(openSet), error: null });
    await read;

    expect(useAppStore.getState().currentWorkout?.sets[0].completed).toBe(true);
  });

  it('does not bring a finished workout back as active', async () => {
    const releaseRead = hold('workouts');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    answer('workouts', { data: null, error: null, status: 204 });
    await useAppStore.getState().completeWorkout();
    expect(useAppStore.getState().currentWorkout).toBeNull();

    // The read saw the workout before completion committed.
    releaseRead({ data: workoutWith(loggedSet), error: null });
    await read;

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('replaces the store and loads the day plan when nothing was written meanwhile', async () => {
    const serverWorkout = workoutWith(loggedSet);
    answer('workouts', { data: serverWorkout, error: null });
    answer('workout_day_plans', {
      data: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Push', items: [] },
      error: null,
    });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toEqual(serverWorkout);
    expect(useAppStore.getState().currentWorkoutDayPlan).toMatchObject({ id: 'plan-1', day_label: 'Push' });
  });

  it('clears the store when the server has no active workout', async () => {
    answer('workouts', { data: null, error: null });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toBeNull();
  });

  it('keeps a day plan edit made while the plan read was in flight', async () => {
    const plan = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Push', items: [] };
    useAppStore.setState({ currentWorkoutDayPlan: plan });
    const releaseRead = hold('workout_day_plans');
    const read = useAppStore.getState().fetchCurrentWorkoutDayPlan('workout-1');
    await flush();

    answer('workout_day_plans', { data: { ...plan, day_label: 'Pull' }, error: null });
    await useAppStore.getState().setFlexibleWorkoutLabel('Pull');
    expect(useAppStore.getState().currentWorkoutDayPlan?.day_label).toBe('Pull');

    releaseRead({ data: plan, error: null });
    await read;

    expect(useAppStore.getState().currentWorkoutDayPlan?.day_label).toBe('Pull');
  });

  it('does not land a read for the previous account after the store was reset', async () => {
    const releaseRead = hold('workouts');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    resetAppData();
    releaseRead({ data: workoutWith(loggedSet), error: null });
    await read;

    expect(useAppStore.getState().currentWorkout).toBeNull();
  });
});

describe('restoring flexible sessions with their required plan', () => {
  const plan = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Push', items: [] };

  it('does not expose a cold session until its plan is available', async () => {
    useAppStore.setState({ currentWorkout: null });
    answer('workouts', { data: workoutWith(openSet), error: null });
    const releasePlan = hold('workout_day_plans');

    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();
    expect(useAppStore.getState().currentWorkout).toBeNull();

    releasePlan({ data: plan, error: null });
    await read;

    expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
    expect(useAppStore.getState().currentWorkoutDayPlan).toEqual(plan);
    expect(backend.mutations).toEqual([]);
  });

  it.each([
    ['missing', null],
    ['unreadable', { message: 'offline' }],
  ])('leaves Start available when a cold session has a %s plan', async (_label, error) => {
    const loggedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    useAppStore.setState({ currentWorkout: null });
    answer('workouts', { data: workoutWith(openSet), error: null });
    answer('workout_day_plans', { data: null, error });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
    expect(backend.mutations).toEqual([]);
    loggedError.mockRestore();
  });

  it.each([
    ['missing', null],
    ['unreadable', { message: 'offline' }],
  ])('preserves a usable warm session when its refreshed plan is %s', async (_label, error) => {
    const loggedError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warmWorkout = workoutWith(loggedSet);
    useAppStore.setState({ currentWorkout: warmWorkout, currentWorkoutDayPlan: plan });
    answer('workouts', { data: workoutWith(openSet), error: null });
    answer('workout_day_plans', { data: null, error });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toBe(warmWorkout);
    expect(useAppStore.getState().currentWorkoutDayPlan).toBe(plan);
    expect(backend.mutations).toEqual([]);
    loggedError.mockRestore();
  });

  it('does not treat a cached plan for another workout as a usable session', async () => {
    useAppStore.setState({ currentWorkoutDayPlan: { ...plan, workout_id: 'another-workout' } });
    answer('workouts', { data: workoutWith(openSet), error: null });
    answer('workout_day_plans', { data: null, error: null });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('continues to restore a split session without a day plan', async () => {
    const splitWorkout = { ...workoutWith(openSet), split_day_id: 'split-day-1' };
    answer('workouts', { data: splitWorkout, error: null });
    answer('workout_day_plans', { data: null, error: null });

    await useAppStore.getState().fetchCurrentWorkout();

    expect(useAppStore.getState().currentWorkout).toEqual(splitWorkout);
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('does not restore a session finished while its required plan was loading', async () => {
    answer('workouts', { data: workoutWith(loggedSet), error: null });
    const releasePlan = hold('workout_day_plans');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    answer('workouts', { data: null, error: null, status: 204 });
    await useAppStore.getState().completeWorkout();
    releasePlan({ data: plan, error: null });
    await read;

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });

  it('does not restore an old account session after its required plan finishes loading', async () => {
    answer('workouts', { data: workoutWith(loggedSet), error: null });
    const releasePlan = hold('workout_day_plans');
    const read = useAppStore.getState().fetchCurrentWorkout();
    await flush();

    resetAppData();
    releasePlan({ data: plan, error: null });
    await read;

    expect(useAppStore.getState().currentWorkout).toBeNull();
    expect(useAppStore.getState().currentWorkoutDayPlan).toBeNull();
  });
});

describe('remembered Today across a session started and finished elsewhere', () => {
  it('does not trust "not done" after starting and finishing with no live workout on either side', async () => {
    useAppStore.setState({ currentWorkout: null });
    const day = { nutritionTotals: { calories: 0, protein: 0, carbs: 0, fat: 0 }, todayDone: null };
    rememberTodayDay('user-1', '2026-09-30', day, null, getWorkoutWriteSeq());

    // Train: no open workout, the insert, the re-read, then the finish.
    answer('workouts', { data: null, error: null });
    answer('workouts', { data: { ...workoutWith(openSet), sets: undefined }, error: null });
    answer('workout_day_plans', { data: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Push', items: [] }, error: null });
    answer('workouts', { data: workoutWith(openSet), error: null });
    await useAppStore.getState().startFlexibleWorkout('Push');
    expect(useAppStore.getState().currentWorkout?.id).toBe('workout-1');
    answer('workouts', { data: null, error: null, status: 204 });
    await useAppStore.getState().completeWorkout();
    expect(useAppStore.getState().currentWorkout).toBeNull();

    // Back on Today: the totals still show, but done waits for the read.
    expect(recallTodayDay('user-1', '2026-09-30', null, getWorkoutWriteSeq())).toEqual({ ...day, todayDone: undefined });
  });
});
