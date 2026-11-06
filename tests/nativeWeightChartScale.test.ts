import { describe, expect, it } from 'vitest';

import { sparklineDomain, weightScale } from '../native/src/lib/weightChartScale';

const options = { minSpan: 2, plotHeight: 160, clearance: 3.5 };

describe("Body weight's scale", () => {
  it('encloses every weigh-in in round weights, the lowest as the axis', () => {
    const scale = weightScale([168.6, 169.4, 171.2, 172.9], options);
    expect(scale.ticks).toEqual([168, 170, 172, 174]);
    expect(scale.domain).toEqual([168, 174]);
    expect(scale.step).toBe(2);
  });

  it('draws at most five lines', () => {
    for (const values of [[150.2, 151.1], [160, 189.5], [70.1, 70.4], [80, 104]]) {
      const { ticks, domain } = weightScale(values, options);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(5);
      expect(domain[0]).toBeLessThanOrEqual(Math.min(...values));
      expect(domain[1]).toBeGreaterThanOrEqual(Math.max(...values));
    }
  });

  it('steps down once more when the lowest weigh-in would sit on the axis', () => {
    const { ticks, domain } = weightScale([170, 171.4, 173.6], options);
    expect(domain[0]).toBeLessThan(170);
    expect(ticks[0]).toBe(domain[0]);
  });

  it('keeps half steps for kilograms', () => {
    const { ticks, step } = weightScale([78.2, 78.9, 79.6], { ...options, minSpan: 1 });
    expect(step).toBe(0.5);
    expect(ticks).toEqual([78, 78.5, 79, 79.5, 80]);
  });
});

describe("You's sparkline range", () => {
  it('fits the line with a little room', () => {
    const [low, high] = sparklineDomain([171, 171.6, 172.2], 1);
    expect(low).toBeCloseTo(170.952);
    expect(high).toBeCloseTo(172.248);
  });

  it('keeps a steady weight nearly flat', () => {
    const [low, high] = sparklineDomain([171, 171.1], 1);
    expect(high - low).toBeCloseTo(1.08);
  });
});
