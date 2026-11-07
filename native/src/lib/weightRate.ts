// The weekly weight rate as a summary shows it: one decimal ("+0.3 lb/wk").
// The shared weeklyRateLabel keeps two. Body weight's chart line and You's
// card both read a range through weightRangeSummary, so they say the same rate
// over the same days (the card's range starts at the latest run of weigh-ins
// when that is shorter).
import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import {
  weightChangeLabel,
  weightChartWindow,
  weightHistoryTrend,
  weightRangeKgPerWeek,
  weightSinceLabel,
  type WeightChartWindow,
} from '@/lib/weightHistory';
import type { WeightSampleLike, WeightTrend, WeightTrendPoint } from '@/lib/weightTrend';

import { centredTrendLine } from './weightTrendLine';

/** "+0.3 lb/wk", "−0.5 kg/wk", or null without a rate. A rate that rounds to flat has no sign. */
export function summaryRateLabel(kgPerWeek: number | null, unit: WeightUnit): string | null {
  if (kgPerWeek === null || !Number.isFinite(kgPerWeek)) return null;
  const shown = Math.abs(kgToUnit(kgPerWeek, unit)).toFixed(1);
  const sign = Number(shown) === 0 ? '' : kgPerWeek > 0 ? '+' : '−';
  return `${sign}${shown} ${unit}/wk`;
}

/** Body weight's trend over every weigh-in, and the line it draws: centred on each day. */
export function bodyWeightLine(entries: WeightSampleLike[]): { trend: WeightTrend; line: WeightTrendPoint[] } {
  const trend = weightHistoryTrend(entries);
  return { trend, line: centredTrendLine(trend.points) };
}

export interface WeightRangeSummary {
  /** The range's calendar days on that line. */
  calendar: WeightChartWindow;
  /** "+4.1 lb since Aug 8", or null with fewer than two days. */
  change: string | null;
  /** "since Aug 8": where those days start, the shorter span when the weigh-ins do. */
  since: string | null;
  /** "+0.3 lb/wk", averaged over the same days; null under two weeks. */
  rate: string | null;
}

/** What a range says about the line: its days, the change across them and their weekly rate. */
export function weightRangeSummary(line: WeightTrendPoint[], days: number | null, todayKey: string, unit: WeightUnit): WeightRangeSummary {
  const calendar = weightChartWindow(line, days, todayKey);
  return {
    calendar,
    change: weightChangeLabel(calendar.series, unit),
    since: weightSinceLabel(calendar.series),
    rate: summaryRateLabel(weightRangeKgPerWeek(calendar.series), unit),
  };
}
