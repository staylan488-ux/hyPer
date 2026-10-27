import { describe, expect, it } from 'vitest';

import { buildActivityInput, guardActivityEdit, localDateTimeToIso, parseDurationSeconds } from '@/lib/activitySessions';
import {
  buildCalendarDays,
  buildPastSetUpdate,
  moveHistoryMovement,
  orderHistoryMovements,
  progressFromSets,
  summarizeHistoryDay,
} from '@/lib/historyMonth';
import type { WorkoutDayPlan, WorkoutSet } from '@/types';

// History's rules are shared by the web History page and the native History screens.

function set(exerciseId: string, setNumber: number, overrides: Partial<WorkoutSet> = {}): WorkoutSet {
  return {
    id: `${exerciseId}-${setNumber}`,
    workout_id: 'w1',
    exercise_id: exerciseId,
    set_number: setNumber,
    weight: 100,
    reps: 8,
    rpe: null,
    completed: true,
    completed_at: '2026-10-20T18:00:00.000Z',
    exercise: { id: exerciseId, name: `Name ${exerciseId}` },
    ...overrides,
  } as WorkoutSet;
}

describe('buildCalendarDays', () => {
  it('starts on Sunday and pads whole weeks', () => {
    const days = buildCalendarDays(new Date(2026, 9, 15));
    expect(days[0].getDay()).toBe(0);
    expect(days.length % 7).toBe(0);
    // October 2026 starts on a Thursday and ends on a Saturday.
    expect(days[0].getDate()).toBe(27);
    expect(days[days.length - 1].getDate()).toBe(31);
  });
});

describe('orderHistoryMovements', () => {
  const plan: WorkoutDayPlan = {
    id: 'p1',
    workout_id: 'w1',
    day_label: 'Upper',
    items: [
      { exercise_id: 'b', exercise_name: 'Bench', order: 0, target_sets: 3, superset_group_id: 'g1', notes: 'Pause\n[set-range]{"min":2,"max":4}' },
      { exercise_id: 'r', exercise_name: 'Row', order: 1, target_sets: 20, superset_group_id: 'g1' },
      { exercise_id: 'h', exercise_name: 'Hidden', order: 2, hidden: true },
      { exercise_id: 'x', exercise_name: 'No sets', order: 3 },
    ],
  };

  it('keeps plan order, then unplanned movements, and only movements with sets', () => {
    const movements = orderHistoryMovements([set('z', 1), set('r', 2), set('r', 1), set('b', 1), set('h', 1)], plan);
    expect(movements.map((movement) => movement.exerciseId)).toEqual(['b', 'r', 'z', 'h']);
    expect(movements[1].sets.map((entry) => entry.set_number)).toEqual([1, 2]);
  });

  it('pairs superset partners, clamps targets and hides the set-range tag', () => {
    const [bench, row] = orderHistoryMovements([set('b', 1), set('r', 1)], plan);
    expect(bench.partnerName).toBe('Row');
    expect(row.partnerName).toBe('Bench');
    expect(row.targetSets).toBe(12);
    expect(bench.planNote).toBe('Pause');
  });

  it('falls back to the set count and the exercise name without a plan', () => {
    const [only] = orderHistoryMovements([set('z', 1), set('z', 2)], null);
    expect(only).toMatchObject({ name: 'Name z', targetSets: 2, partnerId: null });
  });
});

describe('moveHistoryMovement', () => {
  it('swaps neighbours and refuses moves off either end', () => {
    expect(moveHistoryMovement(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moveHistoryMovement(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(moveHistoryMovement(['a', 'b', 'c'], 'a', -1)).toBeNull();
  });
});

describe('buildPastSetUpdate', () => {
  it('completes a set only with both weight and reps', () => {
    const update = buildPastSetUpdate({ completed_at: null }, { weight: 100, reps: null, rpe: null }, '2026-10-20T19:00:00.000Z');
    expect(update).toMatchObject({ completed: false, completed_at: null });
  });

  it('keeps the set time, else uses the workout time', () => {
    const own = buildPastSetUpdate({ completed_at: '2026-10-20T18:00:00.000Z' }, { weight: 1, reps: 1, rpe: 8 }, '2026-10-20T19:00:00.000Z');
    expect(own.completed_at).toBe('2026-10-20T18:00:00.000Z');
    const fallback = buildPastSetUpdate({ completed_at: null }, { weight: 1, reps: 1, rpe: null }, '2026-10-20T19:00:00.000Z');
    expect(fallback.completed_at).toBe('2026-10-20T19:00:00.000Z');
  });
});

describe('day summaries', () => {
  it('counts lifts and activities, leaving out zeros', () => {
    expect(summarizeHistoryDay(1, 2)).toBe('1 lift · 2 activities');
    expect(summarizeHistoryDay(2, 0)).toBe('2 lifts');
    expect(summarizeHistoryDay(0, 0)).toBe('0 sessions');
    expect(progressFromSets([set('a', 1), set('a', 2, { completed: false })])).toMatchObject({ completedSets: 1, percent: 50, completed: false });
  });
});

describe('buildActivityInput', () => {
  const base = { activityType: 'bike_ride' as const, customType: 'ignored', title: '  ', date: new Date(2026, 9, 20), startTime: '07:30', durationMinutes: '45', notes: '' };

  it('derives the end from start plus duration and keeps the source', () => {
    const input = buildActivityInput(base, { source: 'whoop' });
    expect(input.date).toBe('2026-10-20');
    expect(input.custom_type).toBeNull();
    expect(input.title).toBeNull();
    expect(new Date(input.ended_at!).getTime() - new Date(input.started_at!).getTime()).toBe(45 * 60_000);
    expect(input.source).toBe('whoop');
    expect(buildActivityInput(base, null).source).toBe('manual');
  });

  it('keeps a custom name only for other, at 40 characters', () => {
    const input = buildActivityInput({ ...base, activityType: 'other', customType: 'x'.repeat(60) }, null);
    expect(input.custom_type).toHaveLength(40);
  });

  it('caps duration at a day and rejects bad times', () => {
    expect(parseDurationSeconds('5000')).toBe(24 * 60 * 60);
    expect(parseDurationSeconds('0')).toBeNull();
    expect(localDateTimeToIso(new Date(), '25:00')).toBeNull();
    expect(buildActivityInput({ ...base, startTime: '' }, null).ended_at).toBeNull();
  });

  it('marks edits to auto-grouped WHOOP imports', () => {
    const input = buildActivityInput(base, null);
    expect(guardActivityEdit(input, { source: 'whoop', auto_grouped: true }).user_edited).toBe(true);
    expect(guardActivityEdit(input, { source: 'manual', auto_grouped: false }).user_edited).toBeUndefined();
  });
});
