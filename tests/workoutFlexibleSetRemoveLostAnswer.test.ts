import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlexiblePlanItem, Workout, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://flexible-set-remove.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});

import { resetAppData, useAppStore } from '@/stores/appStore';

// In a flexible session the movement sheet's − lowers the movement's target
// sets (updateFlexibleExerciseMeta), which deletes the unlogged sets above it.
// On weak signal the server can delete a set while the phone hears only an
// error; the next − must still clear that set from the workout.

const makeSet = (number: number): WorkoutSet => ({
  id: `set-${number}`, workout_id: 'workout-1', exercise_id: 'bench', set_number: number,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
});
const plan: FlexiblePlanItem = {
  exercise_id: 'bench', exercise_name: 'Bench', order: 0, target_sets: 3,
  target_reps_min: 8, target_reps_max: 12, notes: null, hidden: false, superset_group_id: null,
};
const makeWorkout = (sets: WorkoutSet[]): Workout => ({
  id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-11-04', notes: null, completed: false, sets,
});

let rows: WorkoutSet[];
let loseDeleteAnswer: boolean;
let readError: boolean;

const ids = (url: URL) => (url.searchParams.get('id') ?? '').replace(/^in\.\(|\)$/g, '').split(',').map((id) => id.replace(/"/g, ''));

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  loseDeleteAnswer = false;
  readError = false;
  rows = [{ ...makeSet(1), completed: true, weight: 100, reps: 8 }, { ...makeSet(2), completed: true, weight: 100, reps: 8 }, makeSet(3)];
  useAppStore.setState({
    currentWorkout: makeWorkout(rows.map((row) => ({ ...row }))),
    currentWorkoutDayPlan: { id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items: [plan] },
  });

  // The plan row echoes what was written; the sets table honours the id and completed filters.
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname === '/rest/v1/workout_day_plans' && method === 'PATCH') {
      const { items } = JSON.parse(String(init?.body)) as { items: FlexiblePlanItem[] };
      return Response.json({ id: 'plan-1', workout_id: 'workout-1', day_label: 'Flex', items });
    }
    if (url.pathname !== '/rest/v1/sets' || !['DELETE', 'GET'].includes(method)) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    const wanted = ids(url);
    if (method === 'GET') {
      if (readError) return Response.json({ message: 'offline' }, { status: 500 });
      return Response.json(rows.filter((row) => wanted.includes(row.id)).map((row) => ({ id: row.id, completed: row.completed })));
    }
    const onlyUnlogged = url.searchParams.get('completed') === 'eq.false';
    const deleted = rows.filter((row) => wanted.includes(row.id) && (!onlyUnlogged || !row.completed));
    rows = rows.filter((row) => !deleted.includes(row));
    if (loseDeleteAnswer) {
      // The server committed the delete, but its answer never reached the phone.
      loseDeleteAnswer = false;
      throw new TypeError('Network request failed');
    }
    return Response.json(deleted.map((row) => ({ id: row.id })));
  });
});

afterEach(() => vi.restoreAllMocks());

const shownIds = () => useAppStore.getState().currentWorkout?.sets.map((set) => set.id);
const lower = () => useAppStore.getState().updateFlexibleExerciseMeta('bench', { target_sets: 2 });

describe('lowering a flexible movement\'s sets', () => {
  it('removes an unlogged set from the server and the workout', async () => {
    await lower();

    expect(rows.map((row) => row.id)).toEqual(['set-1', 'set-2']);
    expect(shownIds()).toEqual(['set-1', 'set-2']);
  });

  it('clears a set an earlier attempt already deleted when its answer was lost', async () => {
    loseDeleteAnswer = true;

    // The phone heard nothing back, so it still shows set 3; the sheet says "Set not removed".
    await expect(lower()).rejects.toThrow('Could not remove the workout sets');
    expect(rows.map((row) => row.id)).toEqual(['set-1', 'set-2']);
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);

    // − again: nothing left to delete, and the read finds set 3 gone.
    await lower();
    expect(shownIds()).toEqual(['set-1', 'set-2']);
  });

  it('keeps a set logged meanwhile when the delete removes nothing', async () => {
    // Log set for set 3 landed on the server; its save has not returned yet.
    rows = rows.map((row) => (row.id === 'set-3' ? { ...row, completed: true, weight: 100, reps: 7 } : row));

    await lower();

    expect(rows.find((row) => row.id === 'set-3')).toMatchObject({ completed: true, reps: 7 });
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('keeps the set when nothing was deleted and it cannot be read back', async () => {
    rows = rows.filter((row) => row.id !== 'set-3');
    readError = true;

    await lower();

    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
  });
});
