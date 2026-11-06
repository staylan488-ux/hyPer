import { describe, expect, it } from 'vitest';

import { MUSCLE_PARTS } from '@/lib/maquette';
import { BODY, distanceToPolygon, FIGURE, REGIONS, regionAt, type ViewSide } from '../native/src/lib/anatomy';

const centre = (points: ReadonlyArray<readonly [number, number]>) => [
  points.reduce((sum, [x]) => sum + x, 0) / points.length,
  points.reduce((sum, [, y]) => sum + y, 0) / points.length,
];

describe("Progress's muscle figure", () => {
  it('draws every muscle the shared shading grades', () => {
    const drawn = new Set([...REGIONS.front, ...REGIONS.back].map((region) => region.muscle));
    expect([...drawn].sort()).toEqual([...new Set(MUSCLE_PARTS.map((part) => part.muscle))].sort());
  });

  it('finds each muscle under the middle of its own outline', () => {
    for (const side of ['front', 'back'] as ViewSide[]) {
      for (const region of REGIONS[side]) {
        const [x, y] = centre(region.points);
        expect(regionAt(x, y, side, 0), `${side} ${region.muscle}`).toBe(region.muscle);
      }
    }
  });

  it('counts a near miss within reach and nothing far from every muscle', () => {
    // Just outside the side delt on the front, then off past the hand.
    expect(regionAt(80, 50, 'front', 4)).toBe('side_delts');
    expect(regionAt(98, 200, 'front', 4)).toBeNull();
  });

  it('draws the side delt wide enough to read at the figure’s size', () => {
    // Progress draws the 210-unit figure 164 pt tall: about 0.78 pt a unit.
    const points = 164 / (FIGURE.bottom - FIGURE.top);
    for (const side of ['front', 'back'] as ViewSide[]) {
      const delt = REGIONS[side].find((region) => region.muscle === 'side_delts')!;
      const xs = delt.points.map(([x]) => x);
      expect((Math.max(...xs) - Math.min(...xs)) * points, side).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The outlines are drawn smoothly through their points, so a point may sit
  // a little past the body's straight-edged outline and still draw inside it.
  it('keeps every muscle inside the silhouette, up to its contour', () => {
    for (const side of ['front', 'back'] as ViewSide[]) {
      for (const region of REGIONS[side]) {
        for (const [x, y] of region.points) {
          const away = Math.min(...BODY.map((outline) => distanceToPolygon(x, y, outline)));
          expect(away, `${side} ${region.muscle} at ${x}, ${y}`).toBeLessThanOrEqual(0.6);
        }
      }
    }
  });
});
