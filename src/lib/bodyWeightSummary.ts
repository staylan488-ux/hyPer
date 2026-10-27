// The words around body weight that You shows: the latest weigh-in, the
// three-week rate and the Log weight sheet's draft. Shared by the web You
// page and the native app.
import { format, isToday } from 'date-fns';

import { WINDOW_DAYS as ADAPTIVE_WINDOW_DAYS } from '@/lib/adaptiveExpenditure';
import { lbsToKg } from '@/lib/nutritionCalculator';
import { formatWeight, kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import { buildWeightTrend, type WeightSampleLike } from '@/lib/weightTrend';

/** Enough history for a stable trend without pulling a year of rows. */
export const WEIGHT_TREND_WINDOW_DAYS = 60;

/**
 * The full series (charts and the smoothed caption) and the weekly rate,
 * fitted over the same three-week window the coach and the adaptive targets
 * use. With fewer than two weigh-ins in that window there is no rate.
 */
export function bodyWeightTrends(history: WeightSampleLike[]) {
  return {
    trend: buildWeightTrend(history),
    rate: buildWeightTrend(history, { windowDays: ADAPTIVE_WINDOW_DAYS }),
  };
}

/** "+0.42 lb/wk", or null without a rate. */
export function weeklyRateLabel(kgPerWeek: number | null, unit: WeightUnit): string | null {
  if (kgPerWeek === null) return null;
  return `${kgPerWeek > 0 ? '+' : '−'}${Math.abs(kgToUnit(kgPerWeek, unit)).toFixed(2)} ${unit}/wk`;
}

/** "Last 182.4 lb · today", the line under Log weight. */
export function lastWeighInLabel(
  latest: { kilograms: number; measured_at: string } | null,
  unit: WeightUnit,
  failed = false,
): string {
  if (latest) {
    const date = new Date(latest.measured_at);
    return `Last ${formatWeight(Number(latest.kilograms), unit)} ${unit} · ${isToday(date) ? 'today' : format(date, 'MMM d')}`;
  }
  return failed ? 'History unavailable' : 'First weigh-in';
}

/** A typed weigh-in in kilograms, or a message saying what to fix. */
export function parseWeighIn(draft: string, unit: WeightUnit): { kilograms: number } | { error: string } {
  const entered = parseFloat(draft);
  if (!Number.isFinite(entered) || entered <= 0) return { error: 'Enter a weight first.' };
  return { kilograms: unit === 'lb' ? lbsToKg(entered) : entered };
}

/** A typed weigh-in carried across a unit switch, to one decimal. */
export function convertWeighInDraft(draft: string, from: WeightUnit, to: WeightUnit): string {
  const entered = Number(draft);
  if (from === to || !draft.trim() || !Number.isFinite(entered)) return draft;
  const kilograms = from === 'lb' ? lbsToKg(entered) : entered;
  return String(Math.round(kgToUnit(kilograms, to) * 10) / 10);
}
