import { describe, expect, it } from 'vitest';

import {
  describeTarget,
  learnWeightStep,
  liveSetTarget,
  planMovementTargets,
  ratedReps,
  repsPastRange,
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
    // Set 1 at the top and every set in the range: up, though the estimate puts set 3 at 7.
    { last: [100, [12, 10, 9]], want: ['105×9', '105×8', '105×7'], line: 'up 5 lb, set 1 reached 12' },
    // Set 3 is still under the range: reps first.
    { last: [100, [12, 10, 7]], want: ['100×12', '100×11', '100×7'], line: 'same as last time' },
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
    const result = planMovementTargets({ history: [session('2026-11-01', 100, [12, 10, 7])], today: '2026-11-04', setCount: 3, range: RANGE });
    expect(result!.sets.map((set) => set!.why.kind)).toEqual(['hold', 'more_reps', 'hold']);
    expect(describeTarget(result!.sets[1]!)).toBe('one more rep than last time');
  });
});

describe('set targets: when the weight goes up', () => {
  const plan = (weight: number, reps: number[], range: RepRange = RANGE, rpe?: Array<number | null>) =>
    planMovementTargets({ history: [session('2026-11-20', weight, reps, rpe)], today: '2026-11-24', setCount: reps.length, range });

  it('goes up once set 1 reaches the top with every set in the range, on a step of a tenth or less', () => {
    // 50 to 55 is a tenth: the estimate alone would hold this at 50 until about 12, 12, 9.
    const result = plan(50, [8, 6, 5], { min: 5, max: 8 });
    expect(result!.sets.every((set) => set!.weight === 55)).toBe(true);
    expect(result!.sets[0]!.reps).toBe(5);
    expect(describeTarget(result!.sets[0]!)).toBe('up 5 lb, set 1 reached 8');
  });

  it('starts later sets on last time\'s drop from set 1, under the range if need be, never under 1', () => {
    expect(figures(plan(100, [12, 10, 8]))).toEqual(['105×9', '105×8', '105×6']);
    expect(figures(plan(50, [8, 5, 5], { min: 5, max: 8 }))).toEqual(['55×5', '55×3', '55×3']);
  });

  it('waits while set 1 is short of the top, or a set is under the range', () => {
    expect(figures(plan(100, [11, 10, 9]))).toEqual(['100×12', '100×10', '100×9']);
    expect(figures(plan(100, [12, 9, 7]))).toEqual(['100×12', '100×10', '100×7']);
  });

  it('still goes up early when every set would land in the range by the estimate', () => {
    const result = plan(200, [11, 11, 11]);
    expect(figures(result)).toEqual(['205×9', '205×9', '205×9']);
    expect(describeTarget(result!.sets[0]!)).toBe('up 5 lb, every set stays in range');
  });

  it('asks for reps past the range before a step over a tenth of the weight', () => {
    // 15 to 20 lb is a third heavier: 5 reps past a 12 to 15 range on every set.
    const range = { min: 12, max: 15 };
    expect(repsPastRange(15, 5, range)).toBe(5);
    expect(repsPastRange(50, 5, range)).toBe(0);
    expect(repsPastRange(25, 5, RANGE)).toBe(2);
    const short = planMovementTargets({ history: [session('2026-11-20', 15, [15, 15])], today: '2026-11-24', setCount: 2, range });
    expect(figures(short)).toEqual(['15×16', '15×15']);
    expect(describeTarget(short!.sets[0]!)).toBe('one more rep, 20 lb is too big a jump yet');
    const ready = planMovementTargets({ history: [session('2026-11-20', 15, [20, 17])], today: '2026-11-24', setCount: 2, range });
    expect(ready!.sets.map((set) => set!.weight)).toEqual([20, 20]);
    expect(ready!.sets[0]!.reps).toBe(12);
  });

  it('counts what a rating says was left: set 1 two short of the top with 4 in reserve goes up', () => {
    const result = plan(100, [10, 9, 8], RANGE, [6, null, null]);
    expect(result!.sets.every((set) => set!.weight === 105)).toBe(true);
    expect(describeTarget(result!.sets[0]!)).toBe('up 5 lb, 4 or more in reserve last time');
    expect(describeTarget(result!.sets[0]!, 'rpe')).toBe('up 5 lb, RPE 6 last time');
  });

  it('never goes up without a rep range, or on bodyweight', () => {
    expect(planMovementTargets({ history: [session('2026-11-20', 100, [15, 15])], today: '2026-11-24', setCount: 2, range: null })!.sets[0]!.weight).toBe(100);
    expect(plan(0, [12, 12])!.sets[0]!.weight).toBe(0);
  });
});

describe('set targets: bad days, breaks and stalls', () => {
  it('one session below target keeps the same target', () => {
    // Target after the first was 100 × 11, 9, 8; the second fell short.
    const history = newestFirst(session('2026-10-01', 100, [10, 9, 8]), session('2026-10-04', 100, [10, 8, 8]));
    const result = planMovementTargets({ history, today: '2026-10-07', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×11', '100×9', '100×8']);
    expect(describeTarget(result!.sets[0]!)).toBe('last time fell short, try again');
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

  it('eases back in after more than five weeks away: two reps under last time', () => {
    const history = [session('2026-09-01', 100, [10, 9, 2])];
    // 35 days still matches.
    expect(figures(planMovementTargets({ history, today: '2026-10-06', setCount: 3, range: RANGE }))).toEqual(['100×10', '100×9', '100×2']);
    const result = planMovementTargets({ history, today: '2026-10-07', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×8', '100×7', '100×1']);
    expect(describeTarget(result!.sets[0]!)).toBe('ease back in after a break');
  });

  it('starts about a tenth lighter after three months away, on a weight the movement loads', () => {
    expect(figures(planMovementTargets({ history: [session('2026-06-01', 100, [10, 9, 8])], today: '2026-09-01', setCount: 3, range: RANGE })))
      .toEqual(['90×10', '90×9', '90×8']);
    // Step 10 learned from 100, 110 and 120: one step down from 120.
    const history = newestFirst(session('2026-05-01', 100, [12, 12]), session('2026-05-04', 110, [10, 9]), session('2026-05-07', 120, [9, 8]));
    expect(figures(planMovementTargets({ history, today: '2026-09-01', setCount: 2, range: RANGE }))).toEqual(['110×9', '110×8']);
    // Too light to step down, and bodyweight: three reps fewer.
    expect(figures(planMovementTargets({ history: [session('2026-06-01', 5, [12, 10])], today: '2026-09-01', setCount: 2, range: RANGE }))).toEqual(['5×9', '5×7']);
    expect(figures(planMovementTargets({ history: [session('2026-06-01', 0, [12, 2])], today: '2026-09-01', setCount: 2, range: RANGE }))).toEqual(['0×9', '0×1']);
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

describe('set targets: the rating sets the pace', () => {
  const rated = (reps: number[], rpe: Array<number | null>, date = '2026-11-20', options?: Parameters<typeof planMovementTargets>[0]['options']) =>
    planMovementTargets({ history: [session(date, 100, reps, rpe)], today: '2026-11-24', setCount: reps.length, range: RANGE, options });

  it('adds one rep at 2 in reserve, two at 3 and three at 4 or more; none at 0 or 1, or unrated', () => {
    expect([10, 9.5, 9, 8.5, 8, 7.5, 7, 6.5, 6].map(ratedReps)).toEqual([0, 0, 0, 0, 1, 1, 2, 2, 3]);
    expect(ratedReps(null)).toBe(0);
    expect(ratedReps(undefined)).toBe(0);
  });

  it('moves every rated set, not only the one that gets the rep anyway', () => {
    // 3, 2 and 2 in reserve. Set 3 stays under the range, so the weight holds.
    const result = rated([9, 8, 6], [7, 8, 8]);
    expect(figures(result)).toEqual(['100×11', '100×9', '100×7']);
    expect(describeTarget(result!.sets[0]!)).toBe('two more reps, 3 in reserve last time');
    expect(describeTarget(result!.sets[1]!)).toBe('one more rep, 2 in reserve last time');
    expect(describeTarget(result!.sets[0]!, 'rpe')).toBe('two more reps, RPE 7 last time');
  });

  it('a hard or unrated set behaves as before: one rep on the first set short of the top', () => {
    expect(figures(rated([9, 9, 6], [9, 10, null]))).toEqual(['100×10', '100×9', '100×6']);
    const result = rated([9, 9, 6], [9, 8, null]);
    expect(figures(result)).toEqual(['100×10', '100×10', '100×6']);
    expect(describeTarget(result!.sets[0]!)).toBe('one more rep than last time');
  });

  it('never steps past the top of the range for it', () => {
    expect(figures(rated([11, 7, 7], [6, null, null]))).toEqual(['100×12', '100×7', '100×7']);
    expect(figures(rated([12, 11, 7], [6, 6, null]))).toEqual(['100×12', '100×12', '100×7']);
  });

  it('adds to a bodyweight set too, with no top to stop at', () => {
    // Inside the range the top still stops it; with every set there, it does not.
    const inside = planMovementTargets({ history: [session('2026-11-20', 0, [12, 10], [6, 8])], today: '2026-11-24', setCount: 2, range: RANGE });
    expect(figures(inside)).toEqual(['0×12', '0×11']);
    const past = planMovementTargets({ history: [session('2026-11-20', 0, [12, 12], [6, 8])], today: '2026-11-24', setCount: 2, range: RANGE });
    expect(figures(past)).toEqual(['0×15', '0×13']);
  });

  it('does not read a rating from before ratings were only ever chosen', () => {
    expect(figures(rated([9, 8, 6], [7, 8, 8], '2026-11-12'))).toEqual(['100×10', '100×8', '100×6']);
    expect(figures(rated([9, 8, 6], [7, 8, 8], '2026-11-13'))).toEqual(['100×11', '100×9', '100×7']);
    expect(figures(rated([9, 8, 6], [7, 8, 8], '2026-11-12', { ratingsFrom: null }))).toEqual(['100×11', '100×9', '100×7']);
  });

  it('works without any rating', () => {
    expect(figures(rated([9, 9, 8], [null, null, null]))).toEqual(['100×10', '100×9', '100×8']);
  });

  it('a set added today has no rating of its own', () => {
    const result = planMovementTargets({ history: [session('2026-11-20', 100, [9, 6], [9, 6])], today: '2026-11-24', setCount: 3, range: RANGE });
    expect(figures(result)).toEqual(['100×10', '100×9', '100×6']);
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
    expect(describeTarget(later!)).toBe('set 1 came in 3 reps under');
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
    expect(describeTarget(later!)).toBe('set 1 went 10 lb heavier');
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
