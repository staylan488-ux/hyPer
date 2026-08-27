import { describe, expect, it } from 'vitest';

import { buildCoachContext, normalizeCoachResult } from '@/lib/nutritionCoach';
import type { NutritionProfile } from '@/lib/nutritionProfile';

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

  it('withholds a stale expenditure when adaptive is off', () => {
    // a number the engine is no longer maintaining must not be presented as measured
    const ctx = buildCoachContext(profile({ adaptive_enabled: false }), 82, null);
    expect(ctx.measured_expenditure_kcal).toBeNull();
    expect(ctx.expenditure_confidence).toBeNull();
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
