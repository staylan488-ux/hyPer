import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivitySession, Workout } from '@/types';

// A WHOOP activity whose stats go onto a workout is hidden (dismissed_at) so
// it does not show twice. Whatever undoes or half-finishes that link must
// never leave the activity hidden with no workout carrying its stats.

const supabaseMock = vi.hoisted(() => ({ from: vi.fn(), auth: { getSession: vi.fn(), getUser: vi.fn() } }));
vi.mock('@/lib/supabase', () => ({ supabase: supabaseMock }));
vi.mock('@/lib/whoopClient', () => ({ fetchWhoopBatchRemote: vi.fn(), startWhoopConnect: vi.fn(), disconnectWhoopRemote: vi.fn() }));

import { useAppStore } from '@/stores/appStore';

type Write = { table: string; op: 'delete' | 'update' | 'select'; values?: Record<string, unknown>; filters: Record<string, unknown>; columns?: string };
type Answer = { data?: unknown; error?: { code?: string; message: string } | null };

// Every request in order, and how the server answers each (by table and op).
let requests: Write[];
let answer: (request: Write) => Answer;

function query(table: string) {
  const request: Write = { table, op: 'select', filters: {} };
  const builder = {
    delete: () => { request.op = 'delete'; return builder; },
    update: (values: Record<string, unknown>) => { request.op = 'update'; request.values = values; return builder; },
    select: (columns?: string) => { request.columns = columns; return builder; },
    eq: (column: string, value: unknown) => { request.filters[column] = value; return builder; },
    single: () => builder,
    maybeSingle: () => builder,
    then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => {
      requests.push(request);
      return Promise.resolve({ data: null, error: null, ...answer(request) }).then(resolve, reject);
    },
  };
  return builder;
}

const workout = (extra: Partial<Workout> = {}): Workout => ({
  id: 'w1', user_id: 'user-1', split_day_id: null, date: '2026-11-02', notes: null, completed: true, sets: [], ...extra,
}) as Workout;
const whoopActivity = { id: 'a1', user_id: 'user-1', source: 'whoop', strain: 11.2, avg_hr: 131, max_hr: 168, energy_kcal: 412 } as ActivitySession;
const failure = { message: 'network down' };
const writesTo = (table: string) => requests.filter((request) => request.table === table && request.op !== 'select');

beforeEach(() => {
  requests = [];
  answer = () => ({});
  supabaseMock.from.mockReset().mockImplementation(query);
  supabaseMock.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
  useAppStore.setState({ currentWorkout: null, currentWorkoutDayPlan: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('deleting a workout that carries WHOOP stats', () => {
  it('brings its WHOOP activity back to the day', async () => {
    answer = (request) => (request.table === 'workouts' ? { data: [{ whoop_session_id: 'a1', user_id: 'user-1' }] } : {});

    await useAppStore.getState().deleteWorkout('w1');

    const [restore] = writesTo('activity_sessions');
    expect(restore).toMatchObject({ op: 'update', values: { dismissed_at: null }, filters: { id: 'a1', user_id: 'user-1' } });
    // After the workout is gone, never before.
    expect(requests.map((request) => request.table)).toEqual(['workouts', 'activity_sessions']);
  });

  it('brings it back after the delete that falls back to removing sets first', async () => {
    let attempts = 0;
    answer = (request) => {
      if (request.table !== 'workouts') return {};
      attempts += 1;
      return attempts === 1 ? { error: { code: '23503', message: 'foreign key violation' } } : { data: [{ whoop_session_id: 'a1', user_id: 'user-1' }] };
    };

    await useAppStore.getState().deleteWorkout('w1');

    expect(writesTo('sets')).toHaveLength(1);
    expect(writesTo('activity_sessions')).toEqual([expect.objectContaining({ values: expect.objectContaining({ dismissed_at: null }), filters: { id: 'a1', user_id: 'user-1' } })]);
  });

  it('touches no activity when the workout had no WHOOP stats', async () => {
    answer = (request) => (request.table === 'workouts' ? { data: [{ whoop_session_id: null, user_id: 'user-1' }] } : {});

    await useAppStore.getState().deleteWorkout('w1');

    expect(writesTo('activity_sessions')).toEqual([]);
  });

  it('still reports the delete when the activity cannot be brought back', async () => {
    answer = (request) => (request.table === 'workouts' ? { data: [{ whoop_session_id: 'a1', user_id: 'user-1' }] } : { error: failure });

    await expect(useAppStore.getState().deleteWorkout('w1')).resolves.toBeUndefined();
  });

  it('leaves the activity hidden when the workout delete fails', async () => {
    answer = (request) => (request.table === 'workouts' ? { error: { code: '42501', message: 'permission denied' } } : {});

    await expect(useAppStore.getState().deleteWorkout('w1')).rejects.toMatchObject({ code: '42501' });
    expect(writesTo('activity_sessions')).toEqual([]);
  });
});

describe('attaching WHOOP stats to a workout', () => {
  it('reports a failure when the activity could not be hidden, so it never shows beside the stats', async () => {
    const live = workout({ completed: false });
    useAppStore.setState({ currentWorkout: live });
    answer = (request) => (request.table === 'workouts' ? { data: { ...live, whoop_session_id: 'a1', strain: 11.2 } } : { error: failure });

    await expect(useAppStore.getState().attachWhoopToWorkout(live, whoopActivity)).rejects.toThrow('Try again');
    // The stats did land on the workout; the live copy shows them.
    expect(useAppStore.getState().currentWorkout).toMatchObject({ whoop_session_id: 'a1', strain: 11.2 });
  });

  it('a retry finishes the job', async () => {
    let hides = 0;
    answer = (request) => {
      if (request.table === 'workouts') return { data: workout({ whoop_session_id: 'a1' }) };
      hides += 1;
      return hides === 1 ? { error: failure } : {};
    };

    await expect(useAppStore.getState().attachWhoopToWorkout(workout(), whoopActivity)).rejects.toThrow();
    await expect(useAppStore.getState().attachWhoopToWorkout(workout(), whoopActivity)).resolves.toMatchObject({ whoop_session_id: 'a1' });
  });
});

describe('removing WHOOP stats from a workout', () => {
  it('brings the activity back before taking the stats off', async () => {
    answer = (request) => (request.table === 'workouts' ? { data: workout() } : {});

    await useAppStore.getState().detachWhoopFromWorkout(workout({ whoop_session_id: 'a1' }));

    expect(requests.map((request) => `${request.table} ${request.op}`)).toEqual(['activity_sessions update', 'workouts update']);
    expect(requests[0]).toMatchObject({ values: { dismissed_at: null }, filters: { id: 'a1', user_id: 'user-1' } });
  });

  it('keeps the stats on the workout when the activity cannot come back', async () => {
    answer = (request) => (request.table === 'workouts' ? { data: workout() } : { error: failure });

    await expect(useAppStore.getState().detachWhoopFromWorkout(workout({ whoop_session_id: 'a1' }))).rejects.toThrow('Could not remove the WHOOP stats');
    expect(writesTo('workouts')).toEqual([]);
  });
});
