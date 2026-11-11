import { describe, expect, it } from 'vitest';

import type { MovementHistoryMap } from '@/lib/setTargets';
import type { Exercise, Split, Workout, WorkoutSet } from '@/types';

import { summarize } from '../native/src/lib/finished';
import { buildSessionModel } from '../native/src/lib/sessionModel';
import { countTargets, sessionTargets, setTargetFor, targetFigures, targetLine, targetMoment } from '../native/src/lib/setTargets';

// The live workout's set targets: what Train fills in, says and counts.

const exercise = (id: string, name: string, equipment: string | null = null): Exercise => ({
  id,
  name,
  muscle_group: 'chest',
  muscle_group_secondary: null,
  equipment,
  is_compound: true,
});

const press = exercise('press', 'Incline Dumbbell Press', 'Dumbbell');
const dip = exercise('dip', 'Dip', 'Bodyweight');
const fresh = exercise('fresh', 'New Movement');

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
      exercises: [press, dip, fresh].map((row, index) => ({
        id: `plan-${row.id}`,
        split_day_id: 'day-1',
        exercise_id: row.id,
        exercise: row,
        target_sets: 3,
        target_reps_min: 8,
        target_reps_max: 12,
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
  completed_at: completed ? '2026-11-12T16:00:00.000Z' : null,
});

const workout = (sets: WorkoutSet[]): Workout => ({
  id: 'workout-1',
  user_id: 'user-1',
  split_day_id: 'day-1',
  date: '2026-11-12',
  notes: null,
  completed: false,
  created_at: '2026-11-12T15:30:00.000Z',
  sets,
});

const history: MovementHistoryMap = {
  press: [{ workoutId: 'w1', date: '2026-11-08', sets: [{ weight: 60, reps: 10 }, { weight: 60, reps: 9 }, { weight: 60, reps: 8 }] }],
  dip: [{ workoutId: 'w1', date: '2026-11-08', sets: [{ weight: 0, reps: 12 }, { weight: 0, reps: 10 }, { weight: 0, reps: 0 }] }],
};

const unlogged = (row: Exercise) => [1, 2, 3].map((n) => set(row, n, null, null, false));

function model(sets: WorkoutSet[]) {
  return buildSessionModel(workout(sets), { split }, null)!;
}

describe('set targets in a live workout', () => {
  it('gives each movement with history its targets, and none to a new one', () => {
    const session = model([...unlogged(press), ...unlogged(dip), ...unlogged(fresh)]);
    const targets = sessionTargets(session, history);
    expect([...targets.keys()].sort()).toEqual(['dip', 'press']);
    const movement = session.movements.find((entry) => entry.exerciseId === 'press')!;
    expect(movement.sets.map((entry) => setTargetFor(entry, movement.sets, targets)).map((target) => target && targetFigures(target)))
      .toEqual(['60 × 11', '60 × 9', '60 × 8']);
    const fresher = session.movements.find((entry) => entry.exerciseId === 'fresh')!;
    expect(setTargetFor(fresher.sets[0], fresher.sets, targets)).toBeNull();
  });

  it('gives a bodyweight set its reps alone, and a set after a 0-rep set none', () => {
    const session = model(unlogged(dip));
    const targets = sessionTargets(session, history);
    const movement = session.movements[0];
    const [first, second, third] = movement.sets.map((entry) => setTargetFor(entry, movement.sets, targets));
    // Set 1 is at the top of 8–12: set 2 gets the rep.
    expect(targetFigures(first!)).toBe('12 reps');
    expect(second).toMatchObject({ weight: 0, reps: 11 });
    expect(third).toBeNull();
  });

  it('moves later targets with set 1 once it is logged', () => {
    const session = model([set(press, 1, 60, 8, true), set(press, 2, null, null, false), set(press, 3, null, null, false)]);
    const targets = sessionTargets(session, history);
    const movement = session.movements[0];
    expect(setTargetFor(movement.sets[1], movement.sets, targets)).toMatchObject({ weight: 60, reps: 6 });
    // Set 1's own target stays what it was before it was logged.
    expect(setTargetFor(movement.sets[0], movement.sets, targets)).toMatchObject({ weight: 60, reps: 11 });
  });

  it('has no targets with no history, or no session', () => {
    const session = model(unlogged(press));
    expect(sessionTargets(session, {}).size).toBe(0);
    expect(sessionTargets(null, history).size).toBe(0);
  });

  it('fails soft on history it cannot read', () => {
    const broken = { press: [{ workoutId: 'w1', date: 'not a date', sets: [null, { weight: Number.NaN, reps: 8 }] }] } as unknown as MovementHistoryMap;
    const session = model(unlogged(press));
    const targets = sessionTargets(session, broken);
    const movement = session.movements[0];
    expect(() => movement.sets.map((entry) => setTargetFor(entry, movement.sets, targets))).not.toThrow();
  });
});

describe('what the card says', () => {
  const target = { weight: 60, reps: 11, why: { kind: 'more_reps' as const, reps: 1 } };

  it('gives the target line, and figures with units for VoiceOver', () => {
    expect(targetLine(target)).toBe('Target · one more rep than last time');
    expect(targetFigures(target)).toBe('60 × 11');
    expect(targetFigures(target, true)).toBe('60 lb × 11 reps');
    expect(targetFigures({ ...target, weight: 0, reps: 1 }, true)).toBe('1 rep');
  });

  it('says hit or beat after a log, and nothing for a miss', () => {
    expect(targetMoment({ weight: 60, reps: 11 }, target)).toBe('Target hit');
    expect(targetMoment({ weight: 60, reps: 12 }, target)).toBe('Beat target · +1 rep');
    expect(targetMoment({ weight: 65, reps: 11 }, target)).toBe('Beat target · +5 lb');
    expect(targetMoment({ weight: 60, reps: 10 }, target)).toBeNull();
  });
});

describe('targets hit in a session', () => {
  it('counts logged sets against their targets, as Session complete shows them', () => {
    const session = model([
      set(press, 1, 60, 11, true),
      set(press, 2, 60, 10, true),
      set(press, 3, 60, 7, true),
      set(dip, 1, 0, 13, true),
      set(dip, 2, null, null, false),
      set(dip, 3, null, null, false),
      set(fresh, 1, 50, 10, true),
    ]);
    expect(countTargets(session, sessionTargets(session, history))).toEqual({ hit: 3, total: 4 });
    expect(summarize(session, {}, new Date('2026-11-12T17:00:00Z'), {}, history).targets).toEqual({ hit: 3, total: 4 });
    expect(summarize(session).targets).toEqual({ hit: 0, total: 0 });
  });
});
