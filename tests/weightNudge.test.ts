import { describe, expect, it } from 'vitest';

import { describeWeightNudge, raisedTarget, weightNudge, type WeightNudgeInput } from '@/lib/weightNudge';
import type { WeightSampleLike } from '@/lib/weightTrend';

const NOW = new Date(2026, 10, 16, 12, 0, 0); // Monday 16 Nov 2026, local noon

/** Morning weigh-ins on the given days before today (0 is today), following a steady pace. */
function weighIns(daysAgo: number[], startKg = 59, kgPerDay = 0): WeightSampleLike[] {
  const first = Math.max(...daysAgo);
  return daysAgo.map((ago) => ({
    measured_at: new Date(2026, 10, 16 - ago, 8, 0, 0).toISOString(),
    kilograms: startKg + kgPerDay * (first - ago),
  }));
}

const EVERY_OTHER_DAY = [20, 18, 16, 14, 12, 10, 8, 6, 4, 2, 0];

function input(overrides: Partial<WeightNudgeInput> = {}): WeightNudgeInput {
  return {
    profile: { adaptive_enabled: true, goal: 'bulk', rate_pct_per_week: 0.35, phase_started_on: '2026-09-01', expenditure_confidence: 'predicted' },
    target: { source: 'calculated', updated_at: new Date(2026, 9, 1).toISOString() },
    weightSamples: weighIns(EVERY_OTHER_DAY),
    now: NOW,
    ...overrides,
  };
}

describe('the flat-weight offer', () => {
  it('is made when the weight sat flat for three weeks on a gaining goal', () => {
    const nudge = weightNudge(input());
    expect(nudge).not.toBeNull();
    // 59 kg at 0.35% a week is about 0.2 kg; the missing surplus is about 225 kcal, held to 150.
    expect(nudge!.goalKgPerWeek).toBeCloseTo(0.2065, 3);
    expect(nudge!.kgPerWeek).toBeCloseTo(0, 6);
    expect(nudge!.raiseKcal).toBe(150);
    expect(describeWeightNudge(nudge!, 'lb')).toEqual({
      title: 'Weight flat for 3 weeks',
      line: 'Your goal is about 0.5 lb a week.',
      action: 'Add 150 kcal',
    });
    expect(describeWeightNudge(nudge!, 'kg').line).toBe('Your goal is about 0.21 kg a week.');
  });

  it('says a falling weight plainly', () => {
    const nudge = weightNudge(input({ weightSamples: weighIns(EVERY_OTHER_DAY, 59.6, -0.03) }));
    expect(nudge!.raiseKcal).toBe(150);
    expect(describeWeightNudge(nudge!, 'lb').title).toBe('Weight down 0.5 lb a week for 3 weeks');
  });

  it('offers less when the goal is slow', () => {
    // 0.2% of 59 kg is about 0.12 kg a week: about 130 kcal missing, in steps of 25.
    const nudge = weightNudge(input({ profile: { ...input().profile!, goal: 'lean_bulk', rate_pct_per_week: 0.2 } }));
    expect(nudge!.raiseKcal).toBe(125);
  });

  it('says nothing while the weight is rising, even slowly', () => {
    // 0.01 kg a day is 0.07 kg a week: behind the goal, but moving.
    expect(weightNudge(input({ weightSamples: weighIns(EVERY_OTHER_DAY, 59, 0.01) }))).toBeNull();
  });

  it('is only for a goal of gaining', () => {
    expect(weightNudge(input({ profile: { ...input().profile!, goal: 'cut', rate_pct_per_week: -0.5 } }))).toBeNull();
    expect(weightNudge(input({ profile: { ...input().profile!, goal: 'maintain', rate_pct_per_week: 0 } }))).toBeNull();
  });

  it('steps aside once a burn is learned: the weekly update reacts to the scale itself', () => {
    expect(weightNudge(input({ profile: { ...input().profile!, expenditure_confidence: 'learning' } }))).toBeNull();
    expect(weightNudge(input({ profile: { ...input().profile!, expenditure_confidence: 'measured' } }))).toBeNull();
  });

  it('never touches a target typed by hand, or one with adapting off', () => {
    expect(weightNudge(input({ target: { source: 'manual', updated_at: new Date(2026, 9, 1).toISOString() } }))).toBeNull();
    expect(weightNudge(input({ profile: { ...input().profile!, adaptive_enabled: false } }))).toBeNull();
    expect(weightNudge(input({ target: null }))).toBeNull();
    expect(weightNudge(input({ profile: null }))).toBeNull();
  });

  it('waits three weeks on the target as it stands, so one raise does not bring the next', () => {
    const raisedLastWeek = { source: 'calculated' as const, updated_at: new Date(2026, 10, 9, 9).toISOString() };
    expect(weightNudge(input({ target: raisedLastWeek }))).toBeNull();
    // 27 Oct is the first of the 21 days read: a target from that day or before has stood through all of them.
    expect(weightNudge(input({ target: { source: 'calculated', updated_at: new Date(2026, 9, 27, 9).toISOString() } }))).not.toBeNull();
    expect(weightNudge(input({ target: { source: 'calculated', updated_at: new Date(2026, 9, 28, 9).toISOString() } }))).toBeNull();
    expect(weightNudge(input({ target: { source: 'calculated' } }))).toBeNull();
  });

  it('skips the first week of a new goal', () => {
    expect(weightNudge(input({ profile: { ...input().profile!, phase_started_on: '2026-10-25' } }))).toBeNull();
    expect(weightNudge(input({ profile: { ...input().profile!, phase_started_on: '2026-10-20' } }))).not.toBeNull();
  });

  it('needs enough weigh-ins, across two weeks, and a recent one', () => {
    expect(weightNudge(input({ weightSamples: weighIns([20, 15, 10, 5, 0]) }))).toBeNull();
    expect(weightNudge(input({ weightSamples: weighIns([10, 8, 6, 4, 3, 2, 1, 0]) }))).toBeNull();
    expect(weightNudge(input({ weightSamples: weighIns([20, 19, 18, 17, 16, 15, 14, 9]) }))).toBeNull();
    expect(weightNudge(input({ weightSamples: weighIns([20, 17, 14, 11, 8, 5, 2]) }))).not.toBeNull();
  });

  it('reads only the last three weeks', () => {
    // A big gain a month ago does not make the last three flat weeks a gain.
    const older = weighIns([40, 35, 30, 25], 57, 0.13);
    expect(weightNudge(input({ weightSamples: [...older, ...weighIns(EVERY_OTHER_DAY)] }))).not.toBeNull();
  });
});

describe('taking the raise', () => {
  it('adds the calories as carbs and fat in their own split, and leaves protein', () => {
    const next = raisedTarget({ calories: 2800, protein: 105, carbs: 420, fat: 78, source: 'calculated' }, 150);
    expect(next.calories).toBe(2950);
    expect(next.protein).toBe(105);
    expect(next.carbs).toBeGreaterThan(420);
    expect(next.fat).toBeGreaterThan(78);
    expect(Math.abs(next.protein * 4 + next.carbs * 4 + next.fat * 9 - 2950)).toBeLessThanOrEqual(9);
  });

  it('stays a target the weekly update can move', () => {
    expect(raisedTarget({ calories: 2800, protein: 105, carbs: 420, fat: 78, source: 'calculated' }, 100).source).toBe('calculated');
    expect(raisedTarget({ calories: 2800, protein: 105, carbs: 420, fat: 78, source: 'adaptive' }, 100).source).toBe('adaptive');
    expect(raisedTarget({ calories: 2800, protein: 105, carbs: 420, fat: 78 }, 100).source).toBe('calculated');
  });
});
