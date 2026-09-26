import { describe, expect, it } from 'vitest';
import { indexAtX, linearScale, monotonePath, paddedDomain, xAtIndex } from '../src/lib/chartGeometry';

describe('chart geometry', () => {
  it('scales linearly and survives a degenerate domain', () => {
    const scale = linearScale([0, 10], [100, 0]);
    expect(scale(0)).toBe(100);
    expect(scale(5)).toBe(50);
    expect(scale(10)).toBe(0);
    expect(linearScale([3, 3], [0, 40])(3)).toBe(20);
  });

  it('pads a domain and widens flat series to the minimum span', () => {
    expect(paddedDomain([80, 80], 0, 2)).toEqual([79, 81]);
    const [lo, hi] = paddedDomain([70, 80], 0.1, 1);
    expect(lo).toBeCloseTo(69);
    expect(hi).toBeCloseTo(81);
    expect(paddedDomain([], 0.1, 4)).toEqual([0, 4]);
  });

  it('maps a finger to band columns, clamping outside the chart', () => {
    expect(indexAtX(0, 280, 7, 'band')).toBe(0);
    expect(indexAtX(39, 280, 7, 'band')).toBe(0);
    expect(indexAtX(41, 280, 7, 'band')).toBe(1);
    expect(indexAtX(280, 280, 7, 'band')).toBe(6);
    expect(indexAtX(-40, 280, 7, 'band')).toBe(0);
    expect(indexAtX(900, 280, 7, 'band')).toBe(6);
  });

  it('snaps a finger to the nearest point on line charts', () => {
    expect(indexAtX(0, 300, 4, 'point')).toBe(0);
    expect(indexAtX(49, 300, 4, 'point')).toBe(0);
    expect(indexAtX(51, 300, 4, 'point')).toBe(1);
    expect(indexAtX(300, 300, 4, 'point')).toBe(3);
    expect(indexAtX(120, 300, 1, 'point')).toBe(0);
  });

  it('rejects empty or unmeasured charts', () => {
    expect(indexAtX(10, 300, 0, 'band')).toBeNull();
    expect(indexAtX(10, 0, 5, 'point')).toBeNull();
    expect(indexAtX(Number.NaN, 300, 5, 'point')).toBeNull();
  });

  it('places item centres consistently with the hit test', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(indexAtX(xAtIndex(i, 280, 7, 'band'), 280, 7, 'band')).toBe(i);
      expect(indexAtX(xAtIndex(i, 300, 7, 'point'), 300, 7, 'point')).toBe(i);
    }
    expect(xAtIndex(0, 300, 1, 'point')).toBe(150);
  });

  it('draws a monotone path that passes through every sample', () => {
    const points = [
      { x: 0, y: 10 },
      { x: 10, y: 20 },
      { x: 20, y: 20 },
      { x: 30, y: 5 },
    ];
    const d = monotonePath(points);
    expect(d.startsWith('M0,10')).toBe(true);
    expect(d).toContain(' 10,20C');
    expect(d.endsWith(' 30,5')).toBe(true);
    // a flat run keeps flat tangents: no overshoot above 20 between x=10 and x=20
    const control = d.split('C')[2].split(' ').slice(0, 2).map((pair) => Number(pair.split(',')[1]));
    expect(Math.max(...control)).toBeLessThanOrEqual(20);
  });

  it('handles short series', () => {
    expect(monotonePath([])).toBe('');
    expect(monotonePath([{ x: 1, y: 2 }])).toBe('M1,2');
    expect(monotonePath([{ x: 0, y: 0 }, { x: 4, y: 2 }])).toBe('M0,0L4,2');
  });
});
