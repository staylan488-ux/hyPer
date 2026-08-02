/**
 * Body-weight trend smoothing.
 *
 * Day-to-day scale readings are dominated by water, glycogen and gut contents,
 * so a raw last-minus-previous difference reports noise as signal. This module
 * turns a sparse, noisy series of weigh-ins into a trend that can be reasoned
 * about:
 *
 *   1. bucket samples by local calendar day and take the MEDIAN per day, so a
 *      day with several readings cannot be moved by one bad one;
 *   2. walk day by day applying an exponentially weighted moving average,
 *      carrying the last value forward on days with no weigh-in — this is the
 *      "what do I actually weigh right now" figure;
 *   3. flag any reading that sits implausibly far from the smoothed value as an
 *      outlier;
 *   4. fit an ordinary least-squares line through the OBSERVED, non-outlier
 *      readings, indexed by real day offset so gaps do not distort it.
 *
 * Step 4 deliberately regresses the observations rather than the smoothed
 * series. An EWMA seeded at the first reading spends roughly 1/alpha days
 * catching up, so regressing it systematically understates a real trend — by
 * about 28% over four weeks at alpha 0.1. That error is not harmless here: the
 * expenditure estimator divides by this slope, so an understated rate of loss
 * would quietly understate maintenance calories. OLS on the raw observations is
 * unbiased, and the outlier flag in step 3 supplies the robustness that
 * smoothing would otherwise have provided.
 *
 * Pure — callers pass arrays in and get numbers out. No I/O, no clock reads.
 */

export interface WeightSampleLike {
  measured_at: string;
  kilograms: number | string;
}

export interface WeightTrendPoint {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  /** Days since the first weigh-in — the x axis for the regression. */
  dayIndex: number;
  /** Smoothed weight for the day. */
  ewmaKg: number;
  /** Median of that day's weigh-ins, or null when nothing was recorded. */
  observedKg: number | null;
  /** Observed but implausibly far from the smoothed value; excluded from the fit. */
  isOutlier: boolean;
}

export interface WeightTrend {
  /** One point per calendar day between the first and last weigh-in, oldest first. */
  points: WeightTrendPoint[];
  latestEwmaKg: number | null;
  /** Slope of the smoothed series. Negative loses. */
  slopeKgPerDay: number | null;
  kgPerWeek: number | null;
  /** Days that actually had a weigh-in — the honest measure of coverage. */
  observedDayCount: number;
  /** Observed days the slope was actually fitted on, after dropping outliers. */
  fittedDayCount: number;
  /** Calendar days spanned, including gaps. */
  spanDays: number;
}

/**
 * ~7-day half-life: responsive enough to drive weekly decisions, aggressive
 * enough to erase daily water swing. Roughly 95% of the weight in the average
 * comes from the last four weeks.
 */
export const EWMA_ALPHA = 0.1;

/**
 * A reading further than this from the smoothed value is treated as a mis-read.
 * Ordinary day-to-day water swing runs well under a kilo; the percentage term
 * keeps the rule fair across bodyweights.
 */
const OUTLIER_ABSOLUTE_KG = 1.5;
const OUTLIER_FRACTION = 0.02;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in the viewer's own timezone, not UTC. */
export function localIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * One weight per local calendar day. The median rather than the mean, so a
 * single mis-read (a bag still in hand, a child on the scale) is discarded
 * rather than averaged in.
 */
export function dailyMedianWeights(samples: WeightSampleLike[]): Map<string, number> {
  const byDay = new Map<string, number[]>();

  for (const sample of samples) {
    const kilograms = Number(sample.kilograms);
    const measuredAtMs = Date.parse(sample.measured_at);
    if (!Number.isFinite(kilograms) || kilograms <= 0 || !Number.isFinite(measuredAtMs)) continue;

    const day = localIsoDate(new Date(measuredAtMs));
    const existing = byDay.get(day);
    if (existing) existing.push(kilograms);
    else byDay.set(day, [kilograms]);
  }

  const medians = new Map<string, number>();
  for (const [day, values] of byDay) medians.set(day, median(values));
  return medians;
}

/**
 * OLS slope of y against x. Null when it is not determined — fewer than two
 * points, or every point sharing one x.
 */
export function olsSlope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 2) return null;

  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;

  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const dx = point.x - meanX;
    covariance += dx * (point.y - meanY);
    variance += dx * dx;
  }

  return variance === 0 ? null : covariance / variance;
}

export interface WeightTrendOptions {
  alpha?: number;
  /** Fit the slope over only the last N days of the smoothed series. */
  windowDays?: number;
}

export function buildWeightTrend(
  samples: WeightSampleLike[],
  options: WeightTrendOptions = {},
): WeightTrend {
  const alpha = options.alpha ?? EWMA_ALPHA;
  const medians = dailyMedianWeights(samples);

  const empty: WeightTrend = {
    points: [],
    latestEwmaKg: null,
    slopeKgPerDay: null,
    kgPerWeek: null,
    observedDayCount: 0,
    fittedDayCount: 0,
    spanDays: 0,
  };
  if (medians.size === 0) return empty;

  const days = [...medians.keys()].sort();
  const firstMs = parseLocalIsoDate(days[0]).getTime();
  const lastMs = parseLocalIsoDate(days[days.length - 1]).getTime();

  // The series stops at the last real weigh-in. Carrying a flat line forward to
  // today would invent data for someone who simply stopped weighing in.
  const points: WeightTrendPoint[] = [];
  let ewma: number | null = null;
  let dayIndex = 0;

  for (let ms = firstMs; ms <= lastMs; ms += MS_PER_DAY, dayIndex += 1) {
    const date = localIsoDate(new Date(ms));
    const observed = medians.get(date) ?? null;

    // Judge the reading against the smoothed value as it stood BEFORE this day.
    // The first reading has nothing to be judged against.
    let isOutlier = false;
    if (observed != null && ewma != null) {
      const tolerance = Math.max(OUTLIER_ABSOLUTE_KG, OUTLIER_FRACTION * ewma);
      isOutlier = Math.abs(observed - ewma) > tolerance;
    }

    if (observed != null) {
      // Outliers still nudge the average — at alpha 0.1 a 6 kg spike moves it
      // 0.6 kg and decays — so a genuine step change is absorbed rather than
      // rejected forever. They are only excluded from the regression.
      ewma = ewma == null ? observed : ewma + alpha * (observed - ewma);
    }
    if (ewma == null) continue;

    points.push({ date, dayIndex, ewmaKg: ewma, observedKg: observed, isOutlier });
  }

  const windowed = options.windowDays != null && options.windowDays > 0
    ? points.slice(-options.windowDays)
    : points;

  const fitted = windowed
    .filter((point): point is WeightTrendPoint & { observedKg: number } =>
      point.observedKg != null && !point.isOutlier)
    .map((point) => ({ x: point.dayIndex, y: point.observedKg }));

  const slopeKgPerDay = olsSlope(fitted);

  return {
    points,
    latestEwmaKg: points.length > 0 ? points[points.length - 1].ewmaKg : null,
    slopeKgPerDay,
    kgPerWeek: slopeKgPerDay == null ? null : slopeKgPerDay * 7,
    observedDayCount: medians.size,
    fittedDayCount: fitted.length,
    spanDays: Math.round((lastMs - firstMs) / MS_PER_DAY) + 1,
  };
}
