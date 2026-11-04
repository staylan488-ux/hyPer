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

  it('keeps a load to the hundredth, as it is saved', () => {
    const logged = { ...exerciseSets[0], weight: 46.25, reps: 10, rpe: 7.5 };
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 2,
      currentExerciseSets: [logged, exerciseSets[1]],
      previousWorkoutSetsByExercise: {},
    })).toEqual({ weight: '46.25', reps: '10', rpe: '7.5', source: 'current_workout' });
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 1,
      currentExerciseSets: [],
      previousWorkoutSetsByExercise: { 'exercise-1': { 1: { weight: 12.7, reps: 8, rpe: null } } },
    })).toEqual({ weight: '12.7', reps: '8', rpe: '', source: 'previous_workout' });
  });

  it('fills a movement\'s first set from last time when its sets start past 1 (a superset swap)', () => {
    const replacement = [
      { ...exerciseSets[1], id: 'set-2', set_number: 2 },
      { ...exerciseSets[1], id: 'set-3', set_number: 3 },
    ];
    const previous = { 'exercise-1': { 1: { weight: 100, reps: 10, rpe: null }, 2: { weight: 95, reps: 9, rpe: null } } };
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 2,
      currentExerciseSets: replacement,
      previousWorkoutSetsByExercise: previous,
    })).toEqual({ weight: '95', reps: '9', rpe: '', source: 'previous_workout' });
    // A later set still waits for an earlier one this workout.
    expect(getSetAutofillValues({
      exerciseId: 'exercise-1',
      setNumber: 3,
      currentExerciseSets: replacement,
      previousWorkoutSetsByExercise: previous,
    })).toBeNull();
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
