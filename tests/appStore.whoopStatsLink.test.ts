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
  const linked = { data: { whoop_session_id: 'a1', user_id: 'user-1' } };

  it('brings its WHOOP activity back to the day before the workout goes', async () => {
    answer = (request) => (request.table === 'workouts' && request.op === 'select' ? linked : {});

    await useAppStore.getState().deleteWorkout('w1');

    const [restore] = writesTo('activity_sessions');
    expect(restore).toMatchObject({ op: 'update', values: { dismissed_at: null }, filters: { id: 'a1', user_id: 'user-1' } });
    // Before the workout is gone, so no failure after it can leave the activity hidden.
    expect(requests.map((request) => `${request.table} ${request.op}`)).toEqual(['workouts select', 'activity_sessions update', 'workouts delete']);
  });

  it('brings it back before the delete that falls back to removing sets first', async () => {
    let deletes = 0;
    answer = (request) => {
      if (request.table !== 'workouts') return {};
      if (request.op === 'select') return linked;
      deletes += 1;
      return deletes === 1 ? { error: { code: '23503', message: 'foreign key violation' } } : {};
    };

    await useAppStore.getState().deleteWorkout('w1');

    expect(writesTo('sets')).toHaveLength(1);
    expect(writesTo('workouts')).toHaveLength(2);
    expect(writesTo('activity_sessions')).toEqual([expect.objectContaining({ values: expect.objectContaining({ dismissed_at: null }), filters: { id: 'a1', user_id: 'user-1' } })]);
  });

  it('touches no activity when the workout had no WHOOP stats', async () => {
    answer = (request) => (request.table === 'workouts' && request.op === 'select' ? { data: { whoop_session_id: null, user_id: 'user-1' } } : {});

    await useAppStore.getState().deleteWorkout('w1');

    expect(writesTo('activity_sessions')).toEqual([]);
    expect(writesTo('workouts')).toHaveLength(1);
  });

  it('keeps the workout, and its stats, when the activity cannot be brought back', async () => {
    answer = (request) => (request.table === 'workouts' ? linked : { error: failure });

    await expect(useAppStore.getState().deleteWorkout('w1')).rejects.toBe(failure);
    expect(writesTo('workouts')).toEqual([]);
  });

  it('deletes nothing when the workout cannot be read first', async () => {
    answer = (request) => (request.table === 'workouts' ? { error: failure } : {});

    await expect(useAppStore.getState().deleteWorkout('w1')).rejects.toBe(failure);
    expect(writesTo('activity_sessions')).toEqual([]);
    expect(writesTo('workouts')).toEqual([]);
  });

  it('leaves the activity on its day when the delete fails or its answer is lost, and a retry finishes', async () => {
    // The delete lands but its answer is lost: the activity is already back.
    let gone = false;
    answer = (request) => {
      if (request.table !== 'workouts') return {};
      if (request.op === 'select') return gone ? { data: null } : linked;
      gone = true;
      return { error: { message: 'network down' } };
    };
    await expect(useAppStore.getState().deleteWorkout('w1')).rejects.toMatchObject({ message: 'network down' });
    expect(writesTo('activity_sessions')).toHaveLength(1);

    // The retry finds the workout gone and deletes nothing more; the activity stays shown.
    answer = (request) => (request.table === 'workouts' && request.op === 'select' ? { data: null } : {});
    await expect(useAppStore.getState().deleteWorkout('w1')).resolves.toBeUndefined();
    expect(writesTo('activity_sessions')).toHaveLength(1);
  });
});

describe('attaching WHOOP stats to a workout', () => {
  // The hide's answer fails (it may still have landed); what follows on activity_sessions answers as given.
  const hideFails = (after: Answer = {}) => {
    let calls = 0;
    return () => {
      calls += 1;
      return calls === 1 ? { error: failure } : after;
    };
  };

  it('shows the activity again, then takes the stats back off, when its hide went unanswered', async () => {
    const live = workout({ completed: false });
    useAppStore.setState({ currentWorkout: live });
    const activity = hideFails();
    answer = (request) => {
      if (request.table !== 'workouts') return activity();
      return request.values?.whoop_session_id === null ? { data: { ...live, whoop_session_id: null, strain: null } } : { data: { ...live, whoop_session_id: 'a1', strain: 11.2 } };
    };

    await expect(useAppStore.getState().attachWhoopToWorkout(live, whoopActivity)).rejects.toThrow('Try again');
    // A hide that landed is undone before the stats come off, so the activity is never left hidden with nothing holding its stats.
    expect(requests.map((request) => `${request.table} ${request.op}`)).toEqual(['workouts update', 'activity_sessions update', 'activity_sessions update', 'workouts update']);
    expect(writesTo('activity_sessions')[1]).toMatchObject({ values: { dismissed_at: null }, filters: { id: 'a1', user_id: 'user-1' } });
    // Only while the workout still carries this activity's stats, so "Not added" is true and Add is offered again.
    expect(writesTo('workouts')[1]).toMatchObject({
      op: 'update', values: { whoop_session_id: null, strain: null }, filters: { id: 'w1', user_id: 'user-1', whoop_session_id: 'a1' },
    });
    expect(useAppStore.getState().currentWorkout).toMatchObject({ whoop_session_id: null, strain: null });
  });

  it('keeps the stats on the workout when the activity cannot be shown again, so Remove can bring it back', async () => {
    const live = workout({ completed: false });
    useAppStore.setState({ currentWorkout: live });
    answer = (request) => (request.table === 'workouts' ? { data: { ...live, whoop_session_id: 'a1', strain: 11.2 } } : { error: failure });

    await expect(useAppStore.getState().attachWhoopToWorkout(live, whoopActivity)).rejects.toThrow('Try again');
    expect(writesTo('activity_sessions')).toHaveLength(2);
    expect(writesTo('workouts')).toHaveLength(1);
    expect(useAppStore.getState().currentWorkout).toMatchObject({ whoop_session_id: 'a1', strain: 11.2 });
  });

  it('keeps showing the stats that landed when taking them back off fails too', async () => {
    const live = workout({ completed: false });
    useAppStore.setState({ currentWorkout: live });
    const activity = hideFails();
    answer = (request) => {
      if (request.table !== 'workouts') return activity();
      return request.values?.whoop_session_id === null ? { error: failure } : { data: { ...live, whoop_session_id: 'a1', strain: 11.2 } };
    };

    await expect(useAppStore.getState().attachWhoopToWorkout(live, whoopActivity)).rejects.toThrow('Try again');
    expect(writesTo('workouts')).toHaveLength(2);
    // The stats did land on the workout; the live copy shows them.
    expect(useAppStore.getState().currentWorkout).toMatchObject({ whoop_session_id: 'a1', strain: 11.2 });
  });

  it('a retry finishes the job', async () => {
    const activity = hideFails();
    answer = (request) => (request.table === 'workouts' ? { data: workout({ whoop_session_id: 'a1' }) } : activity());

    await expect(useAppStore.getState().attachWhoopToWorkout(workout(), whoopActivity)).rejects.toThrow();
    await expect(useAppStore.getState().attachWhoopToWorkout(workout(), whoopActivity)).resolves.toMatchObject({ whoop_session_id: 'a1' });
    expect(writesTo('activity_sessions').at(-1)).toMatchObject({ values: { dismissed_at: expect.any(String) } });
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
