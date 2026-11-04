import { describe, expect, it } from 'vitest';

import { buildCoachContext, coachTrendKgPerWeek, normalizeCoachResult } from '@/lib/nutritionCoach';
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
