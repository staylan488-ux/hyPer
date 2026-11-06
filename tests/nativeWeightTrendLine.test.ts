import { describe, expect, it } from 'vitest';

import { buildWeightTrend } from '@/lib/weightTrend';
import { centredTrendLine } from '../native/src/lib/weightTrendLine';

const at = (day: number) => new Date(2026, 7, 1 + day, 8).toISOString();

describe("Body weight's drawn trend line", () => {
  it('runs through a steady gain instead of trailing it', () => {
    // 0.05 kg a day, weighed daily with a small alternating swing.
    const samples = Array.from({ length: 60 }, (_, day) => ({ measured_at: at(day), kilograms: 75 + day * 0.05 + (day % 2 ? 0.2 : -0.2) }));
    const trend = buildWeightTrend(samples);
    const line = centredTrendLine(trend.points);
    const truth = (index: number) => 75 + index * 0.05;
    // The shared average trails by over a third of a kilo; the drawn line stays on the gain.
    expect(truth(40) - trend.points[40].ewmaKg).toBeGreaterThan(0.3);
    expect(Math.abs(line[40].ewmaKg - truth(40))).toBeLessThan(0.05);
    expect(Math.abs(line.at(-1)!.ewmaKg - truth(59))).toBeLessThan(0.25);
    // Everything else about each day is the shared trend's.
    const withoutLine = (point: (typeof line)[number]) => ({ ...point, ewmaKg: 0 });
    expect(line.map(withoutLine)).toEqual(trend.points.map(withoutLine));
  });

  it('leaves mis-reads out, holds through a gap and starts again after a long break', () => {
    const samples = [
      ...Array.from({ length: 10 }, (_, day) => ({ measured_at: at(day), kilograms: 80 })),
      { measured_at: at(10), kilograms: 86 },
      { measured_at: at(11), kilograms: 80 },
      // Back after six weeks, five kilos lighter.
      ...Array.from({ length: 5 }, (_, day) => ({ measured_at: at(54 + day), kilograms: 75 })),
    ];
    const trend = buildWeightTrend(samples, { restartAfterGapDays: 28 });
    expect(trend.points[10].isOutlier).toBe(true);
    const line = centredTrendLine(trend.points);
    expect(line[10].ewmaKg).toBeCloseTo(80, 6);
    expect(line[30].ewmaKg).toBeCloseTo(80, 6);
    expect(line.at(-1)!.ewmaKg).toBeCloseTo(75, 6);
  });

  it('keeps a single weigh-in as it is', () => {
    const trend = buildWeightTrend([{ measured_at: at(0), kilograms: 70 }]);
    expect(centredTrendLine(trend.points)[0].ewmaKg).toBe(70);
  });
});
