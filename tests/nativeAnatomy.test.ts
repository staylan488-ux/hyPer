import { describe, expect, it } from 'vitest';

import { MUSCLE_PARTS } from '@/lib/maquette';
import { REGIONS, regionAt, type ViewSide } from '../native/src/lib/anatomy';

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
});
