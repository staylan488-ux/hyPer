import { describe, expect, it } from 'vitest';

import {
  orderSessionSets,
  sessionExercises,
  sessionOrder,
  sessionPlanItems,
  sessionSetRanges,
  sessionSubstitutions,
  setCountChanges,
} from '@/lib/sessionPlan';
import type { FlexiblePlanItem, SplitExercise, WorkoutSet } from '@/types';

// The live session's plan rules, shared by the web Train page and the native app.

const dayExercise = (exerciseId: string, order: number, notes: string | null = null): SplitExercise => ({
  id: `plan-${exerciseId}`,
  split_day_id: 'day-1',
  exercise_id: exerciseId,
  exercise: { id: exerciseId, name: exerciseId, muscle_group: 'back', muscle_group_secondary: null, equipment: null, is_compound: true },
  target_sets: 3,
  target_reps_min: 8,
  target_reps_max: 10,
  exercise_order: order,
  notes,
});

const planItem = (exerciseId: string, order: number, extra: Partial<FlexiblePlanItem> = {}): FlexiblePlanItem => ({
  exercise_id: exerciseId,
  order,
  ...extra,
});

const set = (exerciseId: string, setNumber: number, completed = false): Pick<WorkoutSet, 'exercise_id' | 'set_number' | 'completed'> => ({
  exercise_id: exerciseId,
  set_number: setNumber,
  completed,
});

describe('session plan', () => {
  it('uses the plan only when it belongs to this workout', () => {
    const plan = { workout_id: 'w1', items: [planItem('row', 0)] };
    expect(sessionPlanItems(plan, 'w1')).toHaveLength(1);
    expect(sessionPlanItems(plan, 'w2')).toBeUndefined();
    expect(sessionPlanItems(null, 'w1')).toBeUndefined();
  });

  it('takes plan items, with a 3-set default, over the program day', () => {
    const fromPlan = sessionExercises([planItem('row', 4, { target_sets: null })], [dayExercise('bench', 0)]);
    expect(fromPlan).toEqual([expect.objectContaining({ exercise_id: 'row', exercise_order: 4, target_sets: 3, notes: null })]);
    expect(sessionExercises(undefined, [dayExercise('bench', 0)]).map((entry) => entry.exercise_id)).toEqual(['bench']);
    expect(sessionExercises(undefined, undefined)).toEqual([]);
  });

  it('orders sets by movement place, unplanned movements last, then set number', () => {
    const order = sessionOrder(sessionExercises(undefined, [dayExercise('row', 1), dayExercise('bench', 0)]));
    const ordered = orderSessionSets([set('curl', 1), set('row', 2), set('bench', 2), set('row', 1), set('bench', 1)], order);
    expect(ordered.map((entry) => `${entry.exercise_id}${entry.set_number}`)).toEqual(['bench1', 'bench2', 'row1', 'row2', 'curl1']);
  });

  it('lists visible swaps by replacement', () => {
    const swap = { exercise_id: 'row', exercise_name: 'Barbell Row' };
    const map = sessionSubstitutions([
      planItem('pulldown', 0, { substitutes_for: swap }),
      planItem('hidden', 1, { substitutes_for: swap, hidden: true }),
      planItem('bench', 2),
    ]);
    expect([...map.keys()]).toEqual(['pulldown']);
  });

  it('allows set changes within the planned range, 1 to 12 without a plan', () => {
    const ranges = sessionSetRanges(sessionExercises(undefined, [dayExercise('row', 0, '[set-range]{"min":2,"max":4}'), dayExercise('bench', 1)]));
    expect(setCountChanges(ranges.get('row'), [set('row', 1), set('row', 2), set('row', 3)])).toEqual({ canAdd: true, canRemove: true });
    expect(setCountChanges(ranges.get('bench'), [set('bench', 1), set('bench', 2), set('bench', 3)])).toEqual({ canAdd: false, canRemove: false });
    expect(setCountChanges(undefined, [set('curl', 1, true), set('curl', 2, true)])).toEqual({ canAdd: true, canRemove: false });
  });
});
