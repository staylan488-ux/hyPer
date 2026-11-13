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
 * corrected toward the macros, which carry the actual decisions). With the
 * person's size known it also holds the suggestion to the ranges the
 * calculator works inside (`coachRails`), and says so when it did. The user
 * then reviews and edits before anything is saved - the coach proposes, the
 * person disposes.
 */

import {
  ABSOLUTE_CALORIE_FLOOR,
  ACTIVITY_MULTIPLIERS,
  MAX_DEFICIT_FRACTION,
  MAX_FAT_CALORIE_FRACTION,
  MAX_PROTEIN_CALORIE_FRACTION,
  MAX_SURPLUS_FRACTION,
  MIN_FAT_CALORIE_FRACTION,
  MIN_FAT_G_PER_KG_REFERENCE,
  calculateMacroTargets,
  referenceWeightKg,
  type ActivityLevel,
} from '@/lib/nutritionCalculator';
import { getFoodAnalysisMode, requestHostedTargetSuggestion } from '@/lib/foodTrial';
import { patientPost } from '@/lib/patientFetch';
import { createRequestIdempotencyKey } from '@/lib/requestIdempotency';
import { getPhotoWorkerSettings, type PhotoWorkerSettings } from '@/lib/photoAnalysis';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import { MIN_AGE } from '@/lib/nutritionWizard';
import type { WeightTrend } from '@/lib/weightTrend';
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
  /** Actual recent rate of change from the user's weigh-ins; negative = losing. */
  weight_trend_kg_per_week: number | null;
  current_targets: { calories: number; protein: number; carbs: number; fat: number } | null;
}

export function buildCoachContext(
  profile: NutritionProfile,
  weightKg: number | null,
  currentTargets: TargetNumbers | null,
  options: {
    /** Measured rate of weight change over the recent window, kg/week. */
    trendKgPerWeek?: number | null;
    /**
     * Whether the user chose to share the app's measurements (learned burn and
     * weight trend). Off withholds them entirely - the coach then reasons only
     * from what the user typed plus their basic stats, which is exactly what
     * they asked for by unticking the box.
     */
    shareMeasured?: boolean;
  } = {},
): CoachContext {
  const share = options.shareMeasured ?? true;
  return {
    sex: profile.sex,
    age: Math.max(MIN_AGE, new Date().getFullYear() - profile.birth_year),
    height_cm: profile.height_cm,
    weight_kg: weightKg,
    activity: profile.activity,
    current_goal: `${profile.goal} at ${profile.rate_pct_per_week}% bodyweight/week`,
    measured_expenditure_kcal: share && profile.adaptive_enabled ? profile.expenditure_kcal : null,
    expenditure_confidence: share && profile.adaptive_enabled ? profile.expenditure_confidence : null,
    weight_trend_kg_per_week: share ? options.trendKgPerWeek ?? null : null,
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

/** The hosted coach refuses a weight_trend_kg_per_week outside this (coach.ts). */
export const COACH_TREND_LIMIT_KG_PER_WEEK = 5;
const COACH_TREND_MIN_WEIGH_INS = 4;
const COACH_TREND_MIN_SPAN_DAYS = 7;

/**
 * The weight trend worth sharing with the coach, or null. Two weigh-ins a day
 * apart make a "trend" of several kilos a week: it says nothing, and the hosted
 * coach refused the whole request over it with a misleading "describe your
 * goal" error. Without a trend the coach reasons from the basic stats.
 */
export function coachTrendKgPerWeek(
  trend: Pick<WeightTrend, 'kgPerWeek' | 'fittedDayCount' | 'spanDays'>,
): number | null {
  const { kgPerWeek } = trend;
  if (kgPerWeek == null || !Number.isFinite(kgPerWeek)) return null;
  if (trend.fittedDayCount < COACH_TREND_MIN_WEIGH_INS || trend.spanDays < COACH_TREND_MIN_SPAN_DAYS) return null;
  return Math.abs(kgPerWeek) <= COACH_TREND_LIMIT_KG_PER_WEEK ? kgPerWeek : null;
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
  /** The figures brought inside the person's ranges: 'calories', 'protein', 'fat'. Empty when none moved. */
  held?: string[];
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

/**
 * Protein per kg of reference weight a suggestion may ask for. The benefit
 * for muscle levels off near 1.6 g per kg, with real uncertainty up to 2.2
 * (Morton et al. 2018); 2.4 is the most the calculator itself sets (a cut,
 * per kg of lean mass). The hard rails alone let a suggestion run from 50 g
 * to 400 g whatever the person's size.
 */
const PROTEIN_RAIL_G_PER_KG = { min: 1.6, max: 2.4 } as const;

/** The ranges one person's suggestion is held to. */
export interface CoachRails {
  /** From the calculator's deepest cut to its largest surplus, never under its calorie floor. */
  calories: { min: number; max: number };
  /** The weight protein and fat scale from (the calculator's reference weight). */
  referenceKg: number;
}

/**
 * The calculator's ranges for the person the request describes: calories from
 * 25% under their daily burn (never under their resting rate) to 20% over it.
 * The burn is the learned one when the request carries it, else the formula's.
 * Null when the request lacks what the calculator needs (no weigh-in yet).
 */
export function coachRails(context: CoachContext | null | undefined): CoachRails | null {
  if (!context) return null;
  const sex = context.sex === 'male' || context.sex === 'female' ? context.sex : null;
  const activity = Object.prototype.hasOwnProperty.call(ACTIVITY_MULTIPLIERS, context.activity) ? (context.activity as ActivityLevel) : null;
  const weightKg = context.weight_kg;
  const usable = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
  if (!sex || !activity || !usable(weightKg) || !usable(context.height_cm) || !usable(context.age)) return null;
  const learned = context.expenditure_confidence === 'learning' || context.expenditure_confidence === 'measured'
    ? context.measured_expenditure_kcal
    : null;
  const base = calculateMacroTargets({ sex, age: context.age, heightCm: context.height_cm, weightKg, activity, goal: 'maintain', expenditureKcal: learned });
  const min = Math.round(Math.max(base.bmr, ABSOLUTE_CALORIE_FLOOR[sex], base.tdee * (1 - MAX_DEFICIT_FRACTION)));
  const max = Math.max(min, Math.round(base.tdee * (1 + MAX_SURPLUS_FRACTION)));
  return { calories: { min, max }, referenceKg: referenceWeightKg(weightKg, context.height_cm) };
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

/**
 * The numbers held to the rails, and which of them moved. Calories first,
 * then protein and fat inside them; carbs take what is left, so the macros
 * still add up to the calories.
 */
function holdToRails(numbers: TargetNumbers, rails: CoachRails): { numbers: TargetNumbers; held: string[] } {
  const held: string[] = [];
  const calories = clamp(numbers.calories, rails.calories);
  if (calories !== numbers.calories) held.push('calories');

  const proteinMin = Math.round(rails.referenceKg * PROTEIN_RAIL_G_PER_KG.min);
  const proteinMax = Math.max(proteinMin, Math.round(Math.min(rails.referenceKg * PROTEIN_RAIL_G_PER_KG.max, (calories * MAX_PROTEIN_CALORIE_FRACTION) / 4)));
  const protein = clamp(numbers.protein, { min: proteinMin, max: proteinMax });
  if (protein !== numbers.protein) held.push('protein');

  // The fat floor is a health minimum and wins over the percentage ceiling, as in the calculator.
  const fatMin = Math.round(Math.max(rails.referenceKg * MIN_FAT_G_PER_KG_REFERENCE, (calories * MIN_FAT_CALORIE_FRACTION) / 9));
  const fatMax = Math.max(fatMin, Math.round((calories * MAX_FAT_CALORIE_FRACTION) / 9));
  const fat = clamp(numbers.fat, { min: fatMin, max: fatMax });
  if (fat !== numbers.fat) held.push('fat');

  if (held.length === 0) return { numbers, held };
  const carbs = Math.max(0, Math.round((calories - protein * 4 - fat * 9) / 4));
  return { numbers: { calories: protein * 4 + carbs * 4 + fat * 9, protein, carbs, fat }, held };
}

export function normalizeCoachResult(raw: unknown, provider = 'unknown', rails: CoachRails | null = null): CoachRecommendation {
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

  // The person's own ranges, when their size is known. The model's reasoning
  // was written for its own figures, so a moved number is said plainly.
  let cautions = String(record.cautions ?? '').trim().slice(0, 600);
  let held: string[] = [];
  if (rails) {
    const kept = holdToRails({ calories, protein, carbs, fat }, rails);
    held = kept.held;
    ({ calories, protein, carbs, fat } = kept.numbers);
    if (held.length > 0) {
      const names = listWords(held);
      const note = `${names.charAt(0).toUpperCase()}${names.slice(1)} ${held.length === 1 && held[0] !== 'calories' ? 'was' : 'were'} brought inside the ranges the calculator uses, so the reasoning may name other figures.`;
      cautions = cautions ? `${cautions} ${note}` : note;
    }
  }

  return {
    calories,
    protein,
    carbs,
    fat,
    rationale: String(record.rationale ?? '').trim().slice(0, 1200),
    cautions,
    confidence: Math.max(0, Math.min(1, number(record.confidence) || 0)),
    provider,
    reconciled,
    held,
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
    // Always the Claude path: the worker runs the coach on Opus 5 at maximum
    // effort, and falls back to the other provider on its own if Claude fails.
    // The photo-provider preference is about photo analysis, not this.
    provider: 'anthropic',
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
  }).catch((error: unknown) => {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('The coach kept running past every retry. The worker may be down - check Settings.');
    }
    throw error;
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new Error(String(payload?.error ?? `The coach returned ${response.status}.`));
  }
  return normalizeCoachResult(payload, String(payload?.provider ?? 'unknown'), coachRails(input.context));
}

/**
 * Where suggestions come from follows the Food analysis choice: Gemini (hosted)
 * or the Mac worker. Each needs something different to be ready.
 */
export function coachSource(): 'gemini' | 'worker' {
  return getFoodAnalysisMode();
}

/** Asks whichever coach the Food analysis choice names. */
export async function requestTargetSuggestion(input: {
  goals: string;
  context: CoachContext;
  accessToken: string;
}): Promise<CoachRecommendation> {
  if (coachSource() === 'worker') return requestCoachRecommendation(input);
  const goals = input.goals.trim();
  if (goals.length < 5) throw new Error('Describe your goals in a bit more detail.');
  if (goals.length > 2000) throw new Error('Keep your goals under 2,000 characters.');
  const raw = await requestHostedTargetSuggestion(goals, input.context, input.accessToken);
  return normalizeCoachResult(raw, 'gemini', coachRails(input.context));
}
