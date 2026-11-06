// The words around body weight: the recent read's window, the weekly rate
// at two decimals, the latest weigh-in and the Log weight sheet's draft.
import { format } from 'date-fns';

import { normalizeDecimalText, parseDecimal } from '@/lib/decimalText';
import { lbsToKg } from '@/lib/nutritionCalculator';
import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';

/**
 * The weigh-ins You reads: Body weight's chart shows this many days, and it is
 * enough for a stable trend without pulling a year of rows.
 */
export const WEIGHT_TREND_WINDOW_DAYS = 90;

/** "+0.42 lb/wk", or null without a rate. A flat rate has no sign. */
export function weeklyRateLabel(kgPerWeek: number | null, unit: WeightUnit): string | null {
  if (kgPerWeek === null) return null;
  const shown = Math.abs(kgToUnit(kgPerWeek, unit)).toFixed(2);
  const sign = Number(shown) === 0 ? '' : kgPerWeek > 0 ? '+' : '−';
  return `${sign}${shown} ${unit}/wk`;
}

/**
 * "Last weighed today, 8:00 AM", the line under Log weight: when, since the
 * field's placeholder already shows the weight. "today" is by `todayKey`
 * (yyyy-MM-dd), the clock's by default.
 */
export function lastWeighInLabel(
  latest: { measured_at: string } | null,
  failed = false,
  todayKey = format(new Date(), 'yyyy-MM-dd'),
): string {
  if (latest) {
    const date = new Date(latest.measured_at);
    const day = format(date, 'yyyy-MM-dd') === todayKey ? 'today' : format(date, 'MMM d');
    return `Last weighed ${day}, ${format(date, 'h:mm a')}`;
  }
  return failed ? 'History unavailable' : 'First weigh-in';
}

/** A typed weigh-in in kilograms, or a message saying what to fix. */
export function parseWeighIn(draft: string, unit: WeightUnit): { kilograms: number } | { error: string } {
  const entered = parseDecimal(draft);
  if (!Number.isFinite(entered) || entered <= 0) return { error: 'Enter a weight first.' };
  return { kilograms: unit === 'lb' ? lbsToKg(entered) : entered };
}

/** A typed weigh-in carried across a unit switch, to one decimal. */
export function convertWeighInDraft(draft: string, from: WeightUnit, to: WeightUnit): string {
  const entered = Number(normalizeDecimalText(draft));
  if (from === to || !draft.trim() || !Number.isFinite(entered)) return draft;
  const kilograms = from === 'lb' ? lbsToKg(entered) : entered;
  return String(Math.round(kgToUnit(kilograms, to) * 10) / 10);
}
