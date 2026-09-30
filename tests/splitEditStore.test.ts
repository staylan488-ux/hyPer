import { beforeEach, describe, expect, it, vi } from 'vitest';

import { serializeSetRangeNotes } from '@/lib/setRangeNotes';
import type { Exercise, Split, SplitExercise } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import { useSplitEditStore } from '@/stores/splitEditStore';

function exercise(id: string): Exercise {
  return { id, name: id, muscle_group: 'chest', muscle_group_secondary: null, equipment: null, is_compound: false };
}

function row(id: string, dayId: string, order: number, overrides: Partial<SplitExercise> = {}): SplitExercise {
  return {
    id,
    split_day_id: dayId,
    exercise_id: `ex-${id}`,
    exercise: exercise(`ex-${id}`),
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 12,
    exercise_order: order,
    notes: serializeSetRangeNotes(null, 2, 3, 4),
    superset_group_id: null,
    ...overrides,
  };
}

const split: Split = {
  id: 'split-1',
  user_id: 'user-1',
  name: 'Upper / Lower',
  description: 'Four days',
  days_per_week: 2,
  is_active: true,
  days: [
    {
      id: 'day-1',
      split_id: 'split-1',
      day_name: 'Upper',
      day_order: 0,
      exercises: [
        row('a', 'day-1', 0),
        row('b', 'day-1', 1, { superset_group_id: 'group-1' }),
        row('c', 'day-1', 2, { superset_group_id: 'group-1', target_reps_min: 6 }),
      ],
    },
    {
      id: 'day-2',
      split_id: 'split-1',
      day_name: 'Lower',
      day_order: 1,
      exercises: [row('d', 'day-2', 0)],
    },
  ],
};

const store = () => useSplitEditStore.getState();
const draftExercise = (dayId: string, exerciseId: string) =>
  store().draft!.days.find((day) => day.id === dayId)!.exercises.find((ex) => ex.id === exerciseId)!;

beforeEach(() => {
  store().cancelEdit();
  store().startEdit(split);
});

describe('splitEditStore.updateExerciseTargets', () => {
  it('leaves the draft untouched and clean when every value is unchanged', () => {
    const before = store().draft;
    const current = draftExercise('day-1', 'a');

    store().updateExerciseTargets('day-1', 'a', { target_sets_min: current.target_sets_min });
    store().updateExerciseTargets('day-1', 'a', { target_sets: current.target_sets });
    store().updateExerciseTargets('day-1', 'a', { target_sets_max: current.target_sets_max });
    store().updateExerciseTargets('day-1', 'a', { target_reps_min: current.target_reps_min });
    store().updateExerciseTargets('day-1', 'a', { target_reps_max: current.target_reps_max });
    store().updateExerciseTargets('day-1', 'b', {
      target_sets_min: draftExercise('day-1', 'b').target_sets_min,
      target_sets: draftExercise('day-1', 'b').target_sets,
      target_sets_max: draftExercise('day-1', 'b').target_sets_max,
    });

    expect(store().draft).toBe(before);
    expect(store().isDirty).toBe(false);
  });

  it('syncs a superset partner when sets change and marks the draft dirty', () => {
    store().updateExerciseTargets('day-1', 'b', { target_sets_min: 3, target_sets: 4, target_sets_max: 5 });

    expect(draftExercise('day-1', 'b')).toMatchObject({ target_sets_min: 3, target_sets: 4, target_sets_max: 5 });
    expect(draftExercise('day-1', 'c')).toMatchObject({ target_sets_min: 3, target_sets: 4, target_sets_max: 5 });
    expect(store().isDirty).toBe(true);
  });

  it('keeps a superset partner unchanged when only reps change', () => {
    const partnerBefore = draftExercise('day-1', 'c');

    store().updateExerciseTargets('day-1', 'b', { target_reps_min: 10 });

    expect(draftExercise('day-1', 'b').target_reps_min).toBe(10);
    expect(draftExercise('day-1', 'c')).toBe(partnerBefore);
    expect(store().isDirty).toBe(true);
  });

  it('still normalizes an out-of-order set range', () => {
    store().updateExerciseTargets('day-1', 'a', { target_sets_min: 6, target_sets: 1, target_sets_max: 4 });

    expect(draftExercise('day-1', 'a')).toMatchObject({ target_sets_min: 4, target_sets: 4, target_sets_max: 6 });
  });
});

// The editor memoizes DayCard and ExerciseRow on these identities.
describe('splitEditStore keeps untouched objects for memoized editor rows', () => {
  it('keeps the days array when renaming the program or editing its description', () => {
    const days = store().draft!.days;

    store().renameSplit('Renamed');
    expect(store().draft!.days).toBe(days);

    store().updateDescription('New description');
    expect(store().draft!.days).toBe(days);
  });

  it('replaces only the renamed day', () => {
    const [upper, lower] = store().draft!.days;

    store().renameDay('day-1', 'Upper A');

    const [nextUpper, nextLower] = store().draft!.days;
    expect(nextUpper).not.toBe(upper);
    expect(nextUpper.day_name).toBe('Upper A');
    expect(nextLower).toBe(lower);
  });

  it('replaces only the edited exercise row when targets change', () => {
    const [a, b, c] = store().draft!.days[0].exercises;
    const lower = store().draft!.days[1];

    store().updateExerciseTargets('day-1', 'a', { target_reps_max: 15 });

    const [nextA, nextB, nextC] = store().draft!.days[0].exercises;
    expect(nextA).not.toBe(a);
    expect(nextB).toBe(b);
    expect(nextC).toBe(c);
    expect(store().draft!.days[1]).toBe(lower);
  });
});
