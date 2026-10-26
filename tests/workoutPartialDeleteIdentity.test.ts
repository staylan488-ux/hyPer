import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://workout-partial-delete.test', 'test-key', {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: fetchMock },
    }),
  };
});

import { resetAppData, useAppStore } from '@/stores/appStore';

function makeSet(number: number, exerciseId = 'exercise-1'): WorkoutSet {
  return {
    id: `${exerciseId}-set-${number}`, workout_id: 'workout-1', exercise_id: exerciseId,
    set_number: number, weight: null, reps: null, rpe: null,
    completed: false, completed_at: null,
  };
}

function makeWorkout(sets: WorkoutSet[]): Workout {
  return {
    id: 'workout-1', user_id: 'user-1', split_day_id: null, date: '2026-10-25',
    notes: null, completed: false, sets,
  };
}

let rows: WorkoutSet[];
let remainingReadError: boolean;
let renumberErrorId: string | null;
let planReadError: boolean;
let planWriteError: boolean;
let afterDelete: (() => void) | undefined;
let afterRemainingRead: (() => void) | undefined;
let plan: WorkoutDayPlan;

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  remainingReadError = false;
  renumberErrorId = null;
  planReadError = false;
  planWriteError = false;
  afterDelete = undefined;
  afterRemainingRead = undefined;
  plan = {
    id: 'plan-1', workout_id: 'workout-1', day_label: 'Training', items: [
      { exercise_id: 'exercise-1', order: 0, target_sets: 4, hidden: false },
      { exercise_id: 'exercise-2', order: 1, target_sets: 1, hidden: false },
    ],
  };
  rows = [1, 2, 3, 4].map((number) => makeSet(number));
  rows.push({ ...makeSet(1, 'exercise-2'), completed: true, weight: 100, reps: 8 });
  useAppStore.setState({
    currentWorkout: makeWorkout(rows.map((row) => ({ ...row }))), currentWorkoutDayPlan: plan,
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});

  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/workout_day_plans') {
      if (init?.method === 'PATCH') {
        if (planWriteError) return Response.json({ message: 'Plan write failed' }, { status: 400 });
        plan = { ...plan, ...JSON.parse(String(init.body)) };
      } else if (planReadError) {
        return Response.json({ message: 'Plan read failed' }, { status: 400 });
      }
      return Response.json(plan);
    }
    if (url.pathname !== '/rest/v1/sets') throw new Error(`Unexpected test endpoint: ${url.pathname}`);

    const exerciseId = url.searchParams.get('exercise_id')?.slice(3);
    const setId = url.searchParams.get('id')?.slice(3);
    if (init?.method === 'DELETE') {
      const deleted = rows.filter((row) => (!exerciseId || row.exercise_id === exerciseId) && (!setId || row.id === setId));
      rows = rows.filter((row) => !deleted.some((entry) => entry.id === row.id));
      afterDelete?.();
      return url.searchParams.has('select')
        ? Response.json(deleted.map((row) => ({ id: row.id })))
        : new Response(null, { status: 204 });
    }
    if (init?.method === 'PATCH') {
      if (setId === renumberErrorId) return Response.json({ message: 'Renumber failed' }, { status: 400 });
      const patch = JSON.parse(String(init.body)) as Pick<WorkoutSet, 'set_number'>;
      rows = rows.map((row) => row.id === setId ? { ...row, ...patch } : row);
      return url.searchParams.has('select')
        ? Response.json(rows.filter((row) => row.id === setId).map((row) => ({ id: row.id, set_number: row.set_number })))
        : new Response(null, { status: 204 });
    }

    if (remainingReadError) return Response.json({ message: 'Set read failed' }, { status: 400 });
    const snapshot = rows.filter((row) => row.exercise_id === exerciseId)
      .map((row) => ({ id: row.id, set_number: row.set_number }));
    afterRemainingRead?.();
    return Response.json(snapshot);
  });
});

afterEach(() => vi.restoreAllMocks());

describe('partial workout deletions keep live row identities accurate', () => {
  it('removes an already-absent set after a successful empty delete, even if compaction fails', async () => {
    rows = rows.filter((row) => row.id !== 'exercise-1-set-2');
    remainingReadError = true;
    await expect(useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'exercise-1-set-2'))
      .rejects.toThrow('Could not save');
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('clears already-absent exercise rows while preserving additions after the empty delete', async () => {
    rows = rows.filter((row) => row.exercise_id !== 'exercise-1');
    afterDelete = () => {
      rows.push(makeSet(5));
      const current = useAppStore.getState().currentWorkout!;
      useAppStore.setState({ currentWorkout: { ...current, sets: [...current.sets, makeSet(5)] } });
    };
    planReadError = true;
    await expect(useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1')).rejects.toThrow();
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('drops a successfully deleted set even if the remaining-set read fails', async () => {
    remainingReadError = true;

    await expect(useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'exercise-1-set-2'))
      .rejects.toThrow('Could not save');

    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.exercise_id === 'exercise-2'))
      .toMatchObject({ completed: true, weight: 100, reps: 8 });
  });

  it('keeps completed compaction writes when a later renumber fails', async () => {
    renumberErrorId = 'exercise-1-set-4';

    await expect(useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'exercise-1-set-2'))
      .rejects.toThrow('Could not save');

    expect(useAppStore.getState().currentWorkout?.sets.map((row) => [row.id, row.set_number]))
      .toEqual(rows.map((row) => [row.id, row.set_number]));
    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.id === 'exercise-1-set-3')?.set_number).toBe(2);
    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.id === 'exercise-1-set-4')?.set_number).toBe(4);
  });

  it('does not renumber new rows outside the server snapshot or replace newer saved values', async () => {
    afterRemainingRead = () => {
      rows.push(makeSet(5));
      rows = rows.map((row) => row.exercise_id === 'exercise-2' ? { ...row, weight: 200, reps: 5 } : row);
      const current = useAppStore.getState().currentWorkout!;
      useAppStore.setState({ currentWorkout: { ...current, sets: [
        ...current.sets.map((row) => row.exercise_id === 'exercise-2' ? { ...row, weight: 200, reps: 5 } : row),
        makeSet(5),
      ] } });
    };

    await useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'exercise-1-set-2');

    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.id === 'exercise-1-set-5')?.set_number).toBe(5);
    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.exercise_id === 'exercise-2'))
      .toMatchObject({ completed: true, weight: 200, reps: 5 });
  });

  it.each(['read', 'write'])('drops deleted exercise rows even if the plan %s fails', async (failure) => {
    planReadError = failure === 'read';
    planWriteError = failure === 'write';

    await expect(useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1'))
      .rejects.toThrow();

    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(['exercise-2-set-1']);
    expect(useAppStore.getState().currentWorkout?.sets[0]).toMatchObject({ completed: true, weight: 100, reps: 8 });
  });

  it('preserves a row added after the exercise deletion was executed', async () => {
    afterDelete = () => {
      rows.push(makeSet(5));
      const current = useAppStore.getState().currentWorkout!;
      useAppStore.setState({ currentWorkout: { ...current, sets: [...current.sets, makeSet(5)] } });
    };

    await useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1');

    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id))
      .toEqual(['exercise-2-set-1', 'exercise-1-set-5']);
  });

  it.each([
    ['set', 'workout'], ['set', 'account'], ['exercise', 'workout'], ['exercise', 'account'],
  ])('ignores a %s deletion response after the current %s changes', async (kind, change) => {
    let replacement: Workout | undefined;
    afterDelete = () => {
      if (change === 'account') resetAppData();
      replacement = {
        ...makeWorkout([makeSet(2)]),
        ...(change === 'workout' ? { id: 'workout-2' } : {}),
      };
      useAppStore.setState({ currentWorkout: replacement });
    };

    if (kind === 'set') {
      await useAppStore.getState().removeSetFromWorkout('workout-1', 'exercise-1', 'exercise-1-set-2');
    } else {
      await useAppStore.getState().removeExerciseFromWorkout('workout-1', 'exercise-1');
    }

    expect(useAppStore.getState().currentWorkout).toEqual(replacement);
  });
});
