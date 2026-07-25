/**
 * Adaptive energy expenditure.
 *
 * A predicted TDEE — a BMR equation times a self-reported activity multiplier —
 * carries roughly +/-15-20% error for any given person. This module replaces the
 * guess with a measurement, by reconciling what was actually eaten against what
 * the body actually did:
 *
 *   expenditure = mean daily intake - (rate of weight change x energy density)
 *
 * Everything else here exists to stop that identity producing nonsense from
 * imperfect real-world data. In particular, CHRONIC UNDER-LOGGING is the
 * dominant failure mode: under-reported intake makes measured expenditure look
 * too low, which lowers the target, which increases hunger and under-logging.
 * The clamp in step 5 is what bounds that spiral.
 *
 * Pure — no I/O, no clock reads beyond an injectable `through`.
 */

import { KCAL_PER_KG_GAINED, KCAL_PER_KG_LOST } from './nutritionCalculator';
import { buildWeightTrend, localIsoDate, type WeightSampleLike } from './weightTrend';

export type ExpenditureConfidence = 'predicted' | 'learning' | 'measured';

export interface DailyIntake {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  calories: number;
}

export interface ExpenditureInput {
  /** BMR x activity multiplier — the cold-start estimate. */
  predictedTdee: number;
  /** Used to decide whether a day was really logged. */
  bmr: number;
  weightSamples: WeightSampleLike[];
  dailyIntake: DailyIntake[];
  /** Start of the current goal/rate phase; its first days are skipped. */
  phaseStartedOn?: string | null;
  /** Last stored value, for damping and for freezing when coverage lapses. */
  previousExpenditureKcal?: number | null;
  previousConfidence?: ExpenditureConfidence | null;
  through?: Date;
}

export interface ExpenditureEstimate {
  /** What the calculator should use. */
  expenditureKcal: number;
  confidence: ExpenditureConfidence;
  /** The raw energy-balance result, before clamping, blending and damping. */
  measuredKcal: number | null;
  /** How much of the final figure came from the measurement, 0-1. */
  blendWeight: number;
  meanIntakeKcal: number | null;
  kgPerWeek: number | null;
  loggedDayCount: number;
  weighInDayCount: number;
  windowStart: string;
  windowEnd: string;
  /** Plain-English reasons the estimate is not yet fully measured. */
  reasons: string[];
}

/** Long enough to average out a bad week, short enough to still be current. */
export const WINDOW_DAYS = 21;
const MIN_LOGGED_DAYS = 14;
const MIN_WEIGH_IN_DAYS = 10;

/**
 * The first days of a new phase are glycogen and water rather than tissue.
 * Reading them as a real rate of change would badly skew the balance.
 */
const PHASE_TRANSIENT_DAYS = 7;

/**
 * A day whose logged intake is below this multiple of BMR was almost certainly
 * not fully logged. Counting it as a real low day would fabricate a deficit.
 */
const MIN_LOGGED_FRACTION_OF_BMR = 0.5;

/** Bounds on how far a measurement is allowed to sit from the prediction. */
const CLAMP_LOW = 0.7;
const CLAMP_HIGH = 1.4;

/** Weight given to the measurement the moment it first qualifies. */
const BLEND_AT_GATE = 0.35;
/** Above this blend weight the estimate is called measured rather than learning. */
const MEASURED_BLEND_THRESHOLD = 0.9;

/** Cap on how far the stored figure may move in one update. */
const MAX_STEP_FRACTION = 0.05;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function shiftIsoDate(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return localIsoDate(new Date(year, month - 1, day + days));
}

function daysBetween(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  const start = new Date(sy, sm - 1, sd).getTime();
  const end = new Date(ey, em - 1, ed).getTime();
  return Math.round((end - start) / MS_PER_DAY);
}

export function estimateExpenditure(input: ExpenditureInput): ExpenditureEstimate {
  const through = input.through ?? new Date();
  const windowEnd = localIsoDate(through);

  // The window normally spans WINDOW_DAYS, but never reaches back into the
  // transient that follows a change of goal or rate.
  let windowStart = shiftIsoDate(windowEnd, -(WINDOW_DAYS - 1));
  const reasons: string[] = [];

  if (input.phaseStartedOn) {
    const earliestUsable = shiftIsoDate(input.phaseStartedOn, PHASE_TRANSIENT_DAYS);
    if (earliestUsable > windowStart) {
      windowStart = earliestUsable;
      if (windowStart > windowEnd) {
        reasons.push('Just changed your goal — the first week of weight change is water, not tissue.');
      }
    }
  }

  const inWindow = (date: string) => date >= windowStart && date <= windowEnd;

  const weightSamples = input.weightSamples.filter((sample) => {
    const ms = Date.parse(sample.measured_at);
    return Number.isFinite(ms) && inWindow(localIsoDate(new Date(ms)));
  });

  // Days below the threshold are treated as MISSING, never as a real low day.
  const intakeFloor = input.bmr * MIN_LOGGED_FRACTION_OF_BMR;
  const loggedDays = input.dailyIntake.filter(
    (day) => inWindow(day.date) && Number.isFinite(day.calories) && day.calories >= intakeFloor
  );

  const trend = buildWeightTrend(weightSamples, { windowDays: WINDOW_DAYS });
  const loggedDayCount = loggedDays.length;
  const weighInDayCount = trend.fittedDayCount;

  const base: Omit<ExpenditureEstimate, 'expenditureKcal' | 'confidence' | 'blendWeight'> = {
    measuredKcal: null,
    meanIntakeKcal: loggedDayCount > 0
      ? loggedDays.reduce((sum, day) => sum + day.calories, 0) / loggedDayCount
      : null,
    kgPerWeek: trend.kgPerWeek,
    loggedDayCount,
    weighInDayCount,
    windowStart,
    windowEnd,
    reasons,
  };

  if (loggedDayCount < MIN_LOGGED_DAYS) {
    reasons.push(
      `Needs ${MIN_LOGGED_DAYS} logged days in the last ${WINDOW_DAYS} — you have ${loggedDayCount}.`
    );
  }
  if (weighInDayCount < MIN_WEIGH_IN_DAYS) {
    reasons.push(
      `Needs ${MIN_WEIGH_IN_DAYS} weigh-ins in the last ${WINDOW_DAYS} days — you have ${weighInDayCount}.`
    );
  }

  const gateOpen =
    loggedDayCount >= MIN_LOGGED_DAYS
    && weighInDayCount >= MIN_WEIGH_IN_DAYS
    && trend.slopeKgPerDay != null
    && base.meanIntakeKcal != null;

  // Only a value that was actually LEARNED counts as prior knowledge. A stored
  // figure that was itself just the prediction must not anchor anything, or the
  // damping below would hold the first real measurement to within 5% of a guess.
  const learnedPrevious =
    input.previousConfidence === 'learning' || input.previousConfidence === 'measured'
      ? input.previousExpenditureKcal ?? null
      : null;

  if (!gateOpen) {
    // Freeze a value already learned rather than decaying it back toward the
    // prediction — a quiet fortnight is not evidence the metabolism changed.
    if (learnedPrevious != null && learnedPrevious > 0) {
      return {
        ...base,
        expenditureKcal: learnedPrevious,
        confidence: input.previousConfidence as ExpenditureConfidence,
        blendWeight: 1,
      };
    }
    return { ...base, expenditureKcal: input.predictedTdee, confidence: 'predicted', blendWeight: 0 };
  }

  const slopeKgPerDay = trend.slopeKgPerDay as number;
  const meanIntakeKcal = base.meanIntakeKcal as number;
  const density = slopeKgPerDay < 0 ? KCAL_PER_KG_LOST : KCAL_PER_KG_GAINED;
  const measuredKcal = meanIntakeKcal - slopeKgPerDay * density;

  const clamped = clamp(
    measuredKcal,
    input.predictedTdee * CLAMP_LOW,
    input.predictedTdee * CLAMP_HIGH
  );
  if (clamped !== measuredKcal) {
    reasons.push(
      measuredKcal < clamped
        ? 'Your logged intake implies an unusually low burn — check nothing is going unlogged.'
        : 'Your logged intake implies an unusually high burn — treating it with caution.'
    );
  }

  // Coverage of the window drives how much the measurement is trusted. Both
  // inputs must be present, so the weaker one governs.
  const usableSpan = Math.min(WINDOW_DAYS, daysBetween(windowStart, windowEnd) + 1);
  const loggedCoverage = (loggedDayCount - MIN_LOGGED_DAYS) / Math.max(1, usableSpan - MIN_LOGGED_DAYS);
  const weighInCoverage = (weighInDayCount - MIN_WEIGH_IN_DAYS) / Math.max(1, usableSpan - MIN_WEIGH_IN_DAYS);
  const coverage = clamp(Math.min(loggedCoverage, weighInCoverage), 0, 1);
  const blendWeight = BLEND_AT_GATE + (1 - BLEND_AT_GATE) * coverage;

  let expenditureKcal = (1 - blendWeight) * input.predictedTdee + blendWeight * clamped;

  // Damping, against the last LEARNED figure. Skipped on the very first
  // measurement — there is nothing to drift from, and starting 5% away from the
  // truth would take weeks to correct.
  if (learnedPrevious != null && learnedPrevious > 0) {
    const maxStep = learnedPrevious * MAX_STEP_FRACTION;
    expenditureKcal = clamp(
      expenditureKcal,
      learnedPrevious - maxStep,
      learnedPrevious + maxStep
    );
  }

  return {
    ...base,
    measuredKcal,
    expenditureKcal: Math.round(expenditureKcal),
    confidence: blendWeight >= MEASURED_BLEND_THRESHOLD ? 'measured' : 'learning',
    blendWeight,
  };
}

/** Whether enough time has passed to recompute. Targets update weekly. */
export function shouldRefreshExpenditure(
  lastUpdatedAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastUpdatedAt) return true;
  const last = Date.parse(lastUpdatedAt);
  if (!Number.isFinite(last)) return true;
  return now.getTime() - last >= 7 * MS_PER_DAY;
}
