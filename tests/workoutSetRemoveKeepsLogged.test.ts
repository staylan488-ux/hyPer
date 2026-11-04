import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://workout-set-remove.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});

import { resetAppData, useAppStore } from '@/stores/appStore';

// The movement sheet's − removes the last unlogged set of a program movement
// (removeLastUncompletedSet). A set whose Log set is still saving looks
// unlogged on the phone, so the delete must leave it alone once the server
// has it as logged.

const makeSet = (number: number): WorkoutSet => ({
  id: `set-${number}`, workout_id: 'workout-1', exercise_id: 'bench', set_number: number,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
});
const makeWorkout = (sets: WorkoutSet[]): Workout => ({
  id: 'workout-1', user_id: 'user-1', split_day_id: 'day-1', date: '2026-11-04', notes: null, completed: false, sets,
});

let rows: WorkoutSet[];
let deleteError: boolean;

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  deleteError = false;
  rows = [{ ...makeSet(1), completed: true, weight: 100, reps: 8 }, { ...makeSet(2), completed: true, weight: 100, reps: 8 }, makeSet(3)];
  useAppStore.setState({ currentWorkout: makeWorkout(rows.map((row) => ({ ...row }))) });

  // A small sets table: DELETE honours the id and completed filters.
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname !== '/rest/v1/sets' || init?.method !== 'DELETE') throw new Error(`Unexpected request: ${init?.method} ${url.pathname}`);
    if (deleteError) return Response.json({ message: 'offline' }, { status: 503 });
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    const onlyUnlogged = url.searchParams.get('completed') === 'eq.false';
    const deleted = rows.filter((row) => row.id === id && (!onlyUnlogged || !row.completed));
    rows = rows.filter((row) => !deleted.includes(row));
    return url.searchParams.has('select') ? Response.json(deleted.map((row) => ({ id: row.id }))) : new Response(null, { status: 204 });
  });
});

afterEach(() => vi.restoreAllMocks());

const shownIds = () => useAppStore.getState().currentWorkout?.sets.map((set) => set.id);

describe('removing the last unlogged set', () => {
  it('removes an unlogged set from the server and the workout', async () => {
    await useAppStore.getState().removeLastUncompletedSet('bench');

    expect(rows.map((row) => row.id)).toEqual(['set-1', 'set-2']);
    expect(shownIds()).toEqual(['set-1', 'set-2']);
  });

  it('keeps a set that was logged while the phone still showed it unlogged', async () => {
    // Log set for set 3 landed on the server; its save has not returned yet.
    rows = rows.map((row) => (row.id === 'set-3' ? { ...row, completed: true, weight: 100, reps: 7 } : row));

    await useAppStore.getState().removeLastUncompletedSet('bench');

    expect(rows.find((row) => row.id === 'set-3')).toMatchObject({ completed: true, reps: 7 });
    // The count stays, so the sheet says "Set not removed".
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('leaves the workout alone when the delete fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    deleteError = true;

    await useAppStore.getState().removeLastUncompletedSet('bench');

    expect(rows).toHaveLength(3);
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
  });
});
