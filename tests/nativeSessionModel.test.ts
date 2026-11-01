import { describe, expect, it } from 'vitest';

import type { Exercise, FlexiblePlanItem, Split, SplitExercise, Workout, WorkoutDayPlan, WorkoutSet } from '@/types';

import { mealForTime } from '../native/src/lib/meals';
import { afterLoggedSet, buildSessionModel, skippedLine } from '../native/src/lib/sessionModel';

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

describe('buildSessionModel with supersets and flexible sessions', () => {
  const curl = exercise('curl', 'Dumbbell Curl');
  const item = (exerciseRow: Exercise, order: number, extra: Partial<FlexiblePlanItem> = {}): FlexiblePlanItem => ({
    exercise_id: exerciseRow.id,
    exercise_name: exerciseRow.name,
    order,
    target_sets: 2,
    notes: null,
    hidden: false,
    ...extra,
  });
  const flexPlan = (items: FlexiblePlanItem[]): WorkoutDayPlan => ({ id: 'plan-1', workout_id: 'workout-1', day_label: 'Push', items });
  const paired = flexPlan([item(bench, 0, { superset_group_id: 'g1' }), item(row, 1, { superset_group_id: 'g1' }), item(curl, 2)]);
  const flexWorkout = (sets: WorkoutSet[]) => workout(sets, { split_day_id: null });

  it('marks a flexible session and its superset pair', () => {
    const model = buildSessionModel(flexWorkout([set(bench, 1, false), set(row, 1, false), set(curl, 1, false)]), { split, plan: paired }, null);
    expect(model?.flexible).toBe(true);
    expect(model?.movements[0].superset).toEqual({ groupId: 'g1', role: 'A', partnerId: 'row', partnerName: 'Barbell Row' });
    expect(model?.movements[1].superset?.role).toBe('B');
    expect(model?.movements[2].superset).toBeNull();
    expect(buildSessionModel(midSession(), { split }, null)?.flexible).toBe(false);
  });

  it('goes A1, B1, A2 and rests only after B', () => {
    const sets = [set(bench, 1, true), set(bench, 2, false), set(row, 1, false), set(row, 2, false)];
    const model = buildSessionModel(flexWorkout(sets), { split, plan: paired }, null);
    // Without a choice, B1 is next: A2 waits for it.
    expect(model?.current?.set.id).toBe('row-1');
    expect(model?.current?.blocked).toBeNull();
    expect(afterLoggedSet(model!, set(bench, 1, true), sets)).toEqual({ nextExerciseId: 'row', rest: false });
    const afterB = [set(bench, 1, true), set(bench, 2, false), set(row, 1, true), set(row, 2, false)];
    expect(afterLoggedSet(model!, set(row, 1, true), afterB)).toEqual({ nextExerciseId: 'bench', rest: true });
  });

  it('explains why a chosen superset set has to wait', () => {
    const sets = [set(bench, 1, true), set(bench, 2, false), set(row, 1, false), set(row, 2, false)];
    const model = buildSessionModel(flexWorkout(sets), { split, plan: paired }, 'bench');
    expect(model?.current?.set.id).toBe('bench-2');
    expect(model?.current?.blocked).toBe('Complete B1 before starting A2.');
  });

  it('leaves a removed movement out of the list but keeps its logged sets in the totals', () => {
    const plan = flexPlan([item(bench, 0), item(curl, 1, { hidden: true })]);
    const model = buildSessionModel(flexWorkout([set(bench, 1, false), set(curl, 1, true)]), { split, plan }, null);
    expect(model?.movements.map((movement) => movement.exerciseId)).toEqual(['bench']);
    expect(model?.doneCount).toBe(1);
    expect(model?.sets).toHaveLength(2);
  });

  it('starts empty when nothing has been added yet', () => {
    const model = buildSessionModel(flexWorkout([]), { split, plan: flexPlan([]) }, null);
    expect(model?.movements).toEqual([]);
    expect(model?.current).toBeNull();
  });
});

describe('buildSessionModel with skipped movements', () => {
  const curl = exercise('curl', 'Dumbbell Curl');
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
  const dayPlan = (items: FlexiblePlanItem[]): WorkoutDayPlan => ({ id: 'plan-1', workout_id: 'workout-1', day_label: 'Upper A', items });
  // Bench done, row and incline to go; row skipped.
  const rowSkipped = dayPlan([item(bench, 0), item(row, 1, { skipped: true }), item(incline, 2)]);

  it('keeps a skipped movement in the list, moves on, and leaves its unlogged sets out of the count', () => {
    const model = buildSessionModel(midSession(), { split, plan: rowSkipped }, null);
    expect(model?.movements.map((movement) => [movement.exerciseId, movement.skipped])).toEqual([
      ['bench', false],
      ['row', true],
      ['incline', false],
    ]);
    expect(model?.current?.set.id).toBe('incline-1');
    // 3 bench (logged) and 3 incline; row's 3 are out.
    expect(model?.sets.map((set) => set.id)).toEqual(['bench-1', 'bench-2', 'bench-3', 'incline-1', 'incline-2', 'incline-3']);
    expect(model?.doneCount).toBe(3);
    expect(model?.current?.index).toBe(3);
  });

  it('keeps the logged sets of a movement skipped part way through', () => {
    const partly = workout([set(bench, 1, true), set(bench, 2, false), set(row, 1, false)]);
    const model = buildSessionModel(partly, { split, plan: dayPlan([item(bench, 0, { skipped: true }), item(row, 1)]) }, null);
    expect(model?.movements[0]).toMatchObject({ skipped: true, done: 1 });
    expect(model?.sets.map((set) => set.id)).toEqual(['bench-1', 'row-1']);
    expect(model?.current?.set.id).toBe('row-1');
  });

  it('treats a skipped movement with every set logged as done', () => {
    const finished = workout([set(bench, 1, true), set(row, 1, false)]);
    const model = buildSessionModel(finished, { split, plan: dayPlan([item(bench, 0, { skipped: true }), item(row, 1)]) }, null);
    expect(model?.movements[0].skipped).toBe(false);
    expect(model?.sets).toHaveLength(2);
  });

  it('shows a skip or a bring-back still saving over the saved plan', () => {
    const skipping = buildSessionModel(midSession(), { split, skips: { row: true } }, null);
    expect(skipping?.movements.find((movement) => movement.exerciseId === 'row')?.skipped).toBe(true);
    expect(skipping?.current?.set.id).toBe('incline-1');

    const bringing = buildSessionModel(midSession(), { split, plan: rowSkipped, skips: { row: false } }, null);
    expect(bringing?.movements.find((movement) => movement.exerciseId === 'row')?.skipped).toBe(false);
    expect(bringing?.current?.set.id).toBe('row-1');
  });

  it('never brings up a skipped movement, even one chosen before', () => {
    const model = buildSessionModel(midSession(), { split, plan: rowSkipped }, 'row');
    expect(model?.current?.movement.exerciseId).toBe('incline');
    const logged = set(incline, 3, true);
    const sets = midSession().sets.map((entry) => (entry.exercise_id === 'incline' ? { ...entry, completed: true } : entry));
    expect(afterLoggedSet(model!, logged, sets).nextExerciseId).toBeNull();
  });

  it('has nothing up once the rest is skipped', () => {
    const plan = dayPlan([item(bench, 0), item(row, 1, { skipped: true }), item(incline, 2, { skipped: true })]);
    const model = buildSessionModel(midSession(), { split, plan }, null);
    expect(model?.current).toBeNull();
    expect(model?.sets).toHaveLength(3);
    expect(model?.doneCount).toBe(3);
  });

  it('leaves a skipped superset partner\'s pair as a movement of its own', () => {
    const paired = dayPlan([
      item(bench, 0, { superset_group_id: 'g1', skipped: true }),
      item(row, 1, { superset_group_id: 'g1' }),
      item(curl, 2),
    ]);
    const sets = [set(bench, 1, false), set(row, 1, false), set(row, 2, false), set(curl, 1, false)];
    const model = buildSessionModel(workout(sets, { split_day_id: null }), { split, plan: paired }, 'row');
    expect(model?.movements.map((movement) => movement.superset)).toEqual([null, null, null]);
    expect(model?.current?.set.id).toBe('row-1');
    expect(model?.current?.blocked).toBeNull();
    expect(afterLoggedSet(model!, set(row, 1, true), sets)).toEqual({ nextExerciseId: 'row', rest: true });
  });

  it('names the skipped movements for Finish', () => {
    const named = (ids: string[]) =>
      skippedLine({ movements: ids.map((id) => ({ name: id, skipped: true })) as never });
    expect(skippedLine({ movements: [] })).toBeNull();
    expect(named(['Row'])).toBe('Skipped Row.');
    expect(named(['Row', 'Curl'])).toBe('Skipped Row and Curl.');
    expect(named(['Row', 'Curl', 'Dip'])).toBe('Skipped 3 movements.');
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
