/**
 * The fallback for a gaining goal while the daily burn is not learned yet.
 *
 * The adaptive loop reacts to the scale only once it has learned a burn, and
 * that takes food logged on enough days. Until then a person can weigh in
 * every morning, sit flat for weeks on a bulk, and hear nothing. This reads
 * the weigh-ins alone and makes one offer: "Weight flat for 3 weeks. Your goal
 * is about 0.5 lb a week.", with a small raise the person can take or leave.
 *
 * It is an offer, never a change: nothing moves until the person taps. It is
 * made only for a goal of gaining (lowering a target from the scale alone is
 * how under-eating spirals start), never over a target typed by hand, and
 * only when the weight has been flat on the target as it stands, so taking
 * one raise does not bring the next one a week later.
 *
 * The figures are judgment, not a study (audit of 2026-11-13). The size is
 * the surplus the trend says is missing, held to 100 to 150 kcal, the step
 * coaches commonly use; Iraki et al. 2019 put a gaining surplus at 10 to 20%
 * over maintenance, and on a flat weight a step this size is under the low
 * end of that.
 *
 * Pure: callers pass the weigh-ins and the day in.
 */
import { KCAL_PER_KG_GAINED, resolveRatePctPerWeek } from './nutritionCalculator';
import type { NutritionProfile } from './nutritionProfile';
import { carbShare, rebalanceMacros, type TargetDraft, type TargetNumbers } from './settingsUx';
import { buildWeightTrend, localIsoDate, type WeightSampleLike } from './weightTrend';
import { kgToUnit, type WeightUnit } from './weightDisplayCore';
import type { MacroTargetSource } from '@/types';

/** The weeks of weigh-ins read, and the weeks the target must have stood. */
export const NUDGE_WEEKS = 3;
const NUDGE_DAYS = NUDGE_WEEKS * 7;
/** Weigh-in days needed inside those weeks, reaching across at least two of them. */
const MIN_WEIGH_IN_DAYS = 6;
const MIN_SPAN_DAYS = 14;
/** The latest weigh-in must be this recent for the trend to be about now. */
const MAX_DAYS_SINCE_WEIGH_IN = 7;
/** The first days of a new goal are water, not tissue (the same week the burn estimate skips). */
const PHASE_TRANSIENT_DAYS = 7;
/** Under about 0.1 lb a week, a trend reads as flat. */
const FLAT_KG_PER_WEEK = 0.05;
/** A goal slower than this is too close to flat for the scale to tell apart in three weeks. */
const MIN_GOAL_KG_PER_WEEK = 0.1;
const MIN_RAISE_KCAL = 100;
const MAX_RAISE_KCAL = 150;
const RAISE_STEP_KCAL = 25;

export interface WeightNudge {
  /** The smoothed trend over the weeks read, signed kg a week. */
  kgPerWeek: number;
  /** The goal's pace at the latest weight, kg a week (positive). */
  goalKgPerWeek: number;
  /** The raise on offer, kcal a day. */
  raiseKcal: number;
}

export interface WeightNudgeInput {
  profile: Pick<NutritionProfile, 'adaptive_enabled' | 'goal' | 'rate_pct_per_week' | 'phase_started_on' | 'expenditure_confidence'> | null | undefined;
  target: { source?: MacroTargetSource; updated_at?: string } | null | undefined;
  weightSamples: readonly WeightSampleLike[];
  now: Date;
}

function daysAgoIso(now: Date, days: number): string {
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
}

/** The offer to make today, or null. */
export function weightNudge({ profile, target, weightSamples, now }: WeightNudgeInput): WeightNudge | null {
  if (!profile || !profile.adaptive_enabled || !target) return null;
  if (profile.goal !== 'bulk' && profile.goal !== 'lean_bulk') return null;
  // Once a burn is learned the weekly update reacts to the scale itself.
  if (profile.expenditure_confidence === 'learning' || profile.expenditure_confidence === 'measured') return null;
  // A target typed by hand is the person's.
  if (target.source === 'manual') return null;

  const windowStart = daysAgoIso(now, NUDGE_DAYS - 1);
  const today = localIsoDate(now);
  // Flat on this target, not on the one before it.
  const targetSince = target.updated_at ? Date.parse(target.updated_at) : NaN;
  if (!Number.isFinite(targetSince) || localIsoDate(new Date(targetSince)) > windowStart) return null;
  // And none of it the first week of a new goal.
  const [year, month, day] = String(profile.phase_started_on ?? '').split('-').map(Number);
  if (Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)) {
    if (localIsoDate(new Date(year, month - 1, day + PHASE_TRANSIENT_DAYS)) > windowStart) return null;
  }

  const inWindow = weightSamples.filter((sample) => {
    const at = Date.parse(sample.measured_at);
    if (!Number.isFinite(at)) return false;
    const date = localIsoDate(new Date(at));
    return date >= windowStart && date <= today;
  });
  const trend = buildWeightTrend([...inWindow], { windowDays: NUDGE_DAYS });
  if (trend.kgPerWeek === null || trend.latestEwmaKg === null) return null;
  if (trend.fittedDayCount < MIN_WEIGH_IN_DAYS || trend.spanDays < MIN_SPAN_DAYS) return null;
  const latest = trend.points[trend.points.length - 1]?.date;
  if (!latest || latest < daysAgoIso(now, MAX_DAYS_SINCE_WEIGH_IN)) return null;

  const rate = resolveRatePctPerWeek(profile.goal, profile.rate_pct_per_week);
  const goalKgPerWeek = (trend.latestEwmaKg * rate) / 100;
  if (!(goalKgPerWeek >= MIN_GOAL_KG_PER_WEEK) || trend.kgPerWeek >= FLAT_KG_PER_WEEK) return null;

  // The surplus the trend says is missing, in the steps a person would choose.
  const missing = ((goalKgPerWeek - trend.kgPerWeek) * KCAL_PER_KG_GAINED) / 7;
  const stepped = Math.round(missing / RAISE_STEP_KCAL) * RAISE_STEP_KCAL;
  const raiseKcal = Math.min(MAX_RAISE_KCAL, Math.max(MIN_RAISE_KCAL, stepped));
  return { kgPerWeek: trend.kgPerWeek, goalKgPerWeek, raiseKcal };
}

/** A pace as Targets writes it: one decimal in pounds, two in kilograms. */
function pace(kilograms: number, unit: WeightUnit): string {
  return `${Math.abs(kgToUnit(kilograms, unit)).toFixed(unit === 'lb' ? 1 : 2)} ${unit}`;
}

/**
 * The offer as one title, one quiet line and a button: "Weight flat for 3
 * weeks", "Your goal is about 0.5 lb a week.", "Add 150 kcal". A weight that
 * fell says so plainly; nothing here is a warning.
 */
export function describeWeightNudge(nudge: WeightNudge, unit: WeightUnit): { title: string; line: string; action: string } {
  const falling = nudge.kgPerWeek <= -FLAT_KG_PER_WEEK;
  return {
    title: falling ? `Weight down ${pace(nudge.kgPerWeek, unit)} a week for ${NUDGE_WEEKS} weeks` : `Weight flat for ${NUDGE_WEEKS} weeks`,
    line: `Your goal is about ${pace(nudge.goalKgPerWeek, unit)} a week.`,
    action: `Add ${nudge.raiseKcal} kcal`,
  };
}

/**
 * The target with the raise taken: calories up, carbs and fat filling them in
 * their own split, protein where it was. It stays the kind of target it was,
 * so the weekly update can still move it once a burn is learned.
 */
export function raisedTarget(target: TargetNumbers & { source?: MacroTargetSource }, raiseKcal: number): TargetDraft {
  const source: MacroTargetSource = target.source === 'adaptive' ? 'adaptive' : 'calculated';
  const draft: TargetDraft = { calories: target.calories + raiseKcal, protein: target.protein, carbs: target.carbs, fat: target.fat, source };
  return rebalanceMacros(draft, carbShare(target), {});
}
