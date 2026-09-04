import { describe, expect, it } from 'vitest';
import { getWorkoutResumeSet, nextWorkoutSet } from '@/components/workout/workoutFocus';
import type { WorkoutSet } from '@/types';

const row = (exercise: string, number: number, completed = false): WorkoutSet => ({
  id: `${exercise}-${number}`, workout_id: 'workout', exercise_id: exercise, set_number: number,
  completed, completed_at: completed ? '2026-09-04T12:00:00Z' : null, weight: null, reps: null, rpe: null,
});
const pairings = new Map([
  ['a', { role: 'A' as const, partnerExerciseId: 'b' }],
  ['b', { role: 'B' as const, partnerExerciseId: 'a' }],
]);

describe('Studio workout focus', () => {
  it('resumes the first unfinished movement in the actual displayed order', () => {
    const rows = [row('a', 1, true), row('a', 2, true), row('c', 1), row('b', 2), row('b', 1)];
    expect(nextWorkoutSet(rows, ['a', 'b', 'c'])?.id).toBe('b-1');
    expect(nextWorkoutSet(rows, ['a', 'c', 'b'])?.id).toBe('c-1');
  });
  it('advances within the same movement, then to an actual next movement', () => {
    const rows = [row('a', 1), row('a', 2), row('b', 1)];
    expect(nextWorkoutSet(rows, ['a', 'b'], rows[0])?.id).toBe('a-2');
    rows[0].completed = true;
    expect(nextWorkoutSet(rows, ['a', 'b'], rows[1])?.id).toBe('b-1');
  });
  it('alternates A and B rounds using their real set IDs', () => {
    const rows = [row('a', 1), row('a', 2), row('b', 1), row('b', 2)];
    expect(nextWorkoutSet(rows, ['a', 'b'], rows[0], pairings.get('a'))?.id).toBe('b-1');
    rows[0].completed = true;
    expect(nextWorkoutSet(rows, ['a', 'b'], rows[2], pairings.get('b'))?.id).toBe('a-2');
  });
  it('resumes B1 after A1 instead of opening a blocked A2', () => {
    const rows = [row('a', 1, true), row('a', 2), row('b', 1), row('b', 2)];
    expect(nextWorkoutSet(rows, ['a', 'b'], undefined, undefined, pairings)?.id).toBe('b-1');
  });
  it('does not invent another set after the final save', () => {
    const rows = [row('a', 1, true), row('a', 2)];
    expect(nextWorkoutSet(rows, ['a'], rows[1])).toBeUndefined();
  });
  it('ignores removed movements while preserving real unfinished sets', () => {
    expect(nextWorkoutSet([row('a', 2)], ['a'])?.id).toBe('a-2');
    expect(nextWorkoutSet([], ['a'])).toBeUndefined();
  });
});

describe('Dashboard resume cue', () => {
  it('uses the split exercise order and set number instead of response array order', () => {
    const workout = { id: 'workout', split_day_id: 'day', sets: [row('b', 1), row('a', 2), row('a', 1)] };
    const day = { id: 'day', exercises: [{ exercise_id: 'b', exercise_order: 1 }, { exercise_id: 'a', exercise_order: 0 }] };
    expect(getWorkoutResumeSet(workout, day)?.id).toBe('a-1');
  });
  it('shows B1 after A1 in a flexible paired plan, even with unordered plan items', () => {
    const workout = { id: 'workout', split_day_id: null, sets: [row('a', 1, true), row('a', 2), row('b', 2), row('b', 1)] };
    const plan = { workout_id: 'workout', items: [
      { exercise_id: 'b', order: 1, superset_group_id: 'pair' },
      { exercise_id: 'a', order: 0, superset_group_id: 'pair' },
    ] };
    expect(getWorkoutResumeSet(workout, null, plan)?.id).toBe('b-1');
  });
});
