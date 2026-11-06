// Every weigh-in, as Body weight shows the whole history: the chart's time
// ranges and their date axis, the change across a range, the full log by
// month, and the recent read joined to the full one. Pure: no clock reads.
import { addDays, addMonths, differenceInCalendarDays, differenceInCalendarMonths, format, startOfMonth, startOfWeek } from 'date-fns';

import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import { buildWeightTrend, dailyMedianWeights, type WeightSampleLike, type WeightTrend, type WeightTrendPoint } from '@/lib/weightTrend';

export type WeightRangeKey = '1m' | '3m' | '6m' | '1y' | 'all';

export interface WeightRange {
  key: WeightRangeKey;
  /** The segment's label. */
  label: string;
  /** The same for VoiceOver, and for "No weigh-ins in the last month". */
  spoken: string;
  /** Calendar days ending today; null for everything since the first weigh-in. */
  days: number | null;
}

export const WEIGHT_RANGES: readonly WeightRange[] = [
  { key: '1m', label: '1M', spoken: 'month', days: 30 },
  { key: '3m', label: '3M', spoken: '3 months', days: 90 },
  { key: '6m', label: '6M', spoken: '6 months', days: 182 },
  { key: '1y', label: '1Y', spoken: 'year', days: 365 },
  { key: 'all', label: 'All', spoken: 'all time', days: null },
];

/** Three months, the window Body weight always showed. */
export const DEFAULT_WEIGHT_RANGE: WeightRangeKey = '3m';

export function weightRange(key: WeightRangeKey): WeightRange {
  return WEIGHT_RANGES.find((range) => range.key === key) ?? WEIGHT_RANGES[1];
}

/**
 * Four weeks without a weigh-in: by then the smoothed value is mostly a weight
 * from before the break (about 95% of its weight comes from the last four
 * weeks), so the trend starts again at the next one.
 */
export const WEIGHT_TREND_RESTART_DAYS = 28;

/**
 * Body weight's trend over every weigh-in. Someone coming back after months
 * away starts a new trend, rather than having every new reading judged a
 * mis-read against the old weight.
 */
export function weightHistoryTrend(entries: WeightSampleLike[]): WeightTrend {
  return buildWeightTrend(entries, { restartAfterGapDays: WEIGHT_TREND_RESTART_DAYS });
}

/** A local calendar day (yyyy-MM-dd) as a local midnight. */
function day(key: string): Date {
  const [year, month, date] = key.split('-').map(Number);
  return new Date(year, month - 1, date);
}

const dayKeyOf = (date: Date) => format(date, 'yyyy-MM-dd');

/** A trend point placed on the chart's day axis: `slot` days after the window's first day. */
export type WeightChartPoint = WeightTrendPoint & { slot: number };

export interface WeightChartWindow {
  /** First and last day on the axis (yyyy-MM-dd). */
  startDay: string;
  endDay: string;
  /** Days on the axis, both ends included. */
  slots: number;
  /**
   * The trend's days inside the window, oldest first, one per day. A break of
   * more than WEIGHT_TREND_RESTART_DAYS without a weigh-in is left out, so
   * the slots jump there and the line stops and starts again.
   */
  series: WeightChartPoint[];
}

/** The last day the axis shows: today, or a weigh-in dated after it (a phone set to another time zone). */
function windowEndDay(points: WeightTrendPoint[], todayKey: string): string {
  const last = points.at(-1)?.date;
  return last && last > todayKey ? last : todayKey;
}

/**
 * The trend's days between two weigh-ins more than WEIGHT_TREND_RESTART_DAYS
 * apart. The trend holds its last value across them, but a flat line there
 * would draw weeks of weight nobody measured.
 */
function breakDays(points: WeightTrendPoint[]): Set<string> {
  const held = new Set<string>();
  let previous: string | null = null;
  let waiting: string[] = [];
  for (const point of points) {
    if (point.observedKg == null) {
      waiting.push(point.date);
      continue;
    }
    if (previous !== null && differenceInCalendarDays(day(point.date), day(previous)) > WEIGHT_TREND_RESTART_DAYS) {
      for (const date of waiting) held.add(date);
    }
    previous = point.date;
    waiting = [];
  }
  return held;
}

/**
 * The days a range shows. A fixed range is the calendar days ending today, so
 * a month ago sits at the same place whatever was logged; the trend stops at
 * the last weigh-in, leaving the days since then empty rather than invented,
 * and leaves out a long break between weigh-ins the same way. All runs from
 * the first weigh-in to today.
 */
export function weightChartWindow(points: WeightTrendPoint[], days: number | null, todayKey: string): WeightChartWindow {
  const endDay = windowEndDay(points, todayKey);
  const first = points[0]?.date ?? endDay;
  const startDay = days === null ? (first < endDay ? first : endDay) : dayKeyOf(addDays(day(endDay), -(Math.max(1, days) - 1)));
  const start = day(startDay);
  const held = breakDays(points);
  const series = points
    .filter((point) => point.date >= startDay && point.date <= endDay && !held.has(point.date))
    .map((point) => ({ ...point, slot: differenceInCalendarDays(day(point.date), start) }));
  return { startDay, endDay, slots: differenceInCalendarDays(day(endDay), start) + 1, series };
}

/**
 * The days from the start of the latest run of weigh-ins to the axis's last
 * day, at most `maxDays`. A run starts at the first weigh-in after a break of
 * more than WEIGHT_TREND_RESTART_DAYS, where the trend starts again, so a
 * summary of lately isn't stretched back to one weigh-in months before.
 */
export function weightLatestRunDays(points: WeightTrendPoint[], maxDays: number, todayKey: string): number {
  let start: string | null = null;
  let previous: string | null = null;
  for (const point of points) {
    if (point.observedKg == null) continue;
    if (previous === null || differenceInCalendarDays(day(point.date), day(previous)) > WEIGHT_TREND_RESTART_DAYS) start = point.date;
    previous = point.date;
  }
  if (start === null) return maxDays;
  const days = differenceInCalendarDays(day(windowEndDay(points, todayKey)), day(start)) + 1;
  return Math.max(1, Math.min(maxDays, days));
}

export interface WeightChartTick {
  slot: number;
  label: string;
}

// The most labels a span gets, so they never crowd: dates are wider than months.
const MAX_WEEK_TICKS = 5;
const MAX_MONTH_TICKS = 7;
const MONTH_STEPS = [1, 2, 3, 6, 12];

/**
 * The date axis under the chart. Up to two months: Mondays, as "Oct 13",
 * weekly or every other week. Longer: the first of the month as "Sep", every
 * one, two, three or six months counted from January, with January written as
 * its year; over several years, Januaries only. A tick never sits on the
 * axis's first day, where its label would hide the line's start.
 */
export function weightChartTicks(startDay: string, slots: number): WeightChartTick[] {
  if (slots < 2) return [];
  const start = day(startDay);
  const end = addDays(start, slots - 1);
  const ticks: WeightChartTick[] = [];
  const add = (date: Date, label: string) => {
    const slot = differenceInCalendarDays(date, start);
    if (slot > 0 && slot < slots) ticks.push({ slot, label });
  };

  if (slots <= 62) {
    const step = [7, 14].find((days) => Math.ceil(slots / days) <= MAX_WEEK_TICKS) ?? 14;
    let monday = startOfWeek(start, { weekStartsOn: 1 });
    if (monday <= start) monday = addDays(monday, 7);
    for (let date = monday; date <= end; date = addDays(date, step)) add(date, format(date, 'MMM d'));
    return ticks;
  }

  const months = differenceInCalendarMonths(end, start) + 1;
  const monthStep = MONTH_STEPS.find((step) => months / step <= MAX_MONTH_TICKS);
  const yearStep = monthStep ? 1 : Math.ceil(months / 12 / MAX_MONTH_TICKS);
  let month = startOfMonth(start);
  if (month <= start) month = addMonths(month, 1);
  for (let date = month; date <= end; date = addMonths(date, 1)) {
    const january = date.getMonth() === 0;
    const shown = monthStep ? date.getMonth() % monthStep === 0 : january && date.getFullYear() % yearStep === 0;
    if (shown) add(date, january ? format(date, 'yyyy') : format(date, 'MMM'));
  }
  return ticks;
}

/**
 * The trend's change across the days shown, from its first day to its last:
 * "+4.1 lb since Aug 7" ("since Mar 2, 2025" from another year, the month
 * and day joined by a no-break space), or "No
 * change since Aug 7". Null with fewer than two days. A gain is written like
 * a loss, with its sign and no judgement: whether it is good depends on the goal.
 */
export function weightChangeLabel(series: WeightTrendPoint[], unit: WeightUnit): string | null {
  const since = weightSinceLabel(series);
  if (!since) return null;
  const change = kgToUnit(series[series.length - 1].ewmaKg - series[0].ewmaKg, unit);
  const shown = Math.abs(change).toFixed(1);
  if (Number(shown) === 0) return `No change ${since}`;
  return `${change > 0 ? '+' : '−'}${shown} ${unit} ${since}`;
}

/**
 * Where the days shown start, as the change names them: "since Aug 7"
 * ("since Mar 2, 2025" from another year). Null with fewer than two days.
 */
export function weightSinceLabel(series: WeightTrendPoint[]): string | null {
  if (series.length < 2) return null;
  const from = day(series[0].date);
  const to = day(series[series.length - 1].date);
  // "Apr 10" stays together when the line wraps at the largest text sizes.
  return `since ${format(from, from.getFullYear() === to.getFullYear() ? 'MMM d' : 'MMM d, yyyy').replace(' ', '\u00a0')}`;
}

/** Under two weeks the change says enough: a weekly rate from a few days would be mostly noise. */
const MIN_RATE_DAYS = 14;

/**
 * The trend's average weekly change across the days shown, in kg (negative
 * loses), so the rate beside "+8.1 lb since May 8" describes those same
 * days. Null under two weeks.
 */
export function weightRangeKgPerWeek(series: WeightTrendPoint[]): number | null {
  if (series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  const days = differenceInCalendarDays(day(last.date), day(first.date));
  if (days < MIN_RATE_DAYS) return null;
  return ((last.ewmaKg - first.ewmaKg) / days) * 7;
}

export interface WeighInMonth<T> {
  /** yyyy-MM, local. */
  key: string;
  /** "October", or "October 2025" outside this year. */
  title: string;
  /** The month's weigh-ins, newest first, as given. */
  entries: T[];
  /** Mean of the month's daily medians, so a day weighed five times counts once. */
  averageKg: number | null;
}

/** The log by local calendar month, newest first. `entries` come newest first. */
export function weighInsByMonth<T extends WeightSampleLike>(entries: T[], todayKey: string): WeighInMonth<T>[] {
  const year = day(todayKey).getFullYear();
  const months: WeighInMonth<T>[] = [];
  for (const entry of entries) {
    const measured = new Date(entry.measured_at);
    if (!Number.isFinite(measured.getTime())) continue;
    const key = format(measured, 'yyyy-MM');
    let month = months.at(-1);
    if (month?.key !== key) {
      month = { key, title: format(measured, measured.getFullYear() === year ? 'MMMM' : 'MMMM yyyy'), entries: [], averageKg: null };
      months.push(month);
    }
    month.entries.push(entry);
  }
  for (const month of months) {
    const medians = [...dailyMedianWeights(month.entries).values()];
    month.averageKg = medians.length > 0 ? medians.reduce((sum, kg) => sum + kg, 0) / medians.length : null;
  }
  return months;
}

/**
 * Every weigh-in, newest first: the recent read for its own window (it is read
 * again after every log, sync and refresh) and the full read for anything
 * older. Without a full read, the recent one alone.
 */
export function mergeWeightHistory<T extends { id: string; measured_at: string }>(
  recent: T[],
  recentSince: string | null,
  all: T[] | null,
): T[] {
  if (!all) return recent;
  const since = recentSince ? Date.parse(recentSince) : Number.NaN;
  const ids = new Set(recent.map((entry) => entry.id));
  const older = Number.isFinite(since)
    ? all.filter((entry) => !ids.has(entry.id) && Date.parse(entry.measured_at) < since)
    : all.filter((entry) => !ids.has(entry.id));
  return [...recent, ...older].sort((a, b) => Date.parse(b.measured_at) - Date.parse(a.measured_at));
}
