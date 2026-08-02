import { describe, expect, it } from 'vitest';

import {
  EWMA_ALPHA,
  buildWeightTrend,
  dailyMedianWeights,
  localIsoDate,
  olsSlope,
  type WeightSampleLike,
} from '@/lib/weightTrend';

const at = (x: number, y: number) => ({ x, y });

/** Weigh-ins at 08:00 local, so bucketing is unambiguous. */
function samplesFrom(startIsoDay: string, kilograms: Array<number | null>): WeightSampleLike[] {
  const [year, month, day] = startIsoDay.split('-').map(Number);
  const out: WeightSampleLike[] = [];

  kilograms.forEach((kg, offset) => {
    if (kg == null) return;
    const at = new Date(year, month - 1, day + offset, 8, 0, 0);
    out.push({ measured_at: at.toISOString(), kilograms: kg });
  });

  return out;
}

describe('daily bucketing', () => {
  it('takes the median of several weigh-ins in one day', () => {
    const day = new Date(2026, 6, 25, 7, 0, 0);
    const medians = dailyMedianWeights([
      { measured_at: day.toISOString(), kilograms: 82 },
      { measured_at: new Date(2026, 6, 25, 12, 0, 0).toISOString(), kilograms: 84 },
      { measured_at: new Date(2026, 6, 25, 20, 0, 0).toISOString(), kilograms: 83 },
    ]);

    expect(medians.get('2026-07-25')).toBe(83);
  });

  it('averages the middle pair on an even count', () => {
    const medians = dailyMedianWeights([
      { measured_at: new Date(2026, 6, 25, 7, 0, 0).toISOString(), kilograms: 82 },
      { measured_at: new Date(2026, 6, 25, 19, 0, 0).toISOString(), kilograms: 83 },
    ]);

    expect(medians.get('2026-07-25')).toBe(82.5);
  });

  it('drops unusable rows instead of poisoning the day', () => {
    const medians = dailyMedianWeights([
      { measured_at: new Date(2026, 6, 25, 7, 0, 0).toISOString(), kilograms: 82 },
      { measured_at: 'not-a-date', kilograms: 90 },
      { measured_at: new Date(2026, 6, 25, 9, 0, 0).toISOString(), kilograms: 0 },
      { measured_at: new Date(2026, 6, 25, 9, 0, 0).toISOString(), kilograms: Number.NaN },
    ]);

    expect(medians.get('2026-07-25')).toBe(82);
  });

  it('buckets by the local day, not the UTC day', () => {
    // 23:30 local must land on the 25th regardless of the UTC offset.
    const late = new Date(2026, 6, 25, 23, 30, 0);
    const medians = dailyMedianWeights([{ measured_at: late.toISOString(), kilograms: 82 }]);

    expect([...medians.keys()]).toEqual(['2026-07-25']);
    expect(localIsoDate(late)).toBe('2026-07-25');
  });
});

describe('OLS slope', () => {
  it('recovers a known linear slope exactly', () => {
    expect(olsSlope([at(0, 10), at(1, 11), at(2, 12), at(3, 13)])).toBeCloseTo(1, 10);
    expect(olsSlope([at(0, 14), at(1, 13), at(2, 12), at(3, 11)])).toBeCloseTo(-1, 10);
  });

  it('reads a flat series as zero', () => {
    expect(olsSlope([at(0, 82), at(1, 82), at(2, 82), at(3, 82)])).toBeCloseTo(0, 10);
  });

  it('respects gaps in x rather than treating points as evenly spaced', () => {
    // Same four values, but spread over 30 days instead of 4.
    expect(olsSlope([at(0, 10), at(10, 11), at(20, 12), at(30, 13)])).toBeCloseTo(0.1, 10);
  });

  it('is undetermined below two points or with no spread in x', () => {
    expect(olsSlope([])).toBeNull();
    expect(olsSlope([at(0, 82)])).toBeNull();
    expect(olsSlope([at(3, 82), at(3, 84)])).toBeNull();
  });
});

describe('weight trend', () => {
  it('reports nothing when there are no weigh-ins', () => {
    expect(buildWeightTrend([])).toMatchObject({
      points: [],
      latestEwmaKg: null,
      slopeKgPerDay: null,
      kgPerWeek: null,
      observedDayCount: 0,
    });
  });

  it('recovers a steady loss with no systematic bias', () => {
    // 28 days losing exactly 0.1 kg/day = 0.7 kg/week.
    const series = Array.from({ length: 28 }, (_, i) => 90 - i * 0.1);
    const trend = buildWeightTrend(samplesFrom('2026-07-01', series));

    expect(trend.observedDayCount).toBe(28);
    expect(trend.fittedDayCount).toBe(28);
    expect(trend.spanDays).toBe(28);
    // Exact, because the slope is fitted on the observations rather than on the
    // EWMA. Regressing the smoothed series instead returns about -0.50 here —
    // a 28% understatement caused purely by its start-up lag.
    expect(trend.kgPerWeek as number).toBeCloseTo(-0.7, 8);
  });

  it('recovers a steady gain just as exactly', () => {
    const series = Array.from({ length: 21 }, (_, i) => 75 + i * 0.05);
    const trend = buildWeightTrend(samplesFrom('2026-07-01', series));

    expect(trend.kgPerWeek as number).toBeCloseTo(0.35, 8);
  });

  it('absorbs a single wild reading rather than following it', () => {
    const clean = Array.from({ length: 21 }, () => 82);
    const spiked = [...clean];
    spiked[10] = 88; // a 6 kg jump for one day

    const cleanTrend = buildWeightTrend(samplesFrom('2026-07-01', clean));
    const spikedTrend = buildWeightTrend(samplesFrom('2026-07-01', spiked));

    // The smoothed value barely moves, versus the 6 kg a raw last-reading
    // display would jump.
    expect(
      Math.abs((spikedTrend.latestEwmaKg as number) - (cleanTrend.latestEwmaKg as number))
    ).toBeLessThan(1);
    // And the spike is kept out of the fit entirely, so the trend stays flat.
    expect(spikedTrend.points[10].isOutlier).toBe(true);
    expect(spikedTrend.fittedDayCount).toBe(20);
    expect(Math.abs(spikedTrend.kgPerWeek as number)).toBeLessThan(0.05);
  });

  it('does not mistake ordinary water swing for an outlier', () => {
    const jitter = [82, 83.1, 81.2, 82.6, 81.4, 82.8, 82.2];
    const trend = buildWeightTrend(samplesFrom('2026-07-01', jitter));

    expect(trend.fittedDayCount).toBe(7);
    expect(trend.points.some((p) => p.isOutlier)).toBe(false);
  });

  it('re-accepts a genuine step change instead of rejecting it forever', () => {
    // Flat, then a real 4 kg jump that persists — a holiday, not a mis-read.
    const series = [...Array.from({ length: 10 }, () => 82), ...Array.from({ length: 14 }, () => 86)];
    const trend = buildWeightTrend(samplesFrom('2026-07-01', series));

    // The first readings after the jump look wrong and are held out...
    expect(trend.points[10].isOutlier).toBe(true);
    // ...but the average chases the new level, so later ones are trusted again.
    expect(trend.points[trend.points.length - 1].isOutlier).toBe(false);
    expect(trend.latestEwmaKg as number).toBeGreaterThan(84);
  });

  it('carries the smoothed value forward across days with no weigh-in', () => {
    // Weigh-ins on days 0, 3 and 6 only.
    const trend = buildWeightTrend(samplesFrom('2026-07-01', [82, null, null, 81.5, null, null, 81]));

    expect(trend.observedDayCount).toBe(3);
    expect(trend.spanDays).toBe(7);
    expect(trend.points).toHaveLength(7);
    expect(trend.points.map((p) => p.observedKg)).toEqual([82, null, null, 81.5, null, null, 81]);
    // Gap days repeat the previous smoothed value.
    expect(trend.points[1].ewmaKg).toBe(trend.points[0].ewmaKg);
    expect(trend.points[2].ewmaKg).toBe(trend.points[0].ewmaKg);
    expect(trend.points[4].ewmaKg).toBe(trend.points[3].ewmaKg);
  });

  it('ends at the last real weigh-in rather than inventing a flat tail', () => {
    const trend = buildWeightTrend(samplesFrom('2026-07-01', [82, 82, 82]));

    expect(trend.points).toHaveLength(3);
    expect(trend.points[trend.points.length - 1].date).toBe('2026-07-03');
  });

  it('seeds the average on the first reading instead of drifting up to it', () => {
    const trend = buildWeightTrend(samplesFrom('2026-07-01', [82, 82, 82]));
    expect(trend.points[0].ewmaKg).toBe(82);
    expect(trend.latestEwmaKg).toBe(82);
  });

  it('smooths a jittery but flat series toward flat', () => {
    const jitter = [82, 83, 81.5, 82.5, 81.8, 82.4, 82.1, 81.9, 82.3, 82, 81.7, 82.2, 82, 82.1];
    const trend = buildWeightTrend(samplesFrom('2026-07-01', jitter));

    expect(Math.abs(trend.kgPerWeek as number)).toBeLessThan(0.15);
  });

  it('fits the slope over only the requested window', () => {
    // Flat for three weeks, then a sharp drop over the last week.
    const flat = Array.from({ length: 21 }, () => 90);
    const dropping = Array.from({ length: 7 }, (_, i) => 90 - (i + 1) * 0.2);
    const samples = samplesFrom('2026-07-01', [...flat, ...dropping]);

    const wholeHistory = buildWeightTrend(samples);
    const lastWeek = buildWeightTrend(samples, { windowDays: 7 });

    expect(lastWeek.kgPerWeek as number).toBeLessThan(wholeHistory.kgPerWeek as number);
  });

  it('respects a custom alpha — a higher one reacts faster', () => {
    const series = [82, 82, 82, 82, 82, 84];
    const slow = buildWeightTrend(samplesFrom('2026-07-01', series), { alpha: 0.05 });
    const fast = buildWeightTrend(samplesFrom('2026-07-01', series), { alpha: 0.5 });

    expect(fast.latestEwmaKg as number).toBeGreaterThan(slow.latestEwmaKg as number);
    expect(EWMA_ALPHA).toBe(0.1);
  });

  it('handles a single weigh-in without a slope', () => {
    const trend = buildWeightTrend(samplesFrom('2026-07-01', [82]));

    expect(trend.latestEwmaKg).toBe(82);
    expect(trend.slopeKgPerDay).toBeNull();
    expect(trend.kgPerWeek).toBeNull();
    expect(trend.observedDayCount).toBe(1);
  });

  it('does not lose or duplicate a day across a daylight-saving boundary', () => {
    // US spring-forward is 8 Mar 2026. Walking the series by adding 86,400,000
    // ms drifts an hour here, which used to make one calendar day repeat and
    // another vanish — silently dropping a weigh-in twice a year.
    const daily = Array.from({ length: 21 }, (_, i) => 90 - i * 0.05);
    const trend = buildWeightTrend(samplesFrom('2026-03-01', daily));

    expect(trend.spanDays).toBe(21);
    expect(trend.points).toHaveLength(21);
    expect(trend.observedDayCount).toBe(21);
    expect(trend.fittedDayCount).toBe(21);
    expect(new Set(trend.points.map((p) => p.date)).size).toBe(21);
    expect(trend.points.map((p) => p.dayIndex)).toEqual(daily.map((_, i) => i));
    expect(trend.kgPerWeek as number).toBeCloseTo(-0.35, 8);
  });

  it('handles the autumn fall-back boundary too', () => {
    // US fall-back is 1 Nov 2026.
    const daily = Array.from({ length: 14 }, (_, i) => 80 + i * 0.05);
    const trend = buildWeightTrend(samplesFrom('2026-10-26', daily));

    expect(trend.points).toHaveLength(14);
    expect(new Set(trend.points.map((p) => p.date)).size).toBe(14);
    expect(trend.kgPerWeek as number).toBeCloseTo(0.35, 8);
  });

  it('accepts numeric strings, as PostgREST returns for NUMERIC columns', () => {
    const trend = buildWeightTrend([
      { measured_at: new Date(2026, 6, 1, 8, 0, 0).toISOString(), kilograms: '82.400' },
      { measured_at: new Date(2026, 6, 2, 8, 0, 0).toISOString(), kilograms: '82.100' },
    ]);

    expect(trend.points[0].ewmaKg).toBeCloseTo(82.4, 6);
    expect(trend.kgPerWeek).not.toBeNull();
  });

  it('does not care what order the samples arrive in', () => {
    const ordered = samplesFrom('2026-07-01', [82, 81.8, 81.6, 81.4]);
    const shuffled = [ordered[2], ordered[0], ordered[3], ordered[1]];

    expect(buildWeightTrend(shuffled)).toEqual(buildWeightTrend(ordered));
  });
});
