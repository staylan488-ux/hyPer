import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNoteAutosaver } from '@/lib/noteAutosave';
import type { FlexiblePlanItem, WorkoutSet } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

// A flexible session's set count lives in its plan, and every plan change
// rewrites the whole plan. A set-count change has to wait its turn behind a
// reorder (or skip, or plan note) still saving, or it puts the old plan back.

// Typed here: importing the module's types would pull React Native's globals into the test build.
type Movement = {
  changeSetCount: (workoutId: string, exerciseId: string, change: 'add' | 'remove') => Promise<boolean>;
  reorderMovements: (workoutId: string, exerciseIds: string[]) => Promise<void>;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const item = (exerciseId: string, order: number): FlexiblePlanItem => ({
  exercise_id: exerciseId, exercise_name: exerciseId, order, target_sets: 2, notes: null, hidden: false, superset_group_id: null,
});
const set = (exerciseId: string, setNumber: number): WorkoutSet => ({
  id: `${exerciseId}-${setNumber}`, workout_id: 'workout-1', exercise_id: exerciseId, set_number: setNumber,
  weight: null, reps: null, rpe: null, completed: false, completed_at: null,
});

const reorderSaved = { current: deferred() };
const store = {
  currentWorkout: null as { id: string; split_day_id: string | null; sets: WorkoutSet[] } | null,
  currentWorkoutDayPlan: null as { id: string; workout_id: string; day_label: string; items: FlexiblePlanItem[] } | null,
  // Both rewrite the whole plan from what the store held when they started, as the store does.
  reorderWorkoutExercises: vi.fn(async (_workoutId: string, ids: string[]) => {
    const plan = store.currentWorkoutDayPlan!;
    await reorderSaved.current.promise;
    store.currentWorkoutDayPlan = {
      ...plan,
      items: ids.map((id, order) => ({ ...plan.items.find((entry) => entry.exercise_id === id)!, order })),
    };
  }),
  updateFlexibleExerciseMeta: vi.fn(async (exerciseId: string, updates: { target_sets: number }) => {
    const plan = store.currentWorkoutDayPlan!;
    const workout = store.currentWorkout!;
    await Promise.resolve();
    store.currentWorkoutDayPlan = {
      ...plan,
      items: plan.items.map((entry) => (entry.exercise_id === exerciseId ? { ...entry, ...updates } : entry)),
    };
    store.currentWorkout = { ...workout, sets: [...workout.sets, set(exerciseId, updates.target_sets)] };
  }),
  addWorkoutSet: vi.fn(),
  removeLastUncompletedSet: vi.fn(),
};

let movement: Movement;

beforeEach(() => {
  reorderSaved.current = deferred();
  store.currentWorkout = { id: 'workout-1', split_day_id: null, sets: [set('row', 1), set('row', 2), set('curl', 1), set('curl', 2)] };
  store.currentWorkoutDayPlan = { id: 'plan-1', workout_id: 'workout-1', day_label: 'Pull', items: [item('row', 0), item('curl', 1)] };
  store.reorderWorkoutExercises.mockClear();
  store.updateFlexibleExerciseMeta.mockClear();
  // The shared per-workout write queue, with no notes waiting.
  const saver = createNoteAutosaver({ debounceMs: 1000, save: async () => true });
  movement = loadNativeModule<Movement>('lib/movement.ts', {
    'react-native': { Alert: { alert: vi.fn() } },
    '@/stores/appStore': { useAppStore: { getState: () => store } },
    './haptics': { haptics: { error: vi.fn(), success: vi.fn() } },
    './notes': { afterNotes: (workoutId: string, write: () => Promise<unknown>) => saver.runAfterFlush(workoutId, write) },
    './session': { useFocusStore: { getState: () => ({ exerciseId: null, focus: vi.fn() }) }, usePendingSkips: { setState: vi.fn() } },
  });
});

describe('changing a flexible movement\'s set count', () => {
  it('waits for a reorder still saving, then keeps both changes', async () => {
    const reorder = movement.reorderMovements('workout-1', ['curl', 'row']);
    await Promise.resolve();
    const added = movement.changeSetCount('workout-1', 'row', 'add');
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Nothing is written over the plan while the reorder saves.
    expect(store.updateFlexibleExerciseMeta).not.toHaveBeenCalled();

    reorderSaved.current.resolve();
    await reorder;
    await expect(added).resolves.toBe(true);
    expect(store.currentWorkoutDayPlan?.items.map((entry) => [entry.exercise_id, entry.order, entry.target_sets])).toEqual([
      ['curl', 0, 2],
      ['row', 1, 3],
    ]);
  });

  it('refuses once the workout has closed', async () => {
    store.currentWorkout = null;
    await expect(movement.changeSetCount('workout-1', 'row', 'add')).rejects.toThrow('This workout is no longer open.');
    expect(store.updateFlexibleExerciseMeta).not.toHaveBeenCalled();
  });
});
