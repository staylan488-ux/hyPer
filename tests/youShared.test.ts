import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn() } }));

import {
  convertWeighInDraft,
  lastWeighInLabel,
  parseWeighIn,
  weeklyRateLabel,
} from '@/lib/bodyWeightSummary';
import { foodTrialUsageLine } from '@/lib/foodTrialUsage';
import { healthSyncMessage } from '@/lib/healthWeights';
import { lbsToKg } from '@/lib/nutritionCalculator';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import {
  initialWizardDraft,
  selectWizardGoal,
  stepWizardRate,
  switchWizardUnits,
  wizardBodyFatPct,
  wizardBodyReady,
  learnedBurnLooksLow,
  wizardBreakdown,
  wizardBurns,
  wizardOutcome,
  wizardRateBounds,
  wizardRateDisplay,
  wizardResult,
  wizardWeightChanged,
} from '@/lib/nutritionWizard';
import {
  baseTargets,
  editTargetField,
  expenditureSummary,
  macroTargetColumns,
  resumeAdaptiveMessage,
  signOutQuestion,
  targetDrift,
  targetsChanged,
} from '@/lib/settingsUx';
import { whoopCallbackStatus, whoopSyncMessage, whoopSyncedLabel } from '@/lib/whoopStatus';

const profile: NutritionProfile = {
  user_id: 'u1',
  sex: 'male',
  birth_year: 1992,
  height_cm: 178,
  body_fat_pct: null,
  activity: 'moderately_active',
  goal: 'maintain',
  rate_pct_per_week: 0,
  unit_system: 'imperial',
  adaptive_enabled: true,
  phase_started_on: '2026-09-01',
  expenditure_kcal: 2650,
  expenditure_confidence: 'learning',
  expenditure_updated_at: null,
};

describe('target rules shared by the web and native You', () => {
  it('falls back to the starting defaults, kept by hand, when nothing is saved', () => {
    expect(baseTargets(null)).toEqual({ calories: 2000, protein: 150, carbs: 200, fat: 65, source: 'manual' });
    expect(baseTargets({ calories: 2400, protein: 180, carbs: 250, fat: 70, source: 'adaptive' }).source).toBe('adaptive');
  });

  it('makes a hand edit a manual target and notices the change', () => {
    const base = baseTargets({ calories: 2400, protein: 180, carbs: 250, fat: 70, source: 'calculated' });
    const edited = editTargetField(base, 'calories', '2300');
    expect(edited).toMatchObject({ calories: 2300, source: 'manual' });
    expect(targetsChanged(edited, base)).toBe(true);
    expect(targetsChanged(base, base)).toBe(false);
    expect(editTargetField(base, 'fat', '').fat).toBe(0);
  });

  it('saves only the targets table’s columns, never a suggestion’s words', () => {
    // A coach suggestion staged whole made every save fail: the database has
    // no rationale or cautions columns (2026-10-28).
    const suggestion = { calories: 2450, protein: 150, carbs: 310, fat: 70, rationale: 'Why', cautions: '', confidence: 0.7, provider: 'gemini', reconciled: false, source: 'manual' };
    expect(macroTargetColumns(suggestion)).toEqual({ calories: 2450, protein: 150, carbs: 310, fat: 70, source: 'manual' });
    expect(macroTargetColumns({ calories: Number.NaN, source: 'other' })).toEqual({});
  });

  it('measures how far the calories are from what the macros add up to', () => {
    expect(targetDrift({ calories: 2400, protein: 180, carbs: 250, fat: 70 })).toEqual({ kcalFromMacros: 2350, driftPct: 2 });
    expect(targetDrift({ calories: 2000, protein: 180, carbs: 250, fat: 70 }).driftPct).toBe(18);
    expect(targetDrift({ calories: 0, protein: 10, carbs: 0, fat: 0 }).driftPct).toBe(0);
  });

  it('describes the daily burn only once it is being learned', () => {
    expect(expenditureSummary(profile)).toMatchObject({ kcal: 2650, source: 'Learning from your logs' });
    expect(expenditureSummary({ ...profile, expenditure_confidence: 'predicted' }).kcal).toBeNull();
    expect(expenditureSummary(null).source).toBe('Estimated from your profile');
    expect(expenditureSummary({ ...profile, expenditure_confidence: 'measured' }).source).toBe('Inferred from logs and weight trend');
  });

  it('words the resume result and the sign-out question', () => {
    expect(resumeAdaptiveMessage(false, 'updated')).toMatch(/Complete nutrition setup/);
    expect(resumeAdaptiveMessage(true, 'failed')).toMatch(/could not run right now/);
    expect(resumeAdaptiveMessage(true, 'unchanged')).toMatch(/Recalculation was requested/);
    expect(signOutQuestion(false)).toBe('Sign out?');
    expect(signOutQuestion(true, true)).toBe('Sign out and discard unsaved edits? Already saved profile details and weight will be kept.');
  });
});

describe('body weight words', () => {
  it('labels the weekly rate with a sign, or nothing without one', () => {
    expect(weeklyRateLabel(-0.2, 'lb')).toBe('−0.44 lb/wk');
    expect(weeklyRateLabel(0.1, 'kg')).toBe('+0.10 kg/wk');
    expect(weeklyRateLabel(null, 'lb')).toBeNull();
  });

  it('says when the last weigh-in was, or why there is none', () => {
    const now = new Date();
    expect(lastWeighInLabel({ kilograms: 80, measured_at: now.toISOString() }, 'kg')).toBe('Last 80.0 kg · today');
    expect(lastWeighInLabel({ kilograms: 80, measured_at: '2026-03-04T12:00:00Z' }, 'kg')).toBe('Last 80.0 kg · Mar 4');
    expect(lastWeighInLabel(null, 'lb')).toBe('First weigh-in');
    expect(lastWeighInLabel(null, 'lb', true)).toBe('History unavailable');
  });

  it('reads a typed weigh-in in the chosen unit', () => {
    expect(parseWeighIn('180', 'lb')).toEqual({ kilograms: lbsToKg(180) });
    expect(parseWeighIn('82.5', 'kg')).toEqual({ kilograms: 82.5 });
    expect(parseWeighIn('', 'kg')).toEqual({ error: 'Enter a weight first.' });
    expect(parseWeighIn('-3', 'kg')).toEqual({ error: 'Enter a weight first.' });
  });

  it('carries a typed weigh-in across a unit switch', () => {
    expect(convertWeighInDraft('171.4', 'lb', 'kg')).toBe('77.7');
    expect(convertWeighInDraft('77.7', 'kg', 'lb')).toBe('171.3');
    expect(convertWeighInDraft('', 'lb', 'kg')).toBe('');
    expect(convertWeighInDraft('abc', 'lb', 'kg')).toBe('abc');
  });
});

describe('target calculator draft', () => {
  const now = new Date('2026-10-27T12:00:00');

  it('starts from the profile and the latest weigh-in, at one decimal', () => {
    const draft = initialWizardDraft(profile, 78.4, now);
    expect(draft).toMatchObject({ unitSystem: 'imperial', age: '34', weight: '172.8', heightFeet: '5', heightInches: '10' });
    expect(initialWizardDraft(null, null, now)).toMatchObject({ unitSystem: 'imperial', weight: '169.8', goal: 'lean_bulk', rate: 0.25, burn: 'formula' });
    // A rate saved under the old, slower bulk range starts at today's floor.
    expect(initialWizardDraft({ ...profile, goal: 'bulk', rate_pct_per_week: 0.2 }, 59, now)).toMatchObject({ rate: 0.35, burn: 'learned' });
  });

  it('does not log a new weigh-in when the prefilled weight is saved untouched', () => {
    const draft = initialWizardDraft(profile, 78.4, now);
    const outcome = wizardOutcome(draft, profile, now);
    expect(wizardWeightChanged(78.4, outcome.weightKg)).toBe(false);
    expect(wizardWeightChanged(78.4, wizardOutcome(switchWizardUnits(draft, 'metric'), profile, now).weightKg)).toBe(false);
    expect(wizardWeightChanged(78.4, wizardOutcome({ ...draft, weight: '175' }, profile, now).weightKg)).toBe(true);
    expect(wizardWeightChanged(null, outcome.weightKg)).toBe(true);
  });

  it('carries weight and height across a unit switch', () => {
    const metric = switchWizardUnits(initialWizardDraft(profile, 78.4, now), 'metric');
    expect(metric).toMatchObject({ unitSystem: 'metric', weight: '78.4', heightCm: '178' });
    const back = switchWizardUnits(metric, 'imperial');
    expect(back).toMatchObject({ weight: '172.8', heightFeet: '5', heightInches: '10' });
  });

  it('keeps the rate inside the goal and resets it with a new goal', () => {
    const cut = selectWizardGoal(initialWizardDraft(profile, 78.4, now), 'cut');
    expect(cut.rate).toBe(-0.7);
    let fastest = cut;
    for (let i = 0; i < 20; i += 1) fastest = stepWizardRate(fastest, -1);
    expect(fastest.rate).toBeCloseTo(-1);
    expect(wizardRateBounds(fastest)).toEqual({ slower: false, faster: true });
    const bulk = selectWizardGoal(cut, 'bulk');
    expect(bulk.rate).toBe(0.5);
    // 0.5% a week of 172.8 lb is about 0.86 lb a week, 3.75 lb a month.
    const shown = wizardRateDisplay(bulk, wizardResult(bulk, profile));
    expect(shown).toMatchObject({ value: 0.5, unit: 'lb' });
    expect(shown.weeklyChange).toBeCloseTo(0.86, 1);
    expect(shown.monthlyChange).toBeCloseTo(shown.weeklyChange * 4.345, 5);
  });

  it('holds inputs to their limits and builds the profile to save', () => {
    const draft = { ...initialWizardDraft(profile, 78.4, now), age: '9', bodyFat: '80' };
    expect(wizardBodyFatPct(draft)).toBe(60);
    expect(wizardBodyFatPct({ ...draft, bodyFat: ' ' })).toBeNull();
    expect(wizardBodyReady(draft)).toBe(false);
    const outcome = wizardOutcome({ ...draft, age: '34' }, profile, now);
    expect(outcome.profile).toMatchObject({ birth_year: 1992, height_cm: 177.8, adaptive_enabled: true, phase_started_on: '2026-09-01' });
    expect(outcome.targets.calories).toBe(outcome.computed.calories);
  });
});

describe('learned or formula burn in the calculator', () => {
  const now = new Date('2026-10-27T12:00:00');
  // The owner's case: 130 lb, 5'9", 12% body fat, moderately active, bulking,
  // with a learned burn of about 2,060 kcal.
  const owner: NutritionProfile = { ...profile, sex: 'male', height_cm: 175.3, body_fat_pct: 12, goal: 'bulk', rate_pct_per_week: 0.5, expenditure_kcal: 2060 };
  const draft = { ...initialWizardDraft(owner, lbsToKg(130), now), weight: '130' };

  it('offers both burns and builds on the chosen one', () => {
    expect(wizardBurns(draft, owner)).toEqual({ learned: 2060, formula: 2791 });
    expect(learnedBurnLooksLow(wizardBurns(draft, owner))).toBe(true);
    expect(learnedBurnLooksLow({ learned: 2700, formula: 2791 })).toBe(false);
    expect(wizardResult(draft, owner).tdee).toBe(2060);
    const formula = { ...draft, burn: 'formula' as const };
    const result = wizardResult(formula, owner);
    expect(result.tdee).toBe(2791);
    // A 0.5%-a-week bulk adds about 325 kcal a day for them; the parts add up.
    expect(wizardBreakdown(result)).toEqual({ burn: 2791, change: 334 });
    expect(result.calories).toBe(3125);
  });

  it('keeps formula targets by hand so the weekly adaptive update leaves them', () => {
    expect(wizardOutcome(draft, owner, now).source).toBe('calculated');
    expect(wizardOutcome({ ...draft, burn: 'formula' }, owner, now).source).toBe('manual');
    expect(wizardBurns(draft, { ...owner, adaptive_enabled: false }).learned).toBeNull();
    expect(wizardOutcome({ ...draft, burn: 'formula' }, { ...owner, expenditure_confidence: 'predicted' }, now).source).toBe('calculated');
  });
});

describe('WHOOP status words', () => {
  it('says when WHOOP last synced', () => {
    const now = new Date('2026-10-27T12:00:00Z');
    expect(whoopSyncedLabel({ last_synced_at: null }, now)).toBe('never synced');
    expect(whoopSyncedLabel({ last_synced_at: '2026-10-27T11:55:00Z' }, now)).toBe('synced 5 minutes ago');
    expect(whoopSyncedLabel({ last_synced_at: '2026-10-27T12:01:00Z' }, now)).toBe('synced just now');
  });

  it('words a sync result and reads the consent screen’s return', () => {
    expect(whoopSyncMessage(null)).toBe('Sync unavailable');
    expect(whoopSyncMessage({ created: 0, updated: 0 })).toBe('Up to date');
    expect(whoopSyncMessage({ created: 2, updated: 1 })).toBe('2 new · 1 updated');
    expect(whoopCallbackStatus('app.hyper.mobile://settings?whoop=connected')).toBe('connected');
    expect(whoopCallbackStatus('app.hyper.mobile://settings?whoop=error')).toBe('error');
    expect(whoopCallbackStatus('not a url')).toBe('error');
  });
});

describe('short status lines', () => {
  it('counts hosted food analyses', () => {
    // Midnight UTC, shown in the device's time zone (the test runner's).
    const now = new Date('2026-10-27T18:00:00Z');
    const reset = new Date('2026-10-28T00:00:00Z');
    const hours = reset.getHours();
    const label = `${hours % 12 === 0 ? 12 : hours % 12}${reset.getMinutes() ? `:${String(reset.getMinutes()).padStart(2, '0')}` : ''} ${hours < 12 ? 'AM' : 'PM'}`;
    expect(foodTrialUsageLine({ date: '2026-10-27', maxAttempts: 24, attemptsUsed: 3, attempts: [] }, now)).toBe(`3 of 24 analyses used. The count starts over at ${label}.`);
    expect(foodTrialUsageLine({ maxAttempts: 24, attemptsUsed: 24 }, now)).toBe(`Daily limit reached: 24 of 24 used. It starts over at ${label}.`);
    expect(foodTrialUsageLine({ preview: true })).toBe('Sample data: no analyses counted.');
    expect(() => foodTrialUsageLine({ maxAttempts: 0, attemptsUsed: 0 })).toThrow();
  });

  it('words an Apple Health sync', () => {
    expect(healthSyncMessage({ imported: 1, latest: null })).toBe('Imported 1 Apple Health weight entry.');
    expect(healthSyncMessage({ imported: 3, latest: null })).toBe('Imported 3 Apple Health weight entries.');
    expect(healthSyncMessage({ imported: 0, latest: null })).toBe('Apple Health weight is up to date.');
  });
});

describe('last time’s movement notes', () => {
  it('takes each movement’s note from the newest earlier workout that has one', async () => {
    const { buildPreviousMovementNotes } = await import('@/lib/previousSetTargets');
    const workouts = [
      { id: 'w3', date: '2026-10-25', notes: JSON.stringify({ movementNotes: { row: 'Straps on the last set' } }) },
      { id: 'w2', date: '2026-10-21', notes: JSON.stringify({ movementNotes: { bench: 'Notch 4', row: 'Older row note' } }) },
      { id: 'w1', date: '2026-10-18', notes: 'a plain legacy note' },
      { id: 'w0', date: '2026-10-14', notes: null },
    ];
    expect(buildPreviousMovementNotes(workouts, ['bench', 'row', 'squat'])).toEqual({
      row: { note: 'Straps on the last set', date: '2026-10-25' },
      bench: { note: 'Notch 4', date: '2026-10-21' },
    });
    expect(buildPreviousMovementNotes([], ['bench'])).toEqual({});
  });
});
