import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn<typeof fetch>() }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return {
    supabase: createClient('https://workout-target-sets.test', 'test-key', {
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
let beforeDelete: (() => void | Promise<void>) | undefined;
let deleteError: boolean;
let plan: WorkoutDayPlan;

function setActiveRows(nextRows: WorkoutSet[]) {
  rows = nextRows.map((row) => ({ ...row }));
  useAppStore.setState({ currentWorkout: makeWorkout(nextRows), currentWorkoutDayPlan: plan });
}

beforeEach(() => {
  fetchMock.mockReset();
  resetAppData();
  beforeDelete = undefined;
  deleteError = false;
  plan = {
    id: 'plan-1', workout_id: 'workout-1', day_label: 'Training', items: [{
      exercise_id: 'exercise-1', order: 0, target_sets: 4,
      target_reps_min: 8, target_reps_max: 12, hidden: false,
    }],
  };
  setActiveRows([1, 2, 3, 4].map((number) => makeSet(number)));

  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/rest/v1/workout_day_plans') {
      if (init?.method === 'PATCH') plan = { ...plan, ...JSON.parse(String(init.body)) };
      return Response.json(plan);
    }
    if (url.pathname !== '/rest/v1/sets') throw new Error(`Unexpected test endpoint: ${url.pathname}`);

    if (init?.method === 'DELETE') {
      await beforeDelete?.();
      if (deleteError) return Response.json({ message: 'Delete rejected' }, { status: 400 });
      const selectedIds = (url.searchParams.get('id') ?? '').slice(4, -1).split(',');
      const deleted = rows.filter((row) => selectedIds.includes(row.id) && !row.completed);
      rows = rows.filter((row) => !deleted.some((entry) => entry.id === row.id));
      return url.searchParams.has('select')
        ? Response.json(deleted.map((row) => ({ id: row.id })))
        : new Response(null, { status: 204 });
    }
    if (init?.method === 'POST') {
      const inserted = (JSON.parse(String(init.body)) as Array<Pick<WorkoutSet, 'exercise_id' | 'set_number'>>)
        .map((row) => ({ ...makeSet(row.set_number, row.exercise_id), ...row }));
      rows.push(...inserted);
      return url.searchParams.has('select') ? Response.json(inserted) : new Response(null, { status: 201 });
    }

    const exerciseId = url.searchParams.get('exercise_id')?.slice(3);
    return Response.json(rows.filter((row) => row.exercise_id === exerciseId));
  });
});

afterEach(() => vi.restoreAllMocks());

describe('target set edits keep the active workout row identities current', () => {
  it('removes confirmed deleted rows from the active workout', async () => {
    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'exercise-1', 2);

    expect(rows.map((row) => row.set_number)).toEqual([1, 2]);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('adds the returned rows to the active workout so they can be logged by id', async () => {
    setActiveRows([makeSet(1), makeSet(2)]);
    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'exercise-1', 4);

    expect(rows.map((row) => row.set_number)).toEqual([1, 2, 3, 4]);
    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('keeps sets completed or added while a delete was in flight', async () => {
    beforeDelete = () => {
      const completed = { ...makeSet(3), completed: true, weight: 200, reps: 5 };
      rows = rows.map((row) => row.id === completed.id ? completed : row);
      rows.push(makeSet(5));
      useAppStore.setState({ currentWorkout: makeWorkout(rows.map((row) => ({ ...row }))) });
    };

    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'exercise-1', 2);

    expect(useAppStore.getState().currentWorkout?.sets.map((row) => row.set_number)).toEqual([1, 2, 3, 5]);
    expect(useAppStore.getState().currentWorkout?.sets.find((row) => row.set_number === 3))
      .toMatchObject({ completed: true, weight: 200, reps: 5 });
  });

  it.each(['workout', 'account'])('ignores an old edit result after the current %s changes', async (change) => {
    let replacement: Workout | undefined;
    beforeDelete = () => {
      if (change === 'account') resetAppData();
      replacement = {
        ...makeWorkout([makeSet(3)]),
        ...(change === 'workout' ? { id: 'workout-2' } : {}),
      };
      useAppStore.setState({ currentWorkout: replacement });
    };

    await useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'exercise-1', 2);

    expect(useAppStore.getState().currentWorkout).toEqual(replacement);
  });

  it('retains confirmed additions when a later deletion fails', async () => {
    const partnerSets = [1, 2, 3, 4].map((number) => makeSet(number, 'exercise-2'));
    plan.items = [
      { ...plan.items[0], superset_group_id: 'pair' },
      { ...plan.items[0], exercise_id: 'exercise-2', order: 1, superset_group_id: 'pair' },
    ];
    setActiveRows([makeSet(1), ...partnerSets]);
    deleteError = true;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(useAppStore.getState().updateWorkoutExerciseTargetSets('workout-1', 'exercise-1', 2))
      .rejects.toThrow('Could not remove');

    expect(useAppStore.getState().currentWorkout?.sets.filter((row) => row.exercise_id === 'exercise-1')
      .map((row) => row.set_number)).toEqual([1, 2]);
    expect(useAppStore.getState().currentWorkout?.sets.filter((row) => row.exercise_id === 'exercise-2'))
      .toHaveLength(4);
  });
});
