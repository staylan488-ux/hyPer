// The trend line Body weight draws, centred on each day.
//
// The shared trend (src/lib/weightTrend.ts) is an exponential average, the
// right figure for "what do I weigh now" and for the adaptive targets, but it
// only looks back: on a steady gain it trails the weigh-ins by about a week
// and a half, so the line ran under nearly every dot. A chart of past days can
// look both ways, so the line drawn is a local straight-line fit through the
// weigh-ins on either side of each day (weighted by nearness), which follows
// a steady change without lagging it. Mis-reads stay out of the fit, as they
// stay out of the shared slope. Display only: nothing here feeds the targets.
import type { WeightTrendPoint } from '@/lib/weightTrend';

/** How far either side a day looks, at the least (the Gaussian's spread, in days). */
const SPREAD_DAYS = 5;
/** With sparse weigh-ins the spread widens until about this many count. */
const NEAREST = 6;
/** A break this long starts a new line, as the shared trend restarts (WEIGHT_TREND_RESTART_DAYS). */
const BREAK_DAYS = 28;

const dayNumber = (key: string) => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

type Reading = { t: number; kg: number };

/** The fitted weight at day `t` from one unbroken run of weigh-ins (sorted by day). */
function fitAt(t: number, run: Reading[]): number {
  if (run.length === 1) return run[0].kg;
  // The first weigh-in on or after t, then the NEAREST closest ones around it.
  let lo = 0;
  let hi = run.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (run[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  let left = lo - 1;
  let right = lo;
  let farthest = 0;
  for (let taken = 0; taken < NEAREST && (left >= 0 || right < run.length); taken += 1) {
    const before = left >= 0 ? t - run[left].t : Infinity;
    const after = right < run.length ? run[right].t - t : Infinity;
    farthest = Math.min(before, after);
    if (before <= after) left -= 1;
    else right += 1;
  }
  // The spread: at least SPREAD_DAYS, wider until those weigh-ins fall inside two spreads.
  const spread = Math.max(SPREAD_DAYS, farthest / 2);
  let sw = 0;
  let st = 0;
  let sk = 0;
  let stt = 0;
  let stk = 0;
  let low = Infinity;
  let high = -Infinity;
  // Every weigh-in within three spreads either side.
  let start = lo;
  while (start > 0 && t - run[start - 1].t <= 3 * spread) start -= 1;
  for (let i = start; i < run.length && run[i].t - t <= 3 * spread; i += 1) {
    const reading = run[i];
    const offset = reading.t - t;
    const w = Math.exp(-0.5 * (offset / spread) ** 2);
    sw += w;
    st += w * offset;
    sk += w * reading.kg;
    stt += w * offset * offset;
    stk += w * offset * reading.kg;
    low = Math.min(low, reading.kg);
    high = Math.max(high, reading.kg);
  }
  if (sw === 0) return run[0].kg;
  const meanT = st / sw;
  const meanK = sk / sw;
  const variance = stt / sw - meanT * meanT;
  // Too few days apart for a slope (one side only, close together): the weighted mean.
  if (variance < 1) return meanK;
  const slope = (stk / sw - meanT * meanK) / variance;
  // At the ends a fit leans on one side; it never draws past the weigh-ins it used.
  return Math.min(high, Math.max(low, meanK - slope * meanT));
}

/**
 * The trend's days with `ewmaKg` replaced by the centred line, so the chart,
 * its readout and the change above it all describe the line drawn. Days after
 * a run's last weigh-in (a break) hold its last value, as the shared trend
 * does, and a weigh-in after a long break starts the line again.
 */
export function centredTrendLine(points: WeightTrendPoint[]): WeightTrendPoint[] {
  const readings: Reading[] = points
    .filter((point) => point.observedKg != null && !point.isOutlier)
    .map((point) => ({ t: dayNumber(point.date), kg: point.observedKg as number }));
  if (readings.length === 0) return points;
  const runs: Reading[][] = [];
  for (const reading of readings) {
    const run = runs.at(-1);
    if (run && reading.t - run[run.length - 1].t <= BREAK_DAYS) run.push(reading);
    else runs.push([reading]);
  }
  let index = 0;
  return points.map((point) => {
    const t = dayNumber(point.date);
    while (index < runs.length - 1 && runs[index + 1][0].t <= t) index += 1;
    const run = runs[index];
    // Before the first good weigh-in (the first ones mis-read) or after a run ends, hold its edge.
    const at = Math.min(Math.max(t, run[0].t), run[run.length - 1].t);
    return { ...point, ewmaKg: fitAt(at, run) };
  });
}
