import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlexDayTemplate, MacroTarget, VolumeLandmark, WhoopConnection, Workout } from '@/types';

type Result = { data: unknown; error: unknown };
type Write = { table: string; op: string; payload: unknown; filters: unknown[][] };

// Every builder method chains; the terminal call (single, maybeSingle or
// awaiting the builder) sends the request, logs it and answers with the next
// result queued for its table.
const backend = vi.hoisted(() => {
  const queues = new Map<string, Array<() => Promise<Result>>>();
  const sent: string[] = [];
  const writes: Write[] = [];
  const from = (table: string) => {
    let op = 'select';
    let payload: unknown;
    const filters: unknown[][] = [];
    let answer: Promise<Result> | undefined;
    const settle = () => {
      if (!answer) {
        sent.push(`${table}.${op}`);
        if (op !== 'select') writes.push({ table, op, payload, filters });
        answer = queues.get(table)?.shift()?.() ?? Promise.resolve({ data: null, error: null });
      }
      return answer;
    };
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'neq', 'gte', 'lte', 'order', 'limit']) query[method] = () => query;
    query.eq = (...args: unknown[]) => { filters.push(args); return query; };
    for (const method of ['insert', 'update', 'upsert', 'delete']) {
      query[method] = (value?: unknown) => { op = method; payload = value; return query; };
    }
    query.single = settle;
    query.maybeSingle = settle;
    query.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => settle().then(resolve, reject);
    return query;
  };
  return {
    queues,
    sent,
    writes,
    client: {
      from,
      auth: { getSession: vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } }, error: null })) },
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: backend.client }));

import { resetAppData, useAppStore } from '@/stores/appStore';

function answer(table: string, data: unknown, error: unknown = null) {
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => Promise.resolve({ data, error }));
  backend.queues.set(table, queue);
}

function reject(table: string, reason: unknown) {
  const queue = backend.queues.get(table) ?? [];
  queue.push(() => Promise.reject(reason));
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
const clone = <T>(value: T): T => structuredClone(value);

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T12:00:00'));
  backend.client.auth.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
  backend.queues.clear();
  backend.sent.length = 0;
  backend.writes.length = 0;
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
  resetAppData();
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
});

describe('reads that changed nothing keep the stored data', () => {
  const target: MacroTarget = {
    id: 'target-1', user_id: 'user-1', calories: 2400, protein: 180, carbs: 250, fat: 70,
    source: 'calculated', updated_at: '2026-11-01T08:00:00.000Z',
  };

  it('fetchMacroTarget keeps an unchanged target and still marks it loaded', async () => {
    useAppStore.setState({ macroTarget: target, macroTargetLoadedForUserId: null });
    answer('macro_targets', clone(target));

    await useAppStore.getState().fetchMacroTarget();

    expect(useAppStore.getState().macroTarget).toBe(target);
    expect(useAppStore.getState().macroTargetLoadedForUserId).toBe('user-1');

    const changed = { ...target, calories: 2300 };
    answer('macro_targets', changed);
    await useAppStore.getState().fetchMacroTarget();
    expect(useAppStore.getState().macroTarget).toBe(changed);

    // A successful empty read still clears it.
    answer('macro_targets', null);
    await useAppStore.getState().fetchMacroTarget();
    expect(useAppStore.getState().macroTarget).toBeNull();
    expect(useAppStore.getState().macroTargetLoadedForUserId).toBe('user-1');
  });

  it('fetchWhoopConnection keeps an unchanged connection and returns the row it read', async () => {
    const connection: WhoopConnection = {
      user_id: 'user-1', whoop_user_id: 'whoop-1', scopes: 'read:workout offline',
      connected_at: '2026-10-01T08:00:00.000Z', last_synced_at: '2026-11-04T07:00:00.000Z',
      last_sync_status: 'ok', updated_at: '2026-11-04T07:00:00.000Z',
    };
    useAppStore.setState({ whoopConnection: connection });
    const reread = clone(connection);
    answer('whoop_connections', reread);

    expect(await useAppStore.getState().fetchWhoopConnection()).toBe(reread);
    expect(useAppStore.getState().whoopConnection).toBe(connection);

    const synced = { ...connection, last_synced_at: '2026-11-04T11:00:00.000Z' };
    answer('whoop_connections', synced);
    await useAppStore.getState().fetchWhoopConnection();
    expect(useAppStore.getState().whoopConnection).toBe(synced);

    answer('whoop_connections', null);
    expect(await useAppStore.getState().fetchWhoopConnection()).toBeNull();
    expect(useAppStore.getState().whoopConnection).toBeNull();
  });

  it('fetchFlexTemplates keeps unchanged templates', async () => {
    const row = {
      id: 'template-1', user_id: 'user-1', label: 'Arms',
      items: [{ exercise_id: 'curl', order: 0, exercise_name: 'Curl', target_sets: 3 }],
    };
    answer('flex_day_templates', [row]);
    await useAppStore.getState().fetchFlexTemplates();
    const first: FlexDayTemplate[] = useAppStore.getState().flexTemplates;
    expect(first).toHaveLength(1);

    answer('flex_day_templates', [clone(row)]);
    await useAppStore.getState().fetchFlexTemplates({ force: true });
    expect(useAppStore.getState().flexTemplates).toBe(first);

    answer('flex_day_templates', [{ ...row, label: 'Arms day' }]);
    await useAppStore.getState().fetchFlexTemplates({ force: true });
    expect(useAppStore.getState().flexTemplates).not.toBe(first);
    expect(useAppStore.getState().flexTemplates[0].label).toBe('Arms day');
  });

  it('calculateWeeklyVolume replaces only the slices that changed', async () => {
    const landmarks: VolumeLandmark[] = [
      { id: 'lm-chest', user_id: 'user-1', muscle_group: 'chest', mv: 4, mev: 8, mav_low: 12, mav_high: 16, mrv: 20 },
    ];
    const week = [{ id: 'w-1', sets: [{ completed: true, exercise: { muscle_group: 'chest', muscle_group_secondary: 'triceps' } }] }];
    answer('workouts', week);
    answer('volume_landmarks', landmarks);
    await useAppStore.getState().calculateWeeklyVolume();
    const { weeklyVolume, volumeLandmarks } = useAppStore.getState();
    expect(weeklyVolume.map((entry) => [entry.muscle_group, entry.weekly_sets])).toEqual([['chest', 1], ['triceps', 0.5]]);

    // Same week, same landmarks: nothing is replaced.
    answer('workouts', clone(week));
    answer('volume_landmarks', clone(landmarks));
    await useAppStore.getState().calculateWeeklyVolume();
    expect(useAppStore.getState().weeklyVolume).toBe(weeklyVolume);
    expect(useAppStore.getState().volumeLandmarks).toBe(volumeLandmarks);

    // Another set logged: the volume changes, the landmarks stay put.
    answer('workouts', [...clone(week), { id: 'w-2', sets: [{ completed: true, exercise: { muscle_group: 'chest', muscle_group_secondary: null } }] }]);
    answer('volume_landmarks', clone(landmarks));
    await useAppStore.getState().calculateWeeklyVolume();
    expect(useAppStore.getState().weeklyVolume).not.toBe(weeklyVolume);
    expect(useAppStore.getState().weeklyVolume[0].weekly_sets).toBe(2);
    expect(useAppStore.getState().volumeLandmarks).toBe(volumeLandmarks);

    // A landmark edit regrades the week and replaces both.
    const raised = [{ ...landmarks[0], mv: 1, mev: 2, mav_low: 3, mav_high: 4, mrv: 5 }];
    const graded = useAppStore.getState().weeklyVolume;
    answer('workouts', [...clone(week), { id: 'w-2', sets: [{ completed: true, exercise: { muscle_group: 'chest', muscle_group_secondary: null } }] }]);
    answer('volume_landmarks', raised);
    await useAppStore.getState().calculateWeeklyVolume();
    expect(useAppStore.getState().volumeLandmarks).toBe(raised);
    expect(useAppStore.getState().weeklyVolume).not.toBe(graded);
    expect(useAppStore.getState().weeklyVolume[0].landmark).toBe(raised[0]);
  });
});

describe('startWorkout reads the day while checking for a workout to resume', () => {
  const splitExercises = [
    { exercise_id: 'squat', target_sets: 2, exercise_order: 0 },
    { exercise_id: 'press', target_sets: 1, exercise_order: 1 },
  ];
  const inserted = {
    id: 'workout-new', user_id: 'user-1', split_day_id: 'day-1', date: '2026-11-04',
    notes: null, completed: false, created_at: '2026-11-04T12:00:00.000Z',
  };
  const complete: Workout = { ...inserted, sets: [] };

  it('sends the day read before the resume check answers and writes the same rows in order', async () => {
    const releaseExisting = hold('workouts');
    answer('workouts', inserted);
    answer('workouts', complete);
    answer('split_exercises', splitExercises);

    const start = useAppStore.getState().startWorkout('day-1');
    await flush();
    expect(backend.sent).toEqual(['workouts.select', 'split_exercises.select']);
    releaseExisting({ data: null, error: null });

    expect(await start).toBe(complete);
    expect(backend.sent).toEqual(['workouts.select', 'split_exercises.select', 'workouts.insert', 'sets.insert', 'workouts.select']);
    expect(backend.writes.map(({ table, op, payload }) => ({ table, op, payload }))).toEqual([
      { table: 'workouts', op: 'insert', payload: { user_id: 'user-1', split_day_id: 'day-1', date: '2026-11-04', completed: false } },
      {
        table: 'sets',
        op: 'insert',
        payload: [['squat', 1], ['squat', 2], ['press', 1]].map(([exercise_id, set_number]) => ({
          workout_id: 'workout-new', exercise_id, set_number, completed: false,
        })),
      },
    ]);
    expect(useAppStore.getState().currentWorkout).toBe(complete);
  });

  it('discards the started workout when the day read failed', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answer('workouts', null);
    answer('workouts', inserted);
    answer('split_exercises', null, { message: 'offline' });

    await expect(useAppStore.getState().startWorkout('day-1')).rejects.toThrow("Couldn't start the workout");

    expect(backend.writes.map(({ table, op, payload, filters }) => ({ table, op, payload, filters }))).toEqual([
      { table: 'workouts', op: 'insert', payload: { user_id: 'user-1', split_day_id: 'day-1', date: '2026-11-04', completed: false }, filters: [] },
      { table: 'workouts', op: 'delete', payload: undefined, filters: [['id', 'workout-new']] },
    ]);
    expect(useAppStore.getState().currentWorkout).toBeNull();
    quiet.mockRestore();
  });

  it('rejects with a thrown day read after the workout is saved, as before', async () => {
    answer('workouts', null);
    answer('workouts', inserted);
    const thrown = new Error('socket closed');
    reject('split_exercises', thrown);

    await expect(useAppStore.getState().startWorkout('day-1')).rejects.toBe(thrown);
    expect(backend.writes.map(({ table, op }) => `${table}.${op}`)).toEqual(['workouts.insert']);
  });

  it('resumes a workout without using the day read, and an unused failed read stays handled', async () => {
    const existing: Workout = {
      ...inserted, id: 'workout-live', created_at: '2026-11-04T11:00:00.000Z',
      sets: [{ id: 'set-1', workout_id: 'workout-live', exercise_id: 'squat', set_number: 1, weight: 100, reps: 5, rpe: null, completed: true, completed_at: '2026-11-04T11:10:00.000Z' }],
    };
    answer('workouts', existing);
    reject('split_exercises', new Error('offline'));

    expect(await useAppStore.getState().startWorkout('day-1')).toBe(existing);
    await flush();
    await flush();

    expect(backend.writes).toEqual([]);
    expect(useAppStore.getState().currentWorkout).toBe(existing);
    expect(unhandled).toEqual([]);
  });

  it('leaves a failed resume check with an unused day read handled', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    answer('workouts', null, { message: 'offline' });
    reject('split_exercises', new Error('offline'));

    await expect(useAppStore.getState().startWorkout('day-1')).rejects.toThrow("Couldn't start the workout");
    await flush();
    await flush();

    expect(backend.writes).toEqual([]);
    expect(unhandled).toEqual([]);
    quiet.mockRestore();
  });
});
