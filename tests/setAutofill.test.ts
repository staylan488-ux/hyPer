import { describe, expect, it } from 'vitest';

import { getSetAutofillValues } from '@/lib/setAutofill';
import type { WorkoutSet } from '@/types';

const exerciseSets: WorkoutSet[] = [
  {
    id: 'set-1',
    workout_id: 'workout-1',
    exercise_id: 'exercise-1',
    set_number: 1,
    weight: 185,
    reps: 8,
    rpe: 8,
    completed: true,
    completed_at: '2026-03-10T12:00:00.000Z',
  },
  {
    id: 'set-2',
    workout_id: 'workout-1',
    exercise_id: 'exercise-1',
    set_number: 2,
    weight: null,
    reps: null,
    rpe: null,
    completed: false,
    completed_at: null,
  },
];

describe('setAutofill helpers', () => {
  it('uses the previous workout for set 1', () => {
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 1,
      currentExerciseSets: [],
      previousWorkoutSetsByExercise: {
        'exercise-1': {
          1: {
            weight: 195,
            reps: 6,
            rpe: 9,
          },
        },
      },
    })).toEqual({
      weight: '195',
      reps: '6',
      rpe: '9',
      source: 'previous_workout',
    });
  });

  it('uses the latest completed set in the current workout for later sets', () => {
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 2,
      currentExerciseSets: exerciseSets,
      previousWorkoutSetsByExercise: {},
    })).toEqual({
      weight: '185',
      reps: '8',
      rpe: '8',
      source: 'current_workout',
    });
  });

  it('returns null when there is no source set to copy', () => {
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 1,
      currentExerciseSets: [],
      previousWorkoutSetsByExercise: {},
    })).toBeNull();
  });
});
