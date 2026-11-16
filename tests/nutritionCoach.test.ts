import { describe, expect, it } from 'vitest';

import { buildCoachContext, coachRails, coachTrendKgPerWeek, normalizeCoachResult } from '@/lib/nutritionCoach';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import { buildWeightTrend } from '@/lib/weightTrend';

function profile(overrides: Partial<NutritionProfile> = {}): NutritionProfile {
  return {
    user_id: 'u1', sex: 'male', birth_year: 2000, height_cm: 180,
    body_fat_pct: null, activity: 'moderately_active', goal: 'cut',
    rate_pct_per_week: -0.5, unit_system: 'imperial', adaptive_enabled: true,
    phase_started_on: '2026-07-01', expenditure_kcal: 2850,
    expenditure_confidence: 'learning', expenditure_updated_at: '2026-08-01',
    ...overrides,
  } as NutritionProfile;
}

const sane = { calories: 2400, protein_g: 180, carbs_g: 240, fat_g: 74, rationale: 'r', cautions: '', confidence: 0.8 };

describe('buildCoachContext', () => {
  it('carries the measured expenditure - the whole point of the feature', () => {
    const ctx = buildCoachContext(profile(), 82, null);
    expect(ctx.measured_expenditure_kcal).toBe(2850);
    expect(ctx.expenditure_confidence).toBe('learning');
  });

  it('carries the measured weight trend when provided', () => {
    const ctx = buildCoachContext(profile(), 82, null, { trendKgPerWeek: -0.42 });
    expect(ctx.weight_trend_kg_per_week).toBe(-0.42);
  });

  it('withholds a stale expenditure when adaptive is off', () => {
    // a number the engine is no longer maintaining must not be presented as measured
    const ctx = buildCoachContext(profile({ adaptive_enabled: false }), 82, null);
    expect(ctx.measured_expenditure_kcal).toBeNull();
    expect(ctx.expenditure_confidence).toBeNull();
  });

  it('withholds ALL measured data when the user opts out of sharing', () => {
    // the toggle is a promise: off means the coach reasons only from basic
    // stats and the typed goals, never from the app's measurements
    const ctx = buildCoachContext(profile(), 82, null, {
      trendKgPerWeek: -0.42,
      shareMeasured: false,
    });
    expect(ctx.measured_expenditure_kcal).toBeNull();
    expect(ctx.expenditure_confidence).toBeNull();
    expect(ctx.weight_trend_kg_per_week).toBeNull();
    // basic stats still flow - the user typed nothing secret about their height
    expect(ctx.height_cm).toBe(180);
    expect(ctx.weight_kg).toBe(82);
  });
});

describe('coachTrendKgPerWeek', () => {
  const weighIns = (kilograms: number[], everyDays = 1) => kilograms.map((kg, index) => ({
    measured_at: new Date(2026, 9, 1 + index * everyDays, 7).toISOString(),
    kilograms: kg,
  }));

  it('shares a trend fitted on a couple of weeks of weigh-ins', () => {
    const trend = buildWeightTrend(weighIns([82, 81.9, 81.8, 81.7, 81.6, 81.5, 81.4, 81.3], 2), { windowDays: 21 });
    expect(coachTrendKgPerWeek(trend)).toBeCloseTo(-0.35, 5);
  });

  it('leaves out a "trend" from two weigh-ins a day apart, which the coach would refuse', () => {
    const trend = buildWeightTrend(weighIns([82, 81]), { windowDays: 21 });
    expect(trend.kgPerWeek).toBeCloseTo(-7, 5);
    expect(coachTrendKgPerWeek(trend)).toBeNull();
  });

  it('leaves out a trend steeper than the coach accepts, however many weigh-ins', () => {
    expect(coachTrendKgPerWeek({ kgPerWeek: -5.6, fittedDayCount: 10, spanDays: 20 })).toBeNull();
    expect(coachTrendKgPerWeek({ kgPerWeek: 5, fittedDayCount: 10, spanDays: 20 })).toBe(5);
  });

  it('leaves out a trend from too few weigh-ins or too short a stretch', () => {
    expect(coachTrendKgPerWeek({ kgPerWeek: -0.5, fittedDayCount: 3, spanDays: 20 })).toBeNull();
    expect(coachTrendKgPerWeek({ kgPerWeek: -0.5, fittedDayCount: 6, spanDays: 6 })).toBeNull();
    expect(coachTrendKgPerWeek({ kgPerWeek: null, fittedDayCount: 0, spanDays: 0 })).toBeNull();
  });
});

describe('normalizeCoachResult', () => {
  it('passes sane numbers through, macro math intact', () => {
    const out = normalizeCoachResult(sane, 'anthropic');
    expect(out).toMatchObject({ calories: 2346, protein: 180, carbs: 240, fat: 74 });
    // 180*4 + 240*4 + 74*9 = 2346; the stated 2400 drifted 2.3% so macros won
    expect(out.reconciled).toBe(true);
  });

  it('accepts calories that already agree with the macros', () => {
    const out = normalizeCoachResult({ ...sane, calories: 2346 });
    expect(out.calories).toBe(2346);
    expect(out.reconciled).toBe(false);
  });

  it('corrects calories that disagree wildly with the macros', () => {
    // a model that says "eat 1200" while its own macros sum to 2346 has made a
    // summing error, not a coaching decision
    const out = normalizeCoachResult({ ...sane, calories: 1200 });
    expect(out.calories).toBe(2346);
    expect(out.reconciled).toBe(true);
  });

  it('clamps an absurdly low recommendation to the floor', () => {
    const out = normalizeCoachResult({
      calories: 600, protein_g: 30, carbs_g: 10, fat_g: 10,
      rationale: 'crash diet', cautions: '', confidence: 0.9,
    });
    expect(out.protein).toBeGreaterThanOrEqual(50);
    expect(out.fat).toBeGreaterThanOrEqual(25);
    expect(out.calories).toBeGreaterThanOrEqual(1200);
  });

  it('clamps an absurdly high one to the ceiling', () => {
    const out = normalizeCoachResult({ ...sane, protein_g: 999, carbs_g: 2000, fat_g: 900 });
    expect(out.protein).toBeLessThanOrEqual(400);
    expect(out.carbs).toBeLessThanOrEqual(800);
    expect(out.fat).toBeLessThanOrEqual(250);
  });

  it('rejects a result with missing numbers instead of inventing them', () => {
    expect(() => normalizeCoachResult({ rationale: 'trust me' })).toThrow(/usable numbers/);
  });

  it('bounds confidence and truncates prose', () => {
    const out = normalizeCoachResult({ ...sane, confidence: 7, rationale: 'x'.repeat(5000) });
    expect(out.confidence).toBe(1);
    expect(out.rationale.length).toBeLessThanOrEqual(1200);
  });
});

describe('holding a suggestion to the calculator’s ranges', () => {
  // 59 kg, 178 cm, 24, moderately active: resting about 1,588 kcal, daily burn about 2,700.
  const context = {
    sex: 'male', age: 24, height_cm: 178, weight_kg: 59, activity: 'moderately_active', current_goal: 'bulk at 0.35% bodyweight/week',
    measured_expenditure_kcal: null, expenditure_confidence: null, weight_trend_kg_per_week: null, current_targets: null,
  };
  const rails = coachRails(context)!;
  const suggestion = (numbers: { calories: number; protein_g: number; carbs_g: number; fat_g: number }) =>
    normalizeCoachResult({ ...numbers, rationale: 'Because.', cautions: '', confidence: 0.8 }, 'gemini', rails);

  it('works the ranges out from the person, as the calculator would', () => {
    expect(rails.referenceKg).toBe(59);
    // 25% under the daily burn, never under the resting rate; 20% over it.
    expect(rails.calories.min).toBeGreaterThan(1900);
    expect(rails.calories.min).toBeLessThan(2100);
    expect(rails.calories.max).toBeGreaterThan(3150);
    expect(rails.calories.max).toBeLessThan(3350);
  });

  it('uses the learned burn when the request carries one', () => {
    const learned = coachRails({ ...context, measured_expenditure_kcal: 3000, expenditure_confidence: 'measured' })!;
    expect(learned.calories).toEqual({ min: 2250, max: 3600 });
    // A burn that is only the formula's guess is not treated as learned.
    expect(coachRails({ ...context, measured_expenditure_kcal: 3000, expenditure_confidence: 'predicted' })).toEqual(rails);
  });

  it('leaves a suggestion inside the ranges exactly as it came', () => {
    const out = suggestion({ calories: 2800, protein_g: 110, carbs_g: 420, fat_g: 76 });
    expect(out).toMatchObject({ calories: 2800, protein: 110, carbs: 420, fat: 76, held: [], cautions: '' });
  });

  it('brings protein inside 1.6 to 2.4 g per kg, and says so', () => {
    const high = suggestion({ calories: 2800, protein_g: 250, carbs_g: 270, fat_g: 80 });
    expect(high.protein).toBe(142);
    expect(high.held).toEqual(['protein']);
    expect(high.cautions).toBe('Protein was brought inside the ranges the calculator uses, so the reasoning may name other figures.');
    // Carbs take up what protein gave back, so the macros still add up.
    expect(high.calories).toBe(high.protein * 4 + high.carbs * 4 + high.fat * 9);
    expect(Math.abs(high.calories - 2800)).toBeLessThanOrEqual(4);

    const low = suggestion({ calories: 2800, protein_g: 60, carbs_g: 460, fat_g: 80 });
    expect(low.protein).toBe(94);
  });

  it('keeps calories between the deepest cut and the largest surplus the calculator allows', () => {
    const crash = suggestion({ calories: 1300, protein_g: 120, carbs_g: 100, fat_g: 47 });
    expect(crash.calories).toBeGreaterThanOrEqual(rails.calories.min - 4);
    expect(crash.held).toContain('calories');
    const dirty = suggestion({ calories: 4500, protein_g: 130, carbs_g: 700, fat_g: 131 });
    expect(dirty.calories).toBeLessThanOrEqual(rails.calories.max + 4);
    expect(dirty.cautions).toMatch(/^Calories .*were brought inside/);
  });

  it('keeps fat between 20 and 35% of calories, never under 0.6 g per kg', () => {
    const share = (out: { fat: number; calories: number }) => (out.fat * 9) / out.calories;
    const lean = suggestion({ calories: 2800, protein_g: 120, carbs_g: 540, fat_g: 30 });
    expect(lean.held).toEqual(['fat']);
    expect(share(lean)).toBeGreaterThan(0.195);
    expect(share(lean)).toBeLessThan(0.21);
    const fatty = suggestion({ calories: 2800, protein_g: 120, carbs_g: 190, fat_g: 173 });
    expect(fatty.held).toEqual(['fat']);
    expect(share(fatty)).toBeGreaterThan(0.34);
    expect(share(fatty)).toBeLessThan(0.355);
    // A light person on few calories: 0.6 g per kg wins over the percentage.
    const small = coachRails({ ...context, weight_kg: 100, height_cm: 200, activity: 'sedentary' })!;
    const out = normalizeCoachResult({ calories: small.calories.min, protein_g: 170, carbs_g: 300, fat_g: 30, rationale: '', cautions: '', confidence: 0.5 }, 'gemini', small);
    expect(out.fat).toBeGreaterThanOrEqual(60);
  });

  it('adds its note after the coach’s own caution', () => {
    const out = normalizeCoachResult({ calories: 2800, protein_g: 250, carbs_g: 270, fat_g: 80, rationale: '', cautions: 'Eat slowly.', confidence: 0.5 }, 'gemini', rails);
    expect(out.cautions).toBe('Eat slowly. Protein was brought inside the ranges the calculator uses, so the reasoning may name other figures.');
  });

  it('has no ranges without a weigh-in, and then only the hard rails apply', () => {
    expect(coachRails({ ...context, weight_kg: null })).toBeNull();
    expect(coachRails({ ...context, activity: 'unknown' })).toBeNull();
    expect(coachRails(null)).toBeNull();
    const out = normalizeCoachResult({ calories: 2800, protein_g: 250, carbs_g: 270, fat_g: 80, rationale: '', cautions: '', confidence: 0.5 }, 'gemini', null);
    expect(out.protein).toBe(250);
    expect(out.held).toEqual([]);
  });
});
