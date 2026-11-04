import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

import * as accountScope from '@/lib/accountScope';
import * as noteAutosave from '@/lib/noteAutosave';
import * as workoutNotes from '@/lib/workoutNotes';
import type { FlexiblePlanItem, WorkoutDayPlan } from '@/types';
import { loadNativeModule } from './helpers/loadNativeModule';

// A flexible session's note also goes on its plan item (native/src/lib/notes.ts).
// A note that failed to save, for a workout then deleted, must not keep every
// later Finish and workout change failing with "Note not saved".

type Notes = {
  editNote: (workoutId: string, exerciseId: string, text: string) => void;
  saveNoteNow: (workoutId: string, exerciseId: string) => void;
  flushNotes: () => Promise<boolean>;
  afterNotes: <T>(workoutId: string, write: () => Promise<T>) => Promise<T>;
};

const item: FlexiblePlanItem = {
  exercise_id: 'row', exercise_name: 'Row', order: 0, target_sets: 3, notes: null, hidden: false, superset_group_id: null,
};
const plan: WorkoutDayPlan = { id: 'plan-1', workout_id: 'w1', day_label: 'Pull', items: [item] };

const store = {
  currentWorkout: null as { id: string; split_day_id: string | null; notes: string | null } | null,
  currentWorkoutDayPlan: null as WorkoutDayPlan | null,
  updateWorkoutNotes: vi.fn(async () => {}),
  updateWorkoutDayPlanItems: vi.fn(async (): Promise<WorkoutDayPlan | null> => null),
  fetchWorkoutDayPlanByWorkoutId: vi.fn(async (): Promise<WorkoutDayPlan | null> => null),
};

let notes: Notes;

/** A note typed in the flexible session W1 whose plan-note write fails offline. */
async function failNoteOffline() {
  store.updateWorkoutDayPlanItems.mockRejectedValue(new Error('Could not save the workout plan. Try again.'));
  notes.editNote('w1', 'row', 'Elbows in');
  notes.saveNoteNow('w1', 'row');
  await expect(notes.flushNotes()).resolves.toBe(false);
  store.updateWorkoutDayPlanItems.mockResolvedValue(plan);
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  accountScope.invalidateAccountScope();
  store.currentWorkout = { id: 'w1', split_day_id: null, notes: null };
  store.currentWorkoutDayPlan = plan;
  store.updateWorkoutNotes.mockReset().mockResolvedValue(undefined);
  store.updateWorkoutDayPlanItems.mockReset();
  store.fetchWorkoutDayPlanByWorkoutId.mockReset().mockResolvedValue(null);
  notes = loadNativeModule<Notes>('lib/notes.ts', {
    'react-native': { AppState: { addEventListener: vi.fn() } },
    zustand: { create },
    '@/lib/accountScope': accountScope,
    '@/lib/noteAutosave': noteAutosave,
    '@/lib/workoutNotes': workoutNotes,
    '@/stores/appStore': { useAppStore: { getState: () => store } },
  });
});

afterEach(() => vi.restoreAllMocks());

describe('a failed flexible note whose workout is then deleted', () => {
  it('is dropped, so the next workout finishes and changes normally', async () => {
    await failNoteOffline();

    // W1 is deleted in History: its plan goes with it. W2 starts.
    store.currentWorkout = { id: 'w2', split_day_id: null, notes: null };
    store.currentWorkoutDayPlan = null;

    await expect(notes.flushNotes()).resolves.toBe(true);
    await expect(notes.afterNotes('w2', async () => 'changed')).resolves.toBe('changed');
    expect(store.fetchWorkoutDayPlanByWorkoutId).toHaveBeenCalledWith('w1', { throwOnError: true });
  });

  it('still fails while the plan cannot be read, and saves once it can', async () => {
    await failNoteOffline();

    // Still signed in to W1, but the store no longer holds its plan and the read fails.
    store.currentWorkoutDayPlan = null;
    store.fetchWorkoutDayPlanByWorkoutId.mockRejectedValue(new Error('Could not load the workout plan. Try again.'));
    await expect(notes.flushNotes()).resolves.toBe(false);
    await expect(notes.afterNotes('w1', async () => 'changed')).rejects.toThrow('Note not saved');

    store.fetchWorkoutDayPlanByWorkoutId.mockResolvedValue(plan);
    await expect(notes.flushNotes()).resolves.toBe(true);
    expect(store.updateWorkoutDayPlanItems).toHaveBeenLastCalledWith('w1', [{ ...item, notes: 'Elbows in' }], plan);
  });
});
