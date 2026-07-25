// Read/write for the persisted nutrition profile — the inputs behind the macro
// targets. Current bodyweight deliberately lives in body_weight_measurements
// rather than here, so there is one source of truth for it.

import { supabase } from './supabase';
import type {
  ActivityLevel,
  BiologicalSex,
  MacroTargetInput,
  NutritionGoal,
  UnitSystem,
} from './nutritionCalculator';

export type ExpenditureConfidence = 'predicted' | 'learning' | 'measured';

export interface NutritionProfile {
  user_id: string;
  sex: BiologicalSex;
  birth_year: number;
  height_cm: number;
  body_fat_pct: number | null;
  activity: ActivityLevel;
  goal: NutritionGoal;
  /** Signed % of bodyweight per week. Negative loses, positive gains. */
  rate_pct_per_week: number;
  unit_system: UnitSystem;
  adaptive_enabled: boolean;
  /** Start of the current goal/rate phase; the estimator skips its first days. */
  phase_started_on: string;
  expenditure_kcal: number | null;
  expenditure_confidence: ExpenditureConfidence | null;
  expenditure_updated_at: string | null;
  created_at?: string;
  updated_at?: string;
}

export type NutritionProfileInput = Omit<
  NutritionProfile,
  'user_id' | 'created_at' | 'updated_at'
>;

/** Numeric columns come back from PostgREST as strings; coerce them once here. */
function normalizeProfile(row: Record<string, unknown>): NutritionProfile {
  const num = (value: unknown): number => Number(value);
  const nullableNum = (value: unknown): number | null =>
    value == null ? null : Number(value);

  return {
    user_id: String(row.user_id),
    sex: row.sex as BiologicalSex,
    birth_year: num(row.birth_year),
    height_cm: num(row.height_cm),
    body_fat_pct: nullableNum(row.body_fat_pct),
    activity: row.activity as ActivityLevel,
    goal: row.goal as NutritionGoal,
    rate_pct_per_week: num(row.rate_pct_per_week),
    unit_system: row.unit_system as UnitSystem,
    adaptive_enabled: Boolean(row.adaptive_enabled),
    phase_started_on: String(row.phase_started_on),
    expenditure_kcal: nullableNum(row.expenditure_kcal),
    expenditure_confidence: (row.expenditure_confidence as ExpenditureConfidence) ?? null,
    expenditure_updated_at: (row.expenditure_updated_at as string) ?? null,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  };
}

export async function getNutritionProfile(userId: string): Promise<NutritionProfile | null> {
  const { data, error } = await supabase
    .from('nutrition_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? normalizeProfile(data) : null;
}

export async function saveNutritionProfile(
  userId: string,
  input: NutritionProfileInput
): Promise<NutritionProfile> {
  const { data, error } = await supabase
    .from('nutrition_profiles')
    .upsert({ user_id: userId, ...input, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return normalizeProfile(data);
}

/** The writable subset of a stored profile. */
export function toNutritionProfileInput(profile: NutritionProfile): NutritionProfileInput {
  return {
    sex: profile.sex,
    birth_year: profile.birth_year,
    height_cm: profile.height_cm,
    body_fat_pct: profile.body_fat_pct,
    activity: profile.activity,
    goal: profile.goal,
    rate_pct_per_week: profile.rate_pct_per_week,
    unit_system: profile.unit_system,
    adaptive_enabled: profile.adaptive_enabled,
    phase_started_on: profile.phase_started_on,
    expenditure_kcal: profile.expenditure_kcal,
    expenditure_confidence: profile.expenditure_confidence,
    expenditure_updated_at: profile.expenditure_updated_at,
  };
}

/**
 * Turn a stored profile plus a current bodyweight into calculator input.
 * Pass expenditureKcal explicitly — callers need the PREDICTED figure when
 * seeding the estimator and the LEARNED one when producing targets.
 */
export function macroInputFromProfile(
  profile: NutritionProfile,
  weightKg: number,
  expenditureKcal: number | null,
  now: Date = new Date(),
): MacroTargetInput {
  return {
    sex: profile.sex,
    age: ageFromBirthYear(profile.birth_year, now),
    heightCm: profile.height_cm,
    weightKg,
    bodyFatPct: profile.body_fat_pct,
    activity: profile.activity,
    goal: profile.goal,
    ratePctPerWeek: profile.rate_pct_per_week,
    expenditureKcal,
  };
}

/** Age in whole years, derived so it never goes stale. */
export function ageFromBirthYear(birthYear: number, now: Date = new Date()): number {
  return now.getFullYear() - birthYear;
}

export function birthYearFromAge(age: number, now: Date = new Date()): number {
  return now.getFullYear() - Math.round(age);
}

/**
 * A change of goal or rate starts a new phase. The first days of one are
 * glycogen and water rather than tissue, so the expenditure estimator needs to
 * know when it began.
 */
export function isNewPhase(
  previous: Pick<NutritionProfile, 'goal' | 'rate_pct_per_week'> | null,
  next: Pick<NutritionProfileInput, 'goal' | 'rate_pct_per_week'>
): boolean {
  if (!previous) return true;
  return previous.goal !== next.goal || previous.rate_pct_per_week !== next.rate_pct_per_week;
}

export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
