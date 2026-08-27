/**
 * Goal-driven target recommendations.
 *
 * The user describes what they want in their own words; the coach recommends
 * daily calories and macros. What makes this better than a generic chatbot
 * answer is the CONTEXT: the request carries the person's measured expenditure
 * from the adaptive engine - their actual burn, learned from weeks of logged
 * intake against their weight trend - alongside age, size, activity and current
 * targets. The model is told to anchor on measurement over formulas.
 *
 * The model's numbers are never trusted blindly. `normalizeCoachResult` clamps
 * everything into physiologically sane bounds and reconciles calories with the
 * macros (a recommendation whose calories disagree with its own macro math is
 * corrected toward the macros, which carry the actual decisions). The user then
 * reviews and edits before anything is saved - the coach proposes, the person
 * disposes.
 */

import { patientPost } from '@/lib/patientFetch';
import { createRequestIdempotencyKey } from '@/lib/requestIdempotency';
import { getPhotoWorkerSettings, type PhotoWorkerSettings } from '@/lib/photoAnalysis';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import type { MacroTarget } from '@/types';

export type TargetNumbers = Pick<MacroTarget, 'calories' | 'protein' | 'carbs' | 'fat'>;

export interface CoachContext {
  sex: string;
  age: number;
  height_cm: number;
  weight_kg: number | null;
  activity: string;
  current_goal: string;
  /** The adaptive engine's learned daily burn - the most valuable field here. */
  measured_expenditure_kcal: number | null;
  expenditure_confidence: string | null;
  current_targets: { calories: number; protein: number; carbs: number; fat: number } | null;
}

export function buildCoachContext(
  profile: NutritionProfile,
  weightKg: number | null,
  currentTargets: TargetNumbers | null,
): CoachContext {
  return {
    sex: profile.sex,
    age: Math.max(13, new Date().getFullYear() - profile.birth_year),
    height_cm: profile.height_cm,
    weight_kg: weightKg,
    activity: profile.activity,
    current_goal: `${profile.goal} at ${profile.rate_pct_per_week}% bodyweight/week`,
    measured_expenditure_kcal: profile.adaptive_enabled ? profile.expenditure_kcal : null,
    expenditure_confidence: profile.adaptive_enabled ? profile.expenditure_confidence : null,
    current_targets: currentTargets
      ? {
        calories: currentTargets.calories,
        protein: currentTargets.protein,
        carbs: currentTargets.carbs,
        fat: currentTargets.fat,
      }
      : null,
  };
}

export interface CoachRecommendation {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  rationale: string;
  cautions: string;
  confidence: number;
  provider: string;
  /** True when the model's calories disagreed with its macros and were corrected. */
  reconciled: boolean;
}

/** Hard rails. The model is prompted to stay inside these; this enforces it. */
const BOUNDS = {
  calories: { min: 1200, max: 6000 },
  protein: { min: 50, max: 400 },
  carbs: { min: 0, max: 800 },
  fat: { min: 25, max: 250 },
} as const;

function clamp(value: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

export function normalizeCoachResult(raw: unknown, provider = 'unknown'): CoachRecommendation {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const number = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : Number.NaN);

  let protein = number(record.protein_g);
  let carbs = number(record.carbs_g);
  let fat = number(record.fat_g);
  let calories = number(record.calories);
  if ([protein, carbs, fat, calories].some(Number.isNaN)) {
    throw new Error('The coach did not return usable numbers. Try rephrasing your goals.');
  }

  protein = clamp(protein, BOUNDS.protein);
  carbs = clamp(carbs, BOUNDS.carbs);
  fat = clamp(fat, BOUNDS.fat);

  // Calories must be the macros' own arithmetic. When they drift apart, the
  // macros win: they carry the actual decisions (protein for muscle, fat
  // floor), while a stray calorie figure is just a summing mistake.
  const kcalFromMacros = protein * 4 + carbs * 4 + fat * 9;
  const drift = Math.abs(calories - kcalFromMacros) / kcalFromMacros;
  const reconciled = drift > 0.02;
  calories = clamp(reconciled ? kcalFromMacros : calories, BOUNDS.calories);

  return {
    calories,
    protein,
    carbs,
    fat,
    rationale: String(record.rationale ?? '').trim().slice(0, 1200),
    cautions: String(record.cautions ?? '').trim().slice(0, 600),
    confidence: Math.max(0, Math.min(1, number(record.confidence) || 0)),
    provider,
    reconciled,
  };
}

export async function requestCoachRecommendation(input: {
  goals: string;
  context: CoachContext;
  accessToken: string;
  settings?: PhotoWorkerSettings;
}): Promise<CoachRecommendation> {
  const goals = input.goals.trim();
  if (goals.length < 5) throw new Error('Describe your goals in a bit more detail.');
  if (goals.length > 2000) throw new Error('Keep your goals under 2,000 characters.');

  const settings = input.settings || getPhotoWorkerSettings();
  if (!settings.url) throw new Error('Set the analysis worker URL in Settings first.');

  const requestBody = JSON.stringify({
    provider: settings.provider,
    goals,
    context: input.context,
  });
  const idempotencyKey = await createRequestIdempotencyKey('coach', requestBody);
  const response = await patientPost({
    url: `${settings.url.replace(/\/+$/, '')}/coach`,
    body: requestBody,
    headers: {
      Authorization: `Bearer ${input.accessToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': idempotencyKey,
    },
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(String(payload?.error ?? `The coach returned ${response.status}.`));
  }
  return normalizeCoachResult(payload, String(payload?.provider ?? 'unknown'));
}
