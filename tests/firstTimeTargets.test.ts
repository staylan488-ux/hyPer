import { describe, expect, it } from 'vitest';

import { closeRelatives, isCloseRelative, pastSessionsFromRows, readFirstTimes, RELATIVE_MAX_AGE_DAYS, startFromRelatives } from '@/lib/firstTimeTargets';
import type { MovementSetRow } from '@/lib/movementHistory';
import { describeTarget, liveSetTarget, planFirstTime, sessionWorkingSet, type LoggedSet, type PastSession } from '@/lib/setTargets';

// A movement with no history: where its first session starts, and how each
// later set follows the one before (docs/set-targets.md, "The first time").

const RANGE = { min: 8, max: 12 };
const plan = (setCount = 3, range: typeof RANGE | null = RANGE) => planFirstTime({ setCount, range })!;
const next = (logged: LoggedSet[], range: typeof RANGE | null = RANGE) => liveSetTarget(plan(3, range), logged, logged.length + 1);

describe('the first session of a movement', () => {
  it('has no target for set 1 with nothing to start from', () => {
    const targets = plan();
    expect(targets.sets).toEqual([null, null, null]);
    expect(targets.firstTime).toEqual({ range: RANGE });
    expect(targets.stalled).toBe(false);
    expect(liveSetTarget(targets, [], 1)).toBeNull();
    expect(planFirstTime({ setCount: 0, range: RANGE })).toBeNull();
  });

  it('opens every set on the start a relative gives, until a set is logged', () => {
    const targets = planFirstTime({ setCount: 3, range: RANGE, start: { weight: 105, reps: 8, from: 'Lat Pulldown' }, step: 10 })!;
    expect(targets.step).toBe(10);
    expect(liveSetTarget(targets, [], 1)).toEqual({ weight: 105, reps: 8, why: { kind: 'first_time', from: 'Lat Pulldown' } });
    expect(liveSetTarget(targets, [null], 2)).toMatchObject({ weight: 105, reps: 8 });
    expect(describeTarget(targets.sets[0]!)).toBe('light, from your Lat Pulldown');
  });

  it('stays at the weight for two reps fewer after a set inside the range', () => {
    expect(next([{ weight: 100, reps: 10 }])).toEqual({ weight: 100, reps: 8, why: { kind: 'found', move: 'keep', by: 0, set: 1 } });
    expect(describeTarget(next([{ weight: 100, reps: 10 }])!)).toBe('follows set 1');
    // One short of the range is not worth a change of weight.
    expect(next([{ weight: 100, reps: 7 }])).toMatchObject({ weight: 100, reps: 5 });
  });

  it('asks a rep under what a set rated easy could have gone to', () => {
    // 2 in reserve reads as one more rep in it; 3 as two.
    expect(next([{ weight: 100, reps: 10, rpe: 8 }])).toMatchObject({ weight: 100, reps: 10 });
    expect(next([{ weight: 100, reps: 12, rpe: 8 }])).toMatchObject({ weight: 100, reps: 11 });
    expect(next([{ weight: 100, reps: 10, rpe: 7 }])).toMatchObject({ weight: 100, reps: 11 });
  });

  it('goes up when a set ran two or more past the range, by its rating or its reps', () => {
    const rated = next([{ weight: 100, reps: 12, rpe: 7 }])!;
    expect(rated).toEqual({ weight: 110, reps: 10, why: { kind: 'found', move: 'up', by: 10, set: 1, edge: 12, rated: 7 } });
    expect(describeTarget(rated)).toBe('up 10 lb, set 1 had 3 in reserve');
    expect(describeTarget(rated, 'rpe')).toBe('up 10 lb, set 1 was RPE 7');
    const reps = next([{ weight: 100, reps: 15 }])!;
    expect(reps).toMatchObject({ weight: 110, reps: 10 });
    expect(describeTarget(reps)).toBe('up 10 lb, set 1 went past 12');
  });

  it('never raises the weight by more than a quarter in one go', () => {
    expect(next([{ weight: 50, reps: 30 }])).toMatchObject({ weight: 60, reps: 12 });
  });

  it('keeps the weight when the next step up is too big to land in the range', () => {
    expect(next([{ weight: 20, reps: 14 }])).toMatchObject({ weight: 20, reps: 10, why: { move: 'keep' } });
  });

  it('comes down when a set fell two or more short, and asks only for the bottom of the range', () => {
    const down = next([{ weight: 100, reps: 5 }])!;
    expect(down).toEqual({ weight: 85, reps: 8, why: { kind: 'found', move: 'down', by: 15, set: 1, edge: 8 } });
    expect(describeTarget(down)).toBe('down 15 lb, set 1 came in under 8');
  });

  it('follows the latest set logged, not set 1', () => {
    const third = next([{ weight: 100, reps: 15 }, { weight: 110, reps: 10 }])!;
    expect(third).toEqual({ weight: 110, reps: 8, why: { kind: 'found', move: 'keep', by: 0, set: 2 } });
    expect(describeTarget(third)).toBe('follows set 2');
    // A slot logged with no reps is passed over.
    expect(next([{ weight: 100, reps: 10 }, { weight: 100, reps: 0 }])).toMatchObject({ weight: 100, reps: 8, why: { set: 1 } });
  });

  it('leaves the weight alone with no rep range, and on bodyweight', () => {
    expect(next([{ weight: 100, reps: 20 }], null)).toMatchObject({ weight: 100, reps: 18, why: { move: 'keep' } });
    expect(next([{ weight: 0, reps: 12 }])).toMatchObject({ weight: 0, reps: 10 });
    expect(next([{ weight: 0, reps: 1 }])).toMatchObject({ weight: 0, reps: 1 });
  });
});

const row = (id: string, name: string, equipment: string | null) => ({ id, name, equipment });
const pulldown = row('pulldown', 'Lat Pulldown', 'Cable');
const closeGrip = row('close', 'Close-Grip Lat Pulldown', 'Cable');
const oneArm = row('one', 'One-Arm Lat Pulldown', 'Cable');
const backSquat = row('squat', 'Barbell Back Squat', 'Barbell');
const frontSquat = row('front', 'Front Squat', 'Barbell');
const hack = row('hack', 'Hack Squat', 'Machine');
const legPress = row('press', 'Leg Press', 'Machine');
const bench = row('bench', 'Flat Barbell Bench Press', 'Barbell');
const dumbbellBench = row('dbbench', 'Flat Dumbbell Bench Press', 'Dumbbell');
const incline = row('incline', 'Incline Barbell Bench Press', 'Barbell');
const rdl = row('rdl', 'Romanian Deadlift', 'Barbell');
const goodMorning = row('gm', 'Good Morning', 'Barbell');
const cableCurl = row('curl', 'Cable Curl', 'Cable');
const bayesian = row('bayesian', 'Bayesian Cable Curl', 'Cable');
const library = [pulldown, closeGrip, oneArm, backSquat, frontSquat, hack, legPress, bench, dumbbellBench, incline, rdl, goodMorning, cableCurl, bayesian];

const session = (date: string, ...sets: Array<[number, number]>): PastSession => ({ workoutId: `w-${date}`, date, sets: sets.map(([weight, reps]) => ({ weight, reps })) });

describe('a close relative', () => {
  it('is the same kind of movement on the same bar, dumbbells or cable', () => {
    expect(isCloseRelative(closeGrip, pulldown)).toBe(true);
    expect(isCloseRelative(frontSquat, backSquat)).toBe(true);
    expect(closeRelatives(closeGrip, library).map((entry) => entry.name)).toEqual(['Lat Pulldown']);
  });

  it('is never a machine, other equipment, another pattern or the movement itself', () => {
    // A machine's number belongs to that machine.
    expect(isCloseRelative(hack, legPress)).toBe(false);
    expect(isCloseRelative(dumbbellBench, bench)).toBe(false);
    expect(isCloseRelative(incline, bench)).toBe(false);
    expect(isCloseRelative(pulldown, pulldown)).toBe(false);
    expect(isCloseRelative(row('x', 'Mystery Lift', 'Barbell'), bench)).toBe(false);
  });

  it('is not one side for both, or a variant done far lighter', () => {
    expect(isCloseRelative(oneArm, pulldown)).toBe(false);
    expect(isCloseRelative(goodMorning, rdl)).toBe(false);
    expect(isCloseRelative(bayesian, cableCurl)).toBe(false);
    // The other way round only starts lighter still.
    expect(isCloseRelative(rdl, goodMorning)).toBe(true);
  });
});

describe('a start from a relative', () => {
  it('is three quarters of its working weight, for its reps inside the new range', () => {
    const relatives = [{ exercise: pulldown, history: [session('2026-11-10', [140, 7], [140, 6])] }];
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives })).toEqual({ weight: 105, reps: 8, from: 'Lat Pulldown', step: 5 });
    expect(startFromRelatives({ range: null, today: '2026-11-18', relatives })).toMatchObject({ weight: 105, reps: 7 });
    expect(startFromRelatives({ range: { min: 4, max: 6 }, today: '2026-11-18', relatives })).toMatchObject({ reps: 6 });
  });

  it('lands on a weight the relative is known to load', () => {
    // 150, 160 and 170 logged: the stack moves in tens.
    const history = [session('2026-11-10', [170, 8]), session('2026-11-03', [160, 9]), session('2026-10-27', [150, 10])];
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives: [{ exercise: pulldown, history }] })).toMatchObject({ weight: 120, step: 10 });
  });

  it('reads the session\'s working weight, not a ramp-up set', () => {
    const history = [session('2026-11-10', [95, 10], [135, 8], [135, 7])];
    expect(sessionWorkingSet(history[0])).toEqual({ weight: 135, reps: 8 });
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives: [{ exercise: backSquat, history }] })).toMatchObject({ weight: 100, reps: 8 });
  });

  it('takes the relative trained most recently', () => {
    const relatives = [
      { exercise: pulldown, history: [session('2026-10-01', [140, 8])] },
      { exercise: row('wide', 'Wide-Grip Lat Pulldown', 'Cable'), history: [session('2026-11-12', [120, 10])] },
    ];
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives })).toMatchObject({ weight: 90, reps: 10, from: 'Wide-Grip Lat Pulldown' });
  });

  it('has nothing to say from a relative trained long ago, on bodyweight, or with none', () => {
    const old = [{ exercise: pulldown, history: [session('2026-08-01', [140, 8])] }];
    expect(RELATIVE_MAX_AGE_DAYS).toBe(84);
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives: old })).toBeNull();
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives: [{ exercise: pulldown, history: [session('2026-11-10', [0, 12])] }] })).toBeNull();
    expect(startFromRelatives({ range: RANGE, today: '2026-11-18', relatives: [] })).toBeNull();
  });
});

const setRow = (exerciseId: string, workoutId: string, date: string, setNumber: number, weight: number, reps: number): MovementSetRow => ({
  id: `${workoutId}-${exerciseId}-${setNumber}`,
  workout_id: workoutId,
  exercise_id: exerciseId,
  set_number: setNumber,
  weight,
  reps,
  completed: true,
  workout: { date, created_at: `${date}T15:00:00.000Z`, completed: true },
});

describe('the wider read', () => {
  const rows = [
    setRow('pulldown', 'w2', '2026-11-10', 1, 140, 7),
    setRow('pulldown', 'w2', '2026-11-10', 2, 140, 6),
    setRow('pulldown', 'w1', '2026-11-03', 1, 135, 8),
    setRow('squat', 'w0', '2026-03-01', 2, 185, 6),
    setRow('squat', 'w0', '2026-03-01', 1, 185, 8),
    // The live workout, and a day after it, are not history.
    setRow('pulldown', 'live', '2026-11-18', 1, 150, 5),
    setRow('pulldown', 'w9', '2026-11-19', 1, 150, 5),
  ];

  it('lays each movement\'s sessions out newest first, by set position', () => {
    const history = pastSessionsFromRows(rows, { workoutId: 'live', date: '2026-11-18' });
    expect(history.pulldown.map((entry) => entry.workoutId)).toEqual(['w2', 'w1']);
    expect(history.pulldown[0].sets).toEqual([{ weight: 140, reps: 7 }, { weight: 140, reps: 6 }]);
    expect(history.squat[0].sets).toEqual([{ weight: 185, reps: 8 }, { weight: 185, reps: 6 }]);
  });

  it('gives a movement trained long ago its own sessions, and a new one a start', () => {
    const read = readFirstTimes({
      movements: [backSquat, closeGrip, hack],
      library,
      rows,
      workoutId: 'live',
      date: '2026-11-18',
      ranges: { close: RANGE },
    });
    // Trained in March: the usual rule eases it back in from there.
    expect(read.history.squat).toHaveLength(1);
    expect('squat' in read.starts).toBe(false);
    expect(read.starts.close).toEqual({ weight: 105, reps: 8, from: 'Lat Pulldown', step: 5 });
    // Never trained, and a machine: known to be a first time, with nothing to start from.
    expect(read.starts.hack).toBeNull();
  });
});
