import { describe, expect, it } from 'vitest';

import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import type { Exercise, Split, Workout, WorkoutSet } from '@/types';

import { countBeats, gainOnLastTime } from '../native/src/lib/beatLastTime';
import { summarize } from '../native/src/lib/finished';
import { buildSessionModel } from '../native/src/lib/sessionModel';

// The native app marks a logged set that beat the same set last time, and the
// finish screen counts them.

const exercise = (id: string, name: string): Exercise => ({
  id,
  name,
  muscle_group: 'chest',
  muscle_group_secondary: null,
  equipment: null,
  is_compound: true,
});

const bench = exercise('bench', 'Barbell Bench Press');
const lever = exercise('lever', 'Front Lever');

const split: Split = {
  id: 'split-1',
  user_id: 'user-1',
  name: 'Upper',
  description: null,
  days_per_week: 3,
  is_active: true,
  days: [
    {
      id: 'day-1',
      split_id: 'split-1',
      day_name: 'Upper A',
      day_order: 1,
      exercises: [bench, lever].map((row, index) => ({
        id: `plan-${row.id}`,
        split_day_id: 'day-1',
        exercise_id: row.id,
        exercise: row,
        target_sets: 3,
        target_reps_min: 5,
        target_reps_max: 8,
        exercise_order: index + 1,
        notes: null,
      })),
    },
  ],
};

const set = (row: Exercise, setNumber: number, weight: number | null, reps: number | null, completed: boolean): WorkoutSet => ({
  id: `${row.id}-${setNumber}`,
  workout_id: 'workout-1',
  exercise_id: row.id,
  exercise: row,
  set_number: setNumber,
  weight,
  reps,
  rpe: null,
  completed,
  completed_at: completed ? '2026-10-30T16:00:00.000Z' : null,
});

const workout = (sets: WorkoutSet[]): Workout => ({
  id: 'workout-1',
  user_id: 'user-1',
  split_day_id: 'day-1',
  date: '2026-10-30',
  notes: null,
  completed: false,
  created_at: '2026-10-30T15:30:00.000Z',
  sets,
});

const lastTime: PreviousWorkoutSetMap = {
  bench: {
    1: { weight: 185, reps: 8, rpe: null },
    2: { weight: 185, reps: 8, rpe: null },
    3: { weight: 185, reps: 7, rpe: null },
  },
  lever: {
    1: { weight: 0, reps: 0, rpe: null },
    2: { weight: 0, reps: 2, rpe: null },
  },
};

describe('gainOnLastTime', () => {
  it('describes a set that beat the same set last time', () => {
    expect(gainOnLastTime(set(bench, 1, 190, 8, true), lastTime)).toBe('+5 lb');
    expect(gainOnLastTime(set(bench, 3, 185, 9, true), lastTime)).toBe('+2 reps');
  });

  it('counts a first rep on a bodyweight hold that failed last time', () => {
    expect(gainOnLastTime(set(lever, 1, 0, 1, true), lastTime)).toBe('+1 rep');
  });

  it('is null for a matched or lower set, or one with no last time', () => {
    expect(gainOnLastTime(set(bench, 2, 185, 8, true), lastTime)).toBeNull();
    expect(gainOnLastTime(set(bench, 2, 185, 6, true), lastTime)).toBeNull();
    expect(gainOnLastTime(set(lever, 3, 0, 5, true), lastTime)).toBeNull();
    expect(gainOnLastTime(set(bench, 1, 225, 8, true), {})).toBeNull();
  });
});

describe('beat last time on the finish summary', () => {
  const sets = [
    set(bench, 1, 190, 8, true), // beat: more weight
    set(bench, 2, 185, 8, true), // matched
    set(bench, 3, 185, 9, true), // beat: more reps
    set(lever, 1, 0, 1, true), // beat: a first rep
    set(lever, 2, 0, 3, false), // better, but not logged
    set(lever, 3, 0, 4, true), // no last time to beat
  ];

  it('counts only logged sets that beat the same set last time', () => {
    expect(countBeats(sets, lastTime)).toBe(3);
  });

  it('puts the count on the summary, and zero without last time', () => {
    const session = buildSessionModel(workout(sets), { split }, null);
    if (!session) throw new Error('no session');
    expect(summarize(session, lastTime, new Date('2026-10-30T16:30:00.000Z')).beat).toBe(3);
    expect(summarize(session, {}, new Date('2026-10-30T16:30:00.000Z')).beat).toBe(0);
  });
});
