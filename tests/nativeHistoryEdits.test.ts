import * as dateFns from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import { captureAccountScope, invalidateAccountScope } from '@/lib/accountScope';
import { runWorkoutEdit } from '@/lib/workoutEdit';
import * as workoutNotes from '@/lib/workoutNotes';
import { moveHistoryMovement, orderHistoryMovements, type HistoryWorkout } from '@/lib/historyMonth';
import type { StoreApi, UseBoundStore } from 'zustand';
import type { ActivitySession, WorkoutDayPlan, WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

// native/src/lib/history.ts as this test uses it. Written out here: importing
// its types would bring React Native's global types (its own fetch) into the
// test build and break other tests' fetch mocks.
type History = {
  useHistoryStore: UseBoundStore<StoreApi<{
    month: Date;
    day: string;
    workouts: HistoryWorkout[];
    activities: ActivitySession[];
    plans: Record<string, WorkoutDayPlan | null>;
    loading: boolean;
    failed: boolean;
  }>>;
  resetHistory: () => void;
  loadHistoryMonth: (month?: Date) => Promise<void>;
  selectHistoryDay: (date: Date) => void;
  followToday: (now?: Date) => boolean;
  loadPlan: (workoutId: string) => Promise<void>;
  editPastWorkout: (workoutId: string, mutate: () => Promise<void>) => Promise<boolean>;
  savePastNote: (workoutId: string, exerciseId: string, text: string) => Promise<boolean>;
  movePastMovement: (workoutId: string, exerciseId: string, direction: -1 | 1) => Promise<void>;
  deletePastWorkout: (workoutId: string) => Promise<boolean>;
  attachStats: (workout: HistoryWorkout, activity: ActivitySession) => Promise<boolean>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const set = (id: string, exerciseId: string, completed = true): WorkoutSet => ({
  id, workout_id: 'w1', exercise_id: exerciseId, set_number: 1, weight: 100, reps: 5, rpe: null, completed,
  completed_at: completed ? '2026-11-02T18:30:00.000Z' : null,
}) as WorkoutSet;
const workout = (id: string, sets: WorkoutSet[], extra: Partial<HistoryWorkout> = {}): HistoryWorkout => ({
  id, user_id: 'u1', date: '2026-11-02', created_at: '2026-11-02T18:00:00.000Z', completed: true, notes: null,
  split_day_id: null, sets, split_day: null, day_label: null, ...extra,
}) as HistoryWorkout;
const plan = (label: string): WorkoutDayPlan => ({ id: `plan-${label}`, workout_id: 'w1', day_label: label, items: [] }) as unknown as WorkoutDayPlan;

// What the server holds, which the store mock reads and writes.
let server: { notes: string | null; workouts: Map<string, HistoryWorkout> };
let reloadFails: boolean;
// Set while a reload reads the workout, so a plan read can tell it belongs to a reload.
let reloading = false;
let planRead: (options?: { throwOnError?: boolean }, inReload?: boolean) => Promise<WorkoutDayPlan | null>;
let monthRead: ReturnType<typeof vi.fn>;
let bump: ReturnType<typeof vi.fn>;
let history: History;
let savedPlan: WorkoutDayPlan;

const store = {
  fetchWorkoutById: vi.fn(async (id: string) => {
    reloading = true;
    return reloadFails ? null : { ...server.workouts.get(id)!, notes: server.notes };
  }),
  fetchWorkoutDayPlanByWorkoutId: vi.fn((_id: string, options?: { throwOnError?: boolean }) => {
    const inReload = reloading;
    reloading = false;
    return planRead(options, inReload);
  }),
  syncWorkoutCompletion: vi.fn(async (id: string) => {
    const row = server.workouts.get(id)!;
    const completed = row.completed || row.sets.every((entry) => entry.completed);
    server.workouts.set(id, { ...row, completed });
    return { totalSets: row.sets.length, completedSets: row.sets.filter((entry) => entry.completed).length, completed };
  }),
  updateWorkoutNotes: vi.fn(async (_id: string, notes: string | null) => { server.notes = notes; }),
  calculateWeeklyVolume: vi.fn(async () => {}),
  deleteWorkout: vi.fn(async (id: string) => { server.workouts.delete(id); }),
  attachWhoopToWorkout: vi.fn(async (): Promise<HistoryWorkout> => { throw new Error('Could not finish attaching the WHOOP stats. Try again.'); }),
  addSetToWorkout: vi.fn(async (id: string, exerciseId: string) => {
    const row = server.workouts.get(id)!;
    const added = set(`added-${row.sets.length}`, exerciseId, false);
    server.workouts.set(id, { ...row, sets: [...row.sets, added] });
    return added;
  }),
  reorderWorkoutExercises: vi.fn(async (_id: string, ids: string[]) => {
    const items = [...savedPlan.items].sort((a, b) => ids.indexOf(a.exercise_id) - ids.indexOf(b.exercise_id));
    savedPlan = { ...savedPlan, items: items.map((item, order) => ({ ...item, order })) };
  }),
  updateSet: vi.fn(async (setId: string, updates: Partial<WorkoutSet>) => {
    server.workouts.forEach((row, id) => {
      server.workouts.set(id, { ...row, sets: row.sets.map((entry) => (entry.id === setId ? { ...entry, ...updates } : entry)) });
    });
  }),
};

const supabase = {
  from: (table: string) => {
    expect(table).toBe('workouts');
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { notes: server.notes }, error: null }),
    };
    return chain;
  },
};

function load(): History {
  return loadNativeModule<History>('lib/history.ts', {
    'date-fns': dateFns,
    'react-native': { Alert: { alert: vi.fn() } },
    zustand: { create },
    '@/lib/accountScope': { captureAccountScope },
    '@/lib/activitySessions': { guardActivityEdit: (input: unknown) => input, resolveActivityTitle: () => 'Run' },
    '@/lib/historyMonth': {
      fetchHistoryMonth: (...args: unknown[]) => monthRead(...args),
      historyDayKey: (row: HistoryWorkout) => row.date,
      moveHistoryMovement,
      orderHistoryMovements,
    },
    '@/lib/supabase': { supabase },
    '@/lib/whoopStatus': { whoopSyncMessage: () => '' },
    '@/lib/workoutEdit': { runWorkoutEdit },
    '@/lib/workoutNotes': workoutNotes,
    '@/stores/appStore': { useAppStore: { getState: () => store } },
    './accountData': { useWorkoutsRevision: { getState: () => ({ bump }) } },
    './haptics': { haptics: { success: vi.fn(), error: vi.fn() } },
  });
}

/** Puts these workouts on screen (and on the server) as a finished month read would. */
async function show(...rows: HistoryWorkout[]) {
  rows.forEach((row) => server.workouts.set(row.id, row));
  monthRead.mockResolvedValueOnce({ workouts: rows, activities: [] });
  await history.loadHistoryMonth();
}

const shown = (id: string) => history.useHistoryStore.getState().workouts.find((row) => row.id === id);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  invalidateAccountScope();
  server = { notes: null, workouts: new Map() };
  reloadFails = false;
  reloading = false;
  planRead = async () => null;
  monthRead = vi.fn();
  bump = vi.fn();
  Object.values(store).forEach((mock) => mock.mockClear());
  history = load();
  history.resetHistory();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('past workout notes', () => {
  it('keeps the other movements’ notes when the reload after a note failed', async () => {
    await show(workout('w1', [set('s1', 'bench'), set('s2', 'row')]));

    reloadFails = true;
    await expect(history.savePastNote('w1', 'bench', 'Pause at the chest')).resolves.toBe(true);
    reloadFails = false;
    await expect(history.savePastNote('w1', 'row', 'Straps next time')).resolves.toBe(true);

    expect(workoutNotes.parseWorkoutNotes(server.notes).movementNotes).toEqual({ bench: 'Pause at the chest', row: 'Straps next time' });
    expect(workoutNotes.parseWorkoutNotes(shown('w1')!.notes).movementNotes).toEqual({ bench: 'Pause at the chest', row: 'Straps next time' });
  });

  it('shows a saved note even when the reload after it fails', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    reloadFails = true;
    await history.savePastNote('w1', 'bench', 'Felt quick');
    expect(workoutNotes.parseWorkoutNotes(shown('w1')!.notes).movementNotes).toEqual({ bench: 'Felt quick' });
  });
});

describe('a month read that answers late', () => {
  it('keeps a set added after the read started', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    const late = deferred<{ workouts: HistoryWorkout[]; activities: [] }>();
    monthRead.mockReturnValueOnce(late.promise);
    const reading = history.loadHistoryMonth();

    await history.editPastWorkout('w1', async () => { await store.addSetToWorkout('w1', 'bench'); });
    expect(shown('w1')!.sets).toHaveLength(2);

    late.resolve({ workouts: [workout('w1', [set('s1', 'bench')])], activities: [] });
    await reading;
    expect(shown('w1')!.sets.map((entry) => entry.id)).toEqual(['s1', 'added-1']);
  });

  it('does not bring back a workout deleted after the read started', async () => {
    await show(workout('w1', [set('s1', 'bench')]), workout('w2', [set('s9', 'squat')]));
    const late = deferred<{ workouts: HistoryWorkout[]; activities: [] }>();
    monthRead.mockReturnValueOnce(late.promise);
    const reading = history.loadHistoryMonth();

    await expect(history.deletePastWorkout('w2')).resolves.toBe(true);
    late.resolve({ workouts: [workout('w1', [set('s1', 'bench')]), workout('w2', [set('s9', 'squat')])], activities: [] });
    await reading;
    expect(history.useHistoryStore.getState().workouts.map((row) => row.id)).toEqual(['w1']);
  });

  it('keeps a workout whose edit landed while its month was briefly off screen', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    const slowEdit = deferred<void>();
    const editing = history.editPastWorkout('w1', () => slowEdit.promise);

    // Over to October and straight back to November while the edit runs.
    monthRead.mockResolvedValueOnce({ workouts: [], activities: [] });
    await history.loadHistoryMonth(new Date(2026, 9, 1));
    const back = deferred<{ workouts: HistoryWorkout[]; activities: [] }>();
    monthRead.mockReturnValueOnce(back.promise);
    const reading = history.loadHistoryMonth(new Date(2026, 10, 1));

    slowEdit.resolve();
    await editing;
    back.resolve({ workouts: [workout('w1', [set('s1', 'bench')])], activities: [] });
    await reading;
    expect(history.useHistoryStore.getState().workouts.map((row) => row.id)).toEqual(['w1']);
  });

  it('still takes rows nothing changed since it started', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    await history.editPastWorkout('w1', async () => {});
    monthRead.mockResolvedValueOnce({ workouts: [workout('w1', [set('s1', 'bench'), set('s2', 'bench')])], activities: [] });
    await history.loadHistoryMonth();
    expect(shown('w1')!.sets).toHaveLength(2);
  });
});

describe('Today and Train follow History', () => {
  it('tells them when a workout is deleted', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    await history.deletePastWorkout('w1');
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('tells them when an edit finishes an unfinished workout, and not for other edits', async () => {
    await show(workout('w1', [set('s1', 'bench'), set('s2', 'bench', false)], { completed: false }));
    await history.editPastWorkout('w1', async () => { await store.addSetToWorkout('w1', 'bench'); });
    expect(bump).not.toHaveBeenCalled();

    await history.editPastWorkout('w1', async () => { await store.updateSet('s2', { completed: true }); });
    expect(bump).not.toHaveBeenCalled();
    await history.editPastWorkout('w1', async () => { await store.updateSet('added-2', { completed: true }); });
    expect(bump).toHaveBeenCalledTimes(1);
  });
});

describe('deleting a workout with WHOOP stats', () => {
  const whoopRun = { id: 'a1', date: '2026-11-02', source: 'whoop', activity_type: 'run' } as ActivitySession;

  it('reads the month again, so the activity whose stats it carried is back on its day', async () => {
    await show(workout('w1', [set('s1', 'bench')], { whoop_session_id: 'a1' }));
    // The store brings the activity back as it deletes the workout.
    monthRead.mockResolvedValueOnce({ workouts: [], activities: [whoopRun] });

    await expect(history.deletePastWorkout('w1')).resolves.toBe(true);
    await vi.waitFor(() => expect(history.useHistoryStore.getState().activities).toEqual([whoopRun]));
    expect(shown('w1')).toBeUndefined();
  });

  it('keeps the activity on its day when attaching its stats did not finish', async () => {
    const lift = workout('w1', [set('s1', 'bench')]);
    server.workouts.set('w1', lift);
    monthRead.mockResolvedValueOnce({ workouts: [lift], activities: [whoopRun] });
    await history.loadHistoryMonth();

    await expect(history.attachStats(lift, whoopRun)).resolves.toBe(false);
    expect(history.useHistoryStore.getState().activities).toEqual([whoopRun]);
    expect(shown('w1')!.whoop_session_id).toBeUndefined();
  });

  it('reads nothing again for a workout without WHOOP stats', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    monthRead.mockClear();
    await history.deletePastWorkout('w1');
    expect(monthRead).not.toHaveBeenCalled();
  });
});

describe('a past workout’s plan', () => {
  it('keeps the plan shown when the reload’s plan read fails', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    planRead = async () => plan('Push');
    await history.loadPlan('w1');
    expect(history.useHistoryStore.getState().plans.w1?.day_label).toBe('Push');

    planRead = async (options) => {
      if (options?.throwOnError) throw new Error('offline');
      return null;
    };
    await history.editPastWorkout('w1', async () => {});
    expect(history.useHistoryStore.getState().plans.w1?.day_label).toBe('Push');
  });

  it('reads the plan again each time the workout opens, and retries after a failed read', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    planRead = async (options) => {
      if (options?.throwOnError) throw new Error('offline');
      return null;
    };
    await history.loadPlan('w1');
    expect('w1' in history.useHistoryStore.getState().plans).toBe(false);

    planRead = async () => plan('Push');
    await history.loadPlan('w1');
    expect(history.useHistoryStore.getState().plans.w1?.day_label).toBe('Push');
    planRead = async () => plan('Push B');
    await history.loadPlan('w1');
    expect(history.useHistoryStore.getState().plans.w1?.day_label).toBe('Push B');
  });

  it('drops an open’s plan read that an edit’s reload overtook', async () => {
    await show(workout('w1', [set('s1', 'bench')]));
    const slow = deferred<WorkoutDayPlan | null>();
    planRead = () => slow.promise;
    const opening = history.loadPlan('w1');
    planRead = async () => plan('After edit');
    await history.editPastWorkout('w1', async () => {});
    slow.resolve(plan('Before edit'));
    await opening;
    expect(history.useHistoryStore.getState().plans.w1?.day_label).toBe('After edit');
  });
});

describe('History’s day', () => {
  it('moves on to the new today when it was left on today past midnight', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 30, 22, 0));
    history.resetHistory();
    monthRead.mockResolvedValue({ workouts: [], activities: [] });
    await history.loadHistoryMonth();
    expect(history.useHistoryStore.getState().day).toBe('2026-11-30');

    vi.setSystemTime(new Date(2026, 11, 1, 7, 0));
    expect(history.followToday()).toBe(true);
    expect(history.useHistoryStore.getState()).toMatchObject({ day: '2026-12-01' });
    expect(dateFns.format(history.useHistoryStore.getState().month, 'yyyy-MM')).toBe('2026-12');
    expect(monthRead).toHaveBeenLastCalledWith(new Date(2026, 11, 1));
    expect(history.followToday()).toBe(false);
  });

  it('stays on a day the person picked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 20, 22, 0));
    history.resetHistory();
    monthRead.mockResolvedValue({ workouts: [], activities: [] });
    history.selectHistoryDay(new Date(2026, 10, 12));
    vi.setSystemTime(new Date(2026, 10, 21, 7, 0));
    expect(history.followToday()).toBe(false);
    expect(history.useHistoryStore.getState().day).toBe('2026-11-12');
  });
});

describe('moving a past movement', () => {
  const planned = (ids: string[]): WorkoutDayPlan => ({
    id: 'plan-1', workout_id: 'w1', day_label: 'Push',
    items: ids.map((exercise_id, order) => ({ exercise_id, exercise_name: exercise_id, order, target_sets: 1, hidden: false })),
  }) as unknown as WorkoutDayPlan;
  const order = () => savedPlan.items.map((item) => item.exercise_id);

  it('builds a second move on the first, even when the first one’s reload missed the plan', async () => {
    savedPlan = planned(['a', 'b', 'c']);
    planRead = async () => savedPlan;
    await show(workout('w1', [set('s1', 'a'), set('s2', 'b'), set('s3', 'c')]));
    await history.loadPlan('w1');

    // The reload after each move cannot read the plan; the moves still read it.
    planRead = async (_options, inReload) => {
      if (inReload) throw new Error('offline');
      return savedPlan;
    };
    const first = history.editPastWorkout('w1', () => history.movePastMovement('w1', 'c', -1));
    const second = history.editPastWorkout('w1', () => history.movePastMovement('w1', 'c', -1));
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(order()).toEqual(['c', 'a', 'b']);
  });

  it('leaves the order alone when the movement is already at the end', async () => {
    savedPlan = planned(['a', 'b']);
    planRead = async () => savedPlan;
    await show(workout('w1', [set('s1', 'a'), set('s2', 'b')]));
    await history.editPastWorkout('w1', () => history.movePastMovement('w1', 'a', -1));
    expect(store.reorderWorkoutExercises).not.toHaveBeenCalled();
  });
});
