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
let loseDeleteAnswer: boolean;
let readError: boolean;

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  deleteError = false;
  loseDeleteAnswer = false;
  readError = false;
  rows = [{ ...makeSet(1), completed: true, weight: 100, reps: 8 }, { ...makeSet(2), completed: true, weight: 100, reps: 8 }, makeSet(3)];
  useAppStore.setState({ currentWorkout: makeWorkout(rows.map((row) => ({ ...row }))) });

  // A small sets table: DELETE honours the id and completed filters; GET reads one row by id.
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (url.pathname !== '/rest/v1/sets' || !['DELETE', 'GET'].includes(method)) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    const id = url.searchParams.get('id')?.replace(/^eq\./, '');
    if (method === 'GET') {
      if (readError) return Response.json({ message: 'offline' }, { status: 500 });
      return Response.json(rows.filter((row) => row.id === id).map((row) => ({ id: row.id, completed: row.completed })));
    }
    if (deleteError) return Response.json({ message: 'offline' }, { status: 503 });
    const onlyUnlogged = url.searchParams.get('completed') === 'eq.false';
    const deleted = rows.filter((row) => row.id === id && (!onlyUnlogged || !row.completed));
    rows = rows.filter((row) => !deleted.includes(row));
    if (loseDeleteAnswer) {
      // The server committed the delete, but its answer never reached the phone.
      loseDeleteAnswer = false;
      throw new TypeError('Network request failed');
    }
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

  it('clears a set an earlier attempt already deleted when its answer was lost', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loseDeleteAnswer = true;

    await useAppStore.getState().removeLastUncompletedSet('bench');
    // The phone heard nothing back, so it still shows set 3; the sheet says "Set not removed".
    expect(rows.map((row) => row.id)).toEqual(['set-1', 'set-2']);
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);

    // − again: nothing left to delete, and the read finds set 3 gone.
    await useAppStore.getState().removeLastUncompletedSet('bench');
    expect(shownIds()).toEqual(['set-1', 'set-2']);
  });

  it('keeps a set logged meanwhile when the retry deletes nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    useAppStore.setState({ currentWorkout: makeWorkout([...rows.map((row) => ({ ...row })), makeSet(4)]) });
    rows = [...rows, makeSet(4)];
    loseDeleteAnswer = true;

    await useAppStore.getState().removeLastUncompletedSet('bench');
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3', 'set-4']);
    // Set 3 is logged on the server before the next −, which still aims at the ghost set 4.
    rows = rows.map((row) => (row.id === 'set-3' ? { ...row, completed: true, weight: 100, reps: 7 } : row));

    await useAppStore.getState().removeLastUncompletedSet('bench');
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
    // Set 3 is the next − target now; the server has it logged, so it stays.
    await useAppStore.getState().removeLastUncompletedSet('bench');
    expect(rows.find((row) => row.id === 'set-3')).toMatchObject({ completed: true, reps: 7 });
    expect(shownIds()).toEqual(['set-1', 'set-2', 'set-3']);
  });

  it('keeps the set when nothing was deleted and it cannot be read back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    rows = rows.filter((row) => row.id !== 'set-3');
    readError = true;

    await useAppStore.getState().removeLastUncompletedSet('bench');

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
