import { describe, expect, it } from 'vitest';
import { expandedWorkoutSet, getWorkoutResumeSet, initialWorkoutExpansion, nextWorkoutSet, workoutExpansionReducer } from '@/components/workout/workoutFocus';
import type { WorkoutSet } from '@/types';

const row = (exercise: string, number: number, completed = false): WorkoutSet => ({
  id: `${exercise}-${number}`, workout_id: 'workout', exercise_id: exercise, set_number: number,
  completed, completed_at: completed ? '2026-09-04T12:00:00Z' : null, weight: null, reps: null, rpe: null,
});
const pairings = new Map([
  ['a', { role: 'A' as const, partnerExerciseId: 'b' }],
  ['b', { role: 'B' as const, partnerExerciseId: 'a' }],
]);

describe('expandable workout movements', () => {
  const rows = [row('a', 1, true), row('a', 2), row('b', 1), row('b', 2)];

  it('starts with an overview and opens the first unfinished set only on expansion', () => {
    expect(expandedWorkoutSet(rows, initialWorkoutExpansion)).toBeUndefined();
    const open = workoutExpansionReducer(initialWorkoutExpansion, { type: 'toggle', exerciseId: 'a' });
    expect(expandedWorkoutSet(rows, open)?.id).toBe('a-2');
    const closed = workoutExpansionReducer(open, { type: 'toggle', exerciseId: 'a' });
    expect(expandedWorkoutSet(rows, closed)).toBeUndefined();
  });

  it('returns to the explicitly selected row after browsing or collapsing', () => {
    let state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'select', exerciseId: 'a', setId: 'a-1' });
    state = workoutExpansionReducer(state, { type: 'select', exerciseId: 'b', setId: 'b-2' });
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'a' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('a-1');
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'a' });
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'b' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('b-2');
  });

  it('keeps a deliberately hidden editor closed until a row is selected', () => {
    let state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'toggle', exerciseId: 'a' });
    state = workoutExpansionReducer(state, { type: 'hide', exerciseId: 'a' });
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'b' });
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'a' });
    expect(state.expandedExerciseId).toBe('a');
    expect(expandedWorkoutSet(rows, state)).toBeUndefined();
    state = workoutExpansionReducer(state, { type: 'select', exerciseId: 'a', setId: 'a-2' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('a-2');
  });

  it('closes saved entry without advancing or reopening a movement', () => {
    let state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'toggle', exerciseId: 'a' });
    state = workoutExpansionReducer(state, { type: 'saved', exerciseId: 'a', setId: 'a-2' });
    expect(state.expandedExerciseId).toBe('a');
    expect(expandedWorkoutSet(rows, state)).toBeUndefined();
    state = workoutExpansionReducer(state, { type: 'toggle', exerciseId: 'a' });
    state = workoutExpansionReducer(state, { type: 'saved', exerciseId: 'a', setId: 'a-2' });
    expect(state.expandedExerciseId).toBeNull();
  });

  it('a delayed save does not disturb a different selected set or movement', () => {
    let state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'select', exerciseId: 'a', setId: 'a-2' });
    state = workoutExpansionReducer(state, { type: 'select', exerciseId: 'a', setId: 'a-1' });
    state = workoutExpansionReducer(state, { type: 'saved', exerciseId: 'a', setId: 'a-2' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('a-1');
    state = workoutExpansionReducer(state, { type: 'select', exerciseId: 'b', setId: 'b-2' });
    state = workoutExpansionReducer(state, { type: 'saved', exerciseId: 'a', setId: 'a-1' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('b-2');
  });

  it('handles removed sets/movements without selecting a row from another movement', () => {
    const state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'select', exerciseId: 'a', setId: 'a-99' });
    expect(expandedWorkoutSet(rows, state)?.id).toBe('a-2');
    expect(expandedWorkoutSet(rows.filter(set => set.exercise_id === 'b'), state)).toBeUndefined();
    expect(expandedWorkoutSet(rows.filter(set => set.completed), state)).toBeUndefined();
  });

  it('starts each new workout collapsed with no stale row selections', () => {
    const state = workoutExpansionReducer(initialWorkoutExpansion, { type: 'select', exerciseId: 'a', setId: 'a-2' });
    const reset = workoutExpansionReducer(state, { type: 'reset' });
    expect(reset).toEqual({ expandedExerciseId: null, selectedSets: {} });
    expect(expandedWorkoutSet(rows, reset)).toBeUndefined();
  });

  it('substitutes an open movement without overriding later browsing', () => {
    const open = workoutExpansionReducer(initialWorkoutExpansion, { type: 'select', exerciseId: 'a', setId: 'a-2' });
    const replaced = workoutExpansionReducer(open, { type: 'replace', exerciseId: 'a', replacementId: 'c' });
    expect(replaced).toEqual({ expandedExerciseId: 'c', selectedSets: {} });
    const browsed = workoutExpansionReducer(open, { type: 'select', exerciseId: 'b', setId: 'b-2' });
    const late = workoutExpansionReducer(browsed, { type: 'replace', exerciseId: 'a', replacementId: 'c' });
    expect(expandedWorkoutSet(rows, late)?.id).toBe('b-2');
    const closed = workoutExpansionReducer(open, { type: 'toggle', exerciseId: 'a' });
    expect(workoutExpansionReducer(closed, { type: 'replace', exerciseId: 'a', replacementId: 'c' }).expandedExerciseId).toBeNull();
  });
});

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
