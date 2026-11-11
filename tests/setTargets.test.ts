import { describe, expect, it } from 'vitest';

import {
  describeTarget,
  learnWeightStep,
  liveSetTarget,
  planMovementTargets,
  targetOutcome,
  type PastSession,
  type PastSet,
  type RepRange,
} from '@/lib/setTargets';

const RANGE: RepRange = { min: 8, max: 12 };

let workoutCount = 0;
function session(date: string, weight: number, reps: Array<number | null>, rpe?: Array<number | null>): PastSession {
  workoutCount += 1;
  return {
    workoutId: `w${workoutCount}`,
    date,
    sets: reps.map((count, index): PastSet | null => (count === null ? null : { weight, reps: count, rpe: rpe?.[index] ?? null })),
  };
}

/** Newest first, as the read keeps them. */
const newestFirst = (...sessions: PastSession[]) => [...sessions].reverse();

function figures(result: ReturnType<typeof planMovementTargets>) {
  return result?.sets.map((set) => (set ? `${set.weight}×${set.reps}` : null)) ?? null;
}

describe('set targets: the worked examples', () => {
  it.each([
    { last: [100, [10, 9, 8]], want: ['100×11', '100×9', '100×8'], line: 'one more rep than last time' },
    { last: [100, [12, 10, 9]], want: ['100×12', '100×11', '100×9'], line: 'same as last time' },
    { last: [100, [12, 11, 10]], want: ['105×9', '105×8', '105×8'], line: 'up 5 lb, every set stays in range' },
    { last: [60, [12, 12, 12]], want: ['65×8', '65×8', '65×8'], line: 'up 5 lb, every set reached 12' },
    { last: [25, [12, 12]], want: ['25×13', '25×12'], line: 'one more rep, 30 lb is too big a jump yet' },
  ] as const)('$last.0 × $last.1 → $want', ({ last, want, line }) => {
    const [weight, reps] = last;
    const result = planMovementTargets({
      history: [session('2026-11-01', weight, [...reps])],
      today: '2026-11-05',
      setCount: reps.length,
      range: RANGE,
      equipment: 'Dumbbell',
    });
    expect(figures(result)).toEqual(want);
    expect(describeTarget(result!.sets[0]!)).toBe(line);
  });

  it('names the set that gets the rep, and holds the others', () => {
    const result = planMovementTargets({ history: [session('2026-11-01', 100, [12, 10, 9])], today: '2026-11-04', setCount: 3, range: RANGE });
    expect(result!.sets.map((set) => set!.why.kind)).toEqual(['hold', 'more_reps', 'hold']);
    expect(describeTarget(result!.sets[1]!)).toBe('one more rep than last time');
  });
});

describe('set targets: bad days, breaks and stalls', () => {
  it('one session below target keeps the same target', () => {
    // Target after the first was 100 × 11, 9, 8; the second fell short.
    const history = newestFirst(session('2026-10-01', 100, [10, 9, 8]), session('2026-10-04', 100, [10, 8, 8]));
    const result = planMovementTargets({ history, today: '2026-10-07', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×8']);
    expect(describeTarget(result!.sets[0]!)).toBe('same target, last time fell short');
  });

  it('two sessions below target in a row match what was done, with no extra rep', () => {
    const history = newestFirst(
      session('2026-10-01', 100, [10, 9, 8]),
      session('2026-10-04', 100, [10, 8, 8]),
      session('2026-10-07', 100, [9, 8, 7]),
    );
    const result = planMovementTargets({ history, today: '2026-10-10', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×9', '100×8', '100×7']);
    expect(describeTarget(result!.sets[0]!)).toBe('match last time');
  });

  it('after a match that is met, progress starts again from it', () => {
    const history = newestFirst(
      session('2026-10-01', 100, [10, 9, 8]),
      session('2026-10-04', 100, [10, 8, 8]),
      session('2026-10-07', 100, [9, 8, 7]),
      session('2026-10-10', 100, [9, 8, 7]),
    );
    const result = planMovementTargets({ history, today: '2026-10-13', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×10', '100×8', '100×7']);
  });

  it('starts afresh from a session at a different weight altogether, rather than repeating a stale target', () => {
    const history = newestFirst(session('2026-10-01', 135, [7, 5]), session('2026-10-04', 40, [8, 8]));
    expect(figures(planMovementTargets({ history, today: '2026-10-07', setCount: 2, range: RANGE }))).toEqual(['40×9', '40×8']);
  });

  it('starts afresh two weight steps down, rather than repeating the heavier target', () => {
    // Step 10 learned from 100, 110 and 120; last time came in at 100, two steps under the 120 target.
    const history = newestFirst(session('2026-10-01', 110, [12, 12]), session('2026-10-04', 120, [9, 8]), session('2026-10-07', 100, [10, 9]));
    expect(figures(planMovementTargets({ history, today: '2026-10-10', setCount: 2, range: RANGE }))).toEqual(['100×11', '100×9']);
  });

  it('marks a movement stalled after three sessions with no gain, and the targets still come', () => {
    const history = newestFirst(
      session('2026-10-01', 100, [10, 9, 8]),
      session('2026-10-04', 100, [10, 9, 8]),
      session('2026-10-07', 100, [10, 9, 8]),
      session('2026-10-10', 100, [10, 9, 8]),
    );
    const result = planMovementTargets({ history, today: '2026-10-13', setCount: 3, range: RANGE });
    expect(result!.stalled).toBe(true);
    expect(result!.sets.every(Boolean)).toBe(true);
  });

  it('is not stalled while targets are being hit', () => {
    const history = newestFirst(
      session('2026-10-01', 100, [10, 9, 8]),
      session('2026-10-04', 100, [11, 9, 8]),
      session('2026-10-07', 100, [12, 9, 8]),
      session('2026-10-10', 100, [12, 10, 8]),
    );
    expect(planMovementTargets({ history, today: '2026-10-13', setCount: 3, range: RANGE })!.stalled).toBe(false);
  });

  it('a weight increase that is met counts as a gain, though the estimate drops', () => {
    const history = newestFirst(
      session('2026-10-01', 100, [12, 11, 10]),
      session('2026-10-04', 105, [9, 8, 8]),
      session('2026-10-07', 105, [10, 8, 8]),
      session('2026-10-10', 105, [11, 8, 8]),
    );
    expect(planMovementTargets({ history, today: '2026-10-13', setCount: 3, range: RANGE })!.stalled).toBe(false);
  });

  it('matches last time after more than three weeks away', () => {
    const result = planMovementTargets({ history: [session('2026-10-01', 100, [10, 9, 8])], today: '2026-10-23', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×10', '100×9', '100×8']);
    expect(describeTarget(result!.sets[0]!)).toBe('match last time after a break');
    // Exactly three weeks still progresses.
    expect(figures(planMovementTargets({ history: [session('2026-10-01', 100, [10, 9, 8])], today: '2026-10-22', setCount: 3, range: RANGE })))
      .toEqual(['100×11', '100×9', '100×8']);
  });

  it('a break inside the history is judged against a match target', () => {
    const history = newestFirst(session('2026-08-01', 100, [10, 9, 8]), session('2026-09-15', 100, [10, 9, 8]));
    // The second session matched last time after a break, so it met its target.
    expect(figures(planMovementTargets({ history, today: '2026-09-18', setCount: 3, range: RANGE }))).toEqual(['100×11', '100×9', '100×8']);
  });
});

describe('set targets: no target', () => {
  it('has none for a movement with no history', () => {
    expect(planMovementTargets({ history: [], today: '2026-11-01', setCount: 3, range: RANGE })).toBeNull();
  });

  it('has none when every past set was a hold or a miss', () => {
    expect(planMovementTargets({ history: [session('2026-10-30', 0, [0, 0])], today: '2026-11-01', setCount: 2, range: RANGE })).toBeNull();
    expect(planMovementTargets({ history: [session('2026-10-30', 50, [0, 0])], today: '2026-11-01', setCount: 2, range: RANGE })).toBeNull();
  });

  it('gives a 0 × 0 set no target and keeps the others', () => {
    const result = planMovementTargets({
      history: [{ workoutId: 'h', date: '2026-10-30', sets: [{ weight: 0, reps: 8 }, { weight: 0, reps: 0 }, { weight: 0, reps: 7 }] }],
      today: '2026-11-01',
      setCount: 3,
      range: RANGE,
    });
    expect(figures(result)).toEqual(['0×9', null, '0×7']);
  });

  it('has none with no sets today', () => {
    expect(planMovementTargets({ history: [session('2026-10-30', 100, [10])], today: '2026-11-01', setCount: 0, range: RANGE })).toBeNull();
  });
});

describe('set targets: no rep range', () => {
  it('never raises the weight on its own; reps climb, sets level up before set 1 goes again', () => {
    const flat = planMovementTargets({ history: [session('2026-10-30', 100, [12, 12, 12])], today: '2026-11-01', setCount: 3, range: null });
    expect(figures(flat)).toEqual(['100×13', '100×12', '100×12']);
    const uneven = planMovementTargets({ history: [session('2026-10-30', 100, [13, 12, 12])], today: '2026-11-01', setCount: 3, range: null });
    expect(figures(uneven)).toEqual(['100×13', '100×13', '100×12']);
    expect(describeTarget(uneven!.sets[1]!)).toBe('one more rep than last time');
  });
});

describe('set targets: bodyweight', () => {
  it('adds reps only, one more each time', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 0, [10, 9, 8])], today: '2026-11-01', setCount: 3, range: RANGE, equipment: 'Bodyweight' });
    expect(figures(result)).toEqual(['0×11', '0×9', '0×8']);
    expect(describeTarget(result!.sets[0]!)).toBe('one more rep than last time');
  });

  it('keeps adding reps past the range with no weight to move to', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 0, [12, 12])], today: '2026-11-01', setCount: 2, range: RANGE });
    expect(figures(result)).toEqual(['0×13', '0×12']);
    expect(describeTarget(result!.sets[0]!)).toBe('one more rep than last time');
  });

  it('counts added weight as load', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 25, [12, 11, 10])], today: '2026-11-01', setCount: 3, range: RANGE });
    // At 30 the last set would be about 6: keep adding reps.
    expect(figures(result)).toEqual(['25×12', '25×12', '25×10']);
  });
});

describe('set targets: RPE', () => {
  it('lets an easy set step two reps', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [9, 9, 8], [7, 8, 8])], today: '2026-11-01', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×8']);
    expect(describeTarget(result!.sets[0]!)).toBe('two more reps than last time');
  });

  it('never steps past the top of the range for it', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [11, 9, 8], [6, 8, 8])], today: '2026-11-01', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×12', '100×9', '100×8']);
  });

  it('works without any RPE', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [9, 9, 8])], today: '2026-11-01', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×10', '100×9', '100×8']);
  });
});

describe('set targets: set counts and weights', () => {
  it('gives extra sets the last known set as their base', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [10, 9])], today: '2026-11-01', setCount: 4, range: RANGE });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×9', '100×9']);
  });

  it('drops positions past today\'s set count, and judges the weight only on today\'s sets', () => {
    // At 105 the third set (8) would be about 6, but there are only two sets today.
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [12, 11, 8])], today: '2026-11-01', setCount: 2, range: RANGE });
    expect(figures(result)).toEqual(['105×9', '105×8']);
  });

  it('puts every set on one weight: the one used most; a set at another weight takes the reps beside it', () => {
    const result = planMovementTargets({
      history: [{ workoutId: 'h', date: '2026-10-30', sets: [{ weight: 100, reps: 10 }, { weight: 100, reps: 9 }, { weight: 90, reps: 10 }] }],
      today: '2026-11-01',
      setCount: 3,
      range: RANGE,
    });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×9']);
    // A light ramp-up set first: it takes the working set's reps, not an estimate.
    const ramp = planMovementTargets({
      history: [{ workoutId: 'h', date: '2026-10-30', sets: [{ weight: 40, reps: 15 }, { weight: 50, reps: 10 }] }],
      today: '2026-11-01',
      setCount: 2,
      range: RANGE,
    });
    expect(figures(ramp)).toEqual(['50×11', '50×10']);
  });

  it('a slot never logged takes the set before it', () => {
    const result = planMovementTargets({ history: [session('2026-10-30', 100, [10, 9, null])], today: '2026-11-01', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×9']);
  });

  it('learns the step from the weights logged on the movement', () => {
    const history = newestFirst(session('2026-10-20', 100, [12, 12, 12]), session('2026-10-25', 102.5, [9, 8, 8]), session('2026-10-30', 102.5, [12, 12, 12]));
    expect(learnWeightStep(history)).toBe(2.5);
    expect(figures(planMovementTargets({ history, today: '2026-11-01', setCount: 3, range: RANGE }))).toEqual(['105×10', '105×10', '105×10']);
  });

  it('trusts a bigger step only with three weights behind it', () => {
    expect(learnWeightStep([session('2026-10-20', 100, [10]), session('2026-10-25', 110, [10])])).toBe(5);
    expect(learnWeightStep([session('2026-10-20', 100, [10]), session('2026-10-25', 110, [10]), session('2026-10-28', 120, [10])])).toBe(10);
    expect(learnWeightStep([session('2026-10-20', 100, [10]), session('2026-10-25', 101, [10])])).toBe(5);
  });
});

describe('set targets during a session', () => {
  const targets = planMovementTargets({ history: [session('2026-10-30', 100, [10, 9, 8])], today: '2026-11-01', setCount: 3, range: RANGE });

  it('keeps the plan while set 1 lands near its target', () => {
    expect(liveSetTarget(targets, [{ weight: 100, reps: 10 }], 2)).toMatchObject({ weight: 100, reps: 9, why: { kind: 'hold' } });
    expect(liveSetTarget(targets, [{ weight: 100, reps: 12 }], 2)).toMatchObject({ weight: 100, reps: 9 });
  });

  it('moves later sets with set 1 when it lands two or more reps off', () => {
    const later = liveSetTarget(targets, [{ weight: 100, reps: 8 }], 2);
    expect(later).toMatchObject({ weight: 100, reps: 6, why: { kind: 'moved', cause: 'reps' } });
    expect(describeTarget(later!)).toBe('set 1 came in 3 under, aim for 6 reps');
    expect(liveSetTarget(targets, [{ weight: 100, reps: 14 }, { weight: 100, reps: 12 }], 3)).toMatchObject({ reps: 11 });
    // Set 1 leads; set 2 beating its target does not move set 3.
    expect(liveSetTarget(targets, [{ weight: 100, reps: 11 }, { weight: 100, reps: 12 }], 3)).toMatchObject({ reps: 8, why: { kind: 'hold' } });
    // Unless the latest set is asked to lead.
    expect(liveSetTarget(targets, [{ weight: 100, reps: 11 }, { weight: 100, reps: 12 }], 3, { follow: 'latest' })).toMatchObject({ reps: 11 });
  });

  it('follows the weight the person is using', () => {
    // Set 1 at 110 × 8 is three under its 11: set 2 keeps the planned drop (9 after 11) at 110.
    const later = liveSetTarget(targets, [{ weight: 110, reps: 8 }], 2);
    expect(later).toMatchObject({ weight: 110, reps: 6, why: { kind: 'moved', cause: 'weight' } });
    expect(describeTarget(later!)).toBe('keep 110 lb, aim for 6 reps');
    // A much lighter weight never asks for silly reps.
    expect(liveSetTarget(targets, [{ weight: 45, reps: 9 }], 2)).toMatchObject({ weight: 45, reps: 7 });
  });

  it('gives the first set its plan, and nothing for a set with no target', () => {
    expect(liveSetTarget(targets, [], 1)).toMatchObject({ weight: 100, reps: 11 });
    expect(liveSetTarget(null, [], 1)).toBeNull();
    expect(liveSetTarget(targets, [], 9)).toBeNull();
  });

  it('never crashes on a 0 × 0 set', () => {
    const bodyweight = planMovementTargets({ history: [session('2026-10-30', 0, [10, 9])], today: '2026-11-01', setCount: 2, range: RANGE });
    expect(liveSetTarget(bodyweight, [{ weight: 0, reps: 0 }], 2)).toMatchObject({ weight: 0, reps: 9 });
  });
});

describe('target outcome', () => {
  it('reads hit, beat and missed', () => {
    expect(targetOutcome({ weight: 100, reps: 11 }, { weight: 100, reps: 11 })).toEqual({ kind: 'hit' });
    expect(targetOutcome({ weight: 100, reps: 12 }, { weight: 100, reps: 11 })).toEqual({ kind: 'beat', gain: '+1 rep' });
    expect(targetOutcome({ weight: 100, reps: 13 }, { weight: 100, reps: 11 })).toEqual({ kind: 'beat', gain: '+2 reps' });
    expect(targetOutcome({ weight: 105, reps: 11 }, { weight: 100, reps: 11 })).toEqual({ kind: 'beat', gain: '+5 lb' });
    expect(targetOutcome({ weight: 100, reps: 10 }, { weight: 100, reps: 11 })).toEqual({ kind: 'missed' });
    expect(targetOutcome({ weight: 95, reps: 14 }, { weight: 100, reps: 11 })).toEqual({ kind: 'missed' });
    // Heavier and the estimate level: a hit.
    expect(targetOutcome({ weight: 110, reps: 8 }, { weight: 100, reps: 11 })).toEqual({ kind: 'hit' });
    expect(targetOutcome({ weight: 0, reps: 0 }, { weight: 0, reps: 8 })).toEqual({ kind: 'missed' });
  });
});
