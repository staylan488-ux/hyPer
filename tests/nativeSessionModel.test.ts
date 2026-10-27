import { describe, expect, it } from 'vitest';

import type { Exercise, FlexiblePlanItem, Split, SplitExercise, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

import { mealForTime } from '../native/src/lib/meals';
import { buildSessionModel } from '../native/src/lib/sessionModel';

// The native app's live-workout model decides which set "Log set" saves to.

const exercise = (id: string, name: string): Exercise => ({
  id,
  name,
  muscle_group: 'chest',
  muscle_group_secondary: null,
  equipment: null,
  is_compound: true,
});

const bench = exercise('bench', 'Barbell Bench Press');
const row = exercise('row', 'Barbell Row');
const incline = exercise('incline', 'Incline Dumbbell Press');

const plan = (exerciseRow: Exercise, order: number): SplitExercise => ({
  id: `plan-${exerciseRow.id}`,
  split_day_id: 'day-1',
  exercise_id: exerciseRow.id,
  exercise: exerciseRow,
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 10,
  exercise_order: order,
  notes: null,
});

const split: Split = {
  id: 'split-1',
  user_id: 'user-1',
  name: 'Upper / Lower',
  description: null,
  days_per_week: 4,
  is_active: true,
  days: [{ id: 'day-1', split_id: 'split-1', day_name: 'Upper A', day_order: 1, exercises: [plan(bench, 1), plan(row, 2), plan(incline, 3)] }],
};

const set = (exerciseRow: Exercise, setNumber: number, completed: boolean): WorkoutSet => ({
  id: `${exerciseRow.id}-${setNumber}`,
  workout_id: 'workout-1',
  exercise_id: exerciseRow.id,
  exercise: exerciseRow,
  set_number: setNumber,
  weight: 80,
  reps: 10,
  rpe: null,
  completed,
  completed_at: completed ? '2026-10-26T16:00:00.000Z' : null,
});

const workout = (sets: WorkoutSet[], overrides: Partial<Workout> = {}): Workout => ({
  id: 'workout-1',
  user_id: 'user-1',
  split_day_id: 'day-1',
  date: '2026-10-26',
  notes: null,
  completed: false,
  created_at: '2026-10-26T15:37:00.000Z',
  sets,
  ...overrides,
});

// Bench done; row and incline untouched. Listed out of program order on purpose.
const midSession = () =>
  workout([
    set(incline, 1, false),
    set(incline, 2, false),
    set(row, 2, false),
    set(row, 1, false),
    set(bench, 1, true),
    set(bench, 2, true),
    set(bench, 3, true),
    set(row, 3, false),
    set(incline, 3, false),
  ]);

describe('buildSessionModel', () => {
  it('orders movements by the program and points at the first unlogged set', () => {
    const model = buildSessionModel(midSession(), { split }, null);
    expect(model?.dayName).toBe('Upper A');
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['bench', 'row', 'incline']);
    expect(model?.sets.map((entry) => entry.id)).toEqual([
      'bench-1', 'bench-2', 'bench-3', 'row-1', 'row-2', 'row-3', 'incline-1', 'incline-2', 'incline-3',
    ]);
    expect(model?.doneCount).toBe(3);
    expect(model?.current?.set.id).toBe('row-1');
    expect(model?.current?.setNumber).toBe(1);
    expect(model?.current?.index).toBe(3);
  });

  it('logs the movement the person chose while it has sets left', () => {
    const model = buildSessionModel(midSession(), { split }, 'incline');
    expect(model?.current?.set.id).toBe('incline-1');
    expect(model?.current?.index).toBe(6);
  });

  it('falls back to the first unfinished movement when the chosen one is finished', () => {
    const model = buildSessionModel(midSession(), { split }, 'bench');
    expect(model?.current?.set.id).toBe('row-1');
  });

  it('picks the lowest unlogged set number when sets were logged out of order', () => {
    const model = buildSessionModel(workout([set(row, 1, false), set(row, 2, true), set(row, 3, false)]), { split }, null);
    expect(model?.current?.set.id).toBe('row-1');
    expect(model?.current?.setNumber).toBe(1);
  });

  it('has no current set once everything is logged, and no model for a finished workout', () => {
    const allDone = workout([set(bench, 1, true), set(row, 1, true)]);
    expect(buildSessionModel(allDone, { split }, null)?.current).toBeNull();
    expect(buildSessionModel({ ...allDone, completed: true }, { split }, null)).toBeNull();
    expect(buildSessionModel(null, { split }, null)).toBeNull();
  });

  it('keeps movements without a plan after planned ones, in the order they appear', () => {
    const curl = exercise('curl', 'Dumbbell Curl');
    const lateral = exercise('lateral', 'Lateral Raise');
    const model = buildSessionModel(
      workout([set(lateral, 1, false), set(row, 1, false), set(curl, 1, false)]),
      { split },
      null,
    );
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['row', 'lateral', 'curl']);
  });

  it('names an unplanned session "Workout"', () => {
    const model = buildSessionModel(workout([set(row, 1, false)], { split_day_id: null }), { split }, null);
    expect(model?.dayName).toBe('Workout');
  });
});

describe('buildSessionModel with the session plan', () => {
  const pulldown = exercise('pulldown', 'Lat Pulldown');
  const item = (exerciseRow: Exercise, order: number, extra: Partial<FlexiblePlanItem> = {}): FlexiblePlanItem => ({
    exercise_id: exerciseRow.id,
    exercise_name: exerciseRow.name,
    order,
    target_sets: 3,
    target_reps_min: 8,
    target_reps_max: 10,
    notes: null,
    hidden: false,
    ...extra,
  });
  const dayPlan = (items: FlexiblePlanItem[], overrides: Partial<WorkoutDayPlan> = {}): WorkoutDayPlan => ({
    id: 'plan-1',
    workout_id: 'workout-1',
    day_label: 'Upper A',
    items,
    ...overrides,
  });

  it('follows the session plan order, like the web Train page', () => {
    const plan = dayPlan([item(incline, 0), item(bench, 1), item(row, 2)]);
    const model = buildSessionModel(midSession(), { split, plan }, null);
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['incline', 'bench', 'row']);
    expect(model?.current?.set.id).toBe('incline-1');
  });

  it('ignores a plan that belongs to another workout', () => {
    const plan = dayPlan([item(incline, 0), item(bench, 1), item(row, 2)], { workout_id: 'other' });
    const model = buildSessionModel(midSession(), { split, plan }, null);
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['bench', 'row', 'incline']);
  });

  it('keeps a swap in the slot it replaced, with the swap marker and a 1 to 10 set range', () => {
    const plan = dayPlan([
      item(bench, 0),
      item(pulldown, 1, {
        target_sets: 2,
        notes: '[set-range]{"min":1,"max":10}',
        substitutes_for: { exercise_id: 'row', exercise_name: 'Barbell Row', notes: null },
      }),
      item(incline, 2),
    ]);
    const swapped = workout([
      set(bench, 1, true),
      set(incline, 1, false),
      set(pulldown, 1, false),
      set(pulldown, 2, false),
    ]);
    const model = buildSessionModel(swapped, { split, plan }, null);
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['bench', 'pulldown', 'incline']);
    const replacement = model?.movements[1];
    expect(replacement?.substitutesFor?.exercise_name).toBe('Barbell Row');
    expect(replacement?.range).toMatchObject({ minSets: 1, maxSets: 10 });
    expect(replacement?.canAddSet).toBe(true);
    expect(replacement?.canRemoveSet).toBe(true);
    expect(model?.current?.set.id).toBe('pulldown-1');
  });

  it('changes the set count past a fixed program count, 1 to 12 sets, removing only unfinished sets', () => {
    const fixed = buildSessionModel(midSession(), { split }, null)?.movements.find((movement) => movement.exerciseId === 'row');
    expect(fixed?.range).toMatchObject({ minSets: 3, maxSets: 3 });
    expect(fixed?.canAddSet).toBe(true);
    expect(fixed?.canRemoveSet).toBe(true);

    const twelve = workout(Array.from({ length: 12 }, (_, index) => set(row, index + 1, false)));
    expect(buildSessionModel(twelve, { split }, null)?.movements[0].canAddSet).toBe(false);

    const one = workout([set(row, 1, false)]);
    expect(buildSessionModel(one, { split }, null)?.movements[0].canRemoveSet).toBe(false);

    const allLogged = workout([set(row, 1, true), set(row, 2, true), set(row, 3, true)]);
    expect(buildSessionModel(allLogged, { split }, null)?.movements[0].canRemoveSet).toBe(false);
  });

  it('reads each movement\'s saved note', () => {
    const noted = { ...midSession(), notes: JSON.stringify({ movementNotes: { row: 'Seat at 4' } }) };
    const model = buildSessionModel(noted, { split }, null);
    expect(model?.movements.find((movement) => movement.exerciseId === 'row')?.note).toBe('Seat at 4');
    expect(model?.movements.find((movement) => movement.exerciseId === 'bench')?.note).toBe('');
  });

  it('names a flexible session by its plan label', () => {
    const flexible = workout([set(row, 1, false)], { split_day_id: null });
    const model = buildSessionModel(flexible, { split, plan: dayPlan([item(row, 0)], { day_label: 'Push day' }) }, null);
    expect(model?.dayName).toBe('Push day');
  });
});

describe('mealForTime', () => {
  const at = (hours: number, minutes: number) => new Date(2026, 9, 26, hours, minutes);

  it('splits the day into breakfast, lunch, dinner and snacks', () => {
    expect(mealForTime(at(6, 0))).toBe('breakfast');
    expect(mealForTime(at(10, 29))).toBe('breakfast');
    expect(mealForTime(at(10, 30))).toBe('lunch');
    expect(mealForTime(at(14, 59))).toBe('lunch');
    expect(mealForTime(at(15, 0))).toBe('dinner');
    expect(mealForTime(at(20, 59))).toBe('dinner');
    expect(mealForTime(at(21, 0))).toBe('snack');
  });
});
