// The flat front and back body figure on Progress: one silhouette and the
// muscle regions laid on it, as points the outlines are drawn smoothly
// through. Each figure sits in a 100 × 210 box, y down, the midline at
// x = 50; regions are given for one half and mirrored, apart from the ones
// that cross the midline. The back view is the same silhouette seen from
// behind, so its halves mirror the same way. Pure data and geometry.
import type { MuscleGroup } from '@/types';

export type Pt = readonly [number, number];
export type ViewSide = 'front' | 'back';

export interface Region {
  muscle: MuscleGroup;
  points: Pt[];
}

/** The box each figure is drawn in; the hands reach to about 14 and 86. */
export const FIGURE = { left: 12, right: 88, top: 0.5, bottom: 210 } as const;

const mirror = (points: Pt[]): Pt[] => points.map(([x, y]) => [100 - x, y] as const);
/** A shape given by its right half, top to bottom, closed through its mirror. */
const whole = (half: Pt[]): Pt[] => [...half, ...mirror(half).reverse()];
/** A region drawn on both sides of the body. */
const both = (muscle: MuscleGroup, points: Pt[]): Region[] => [
  { muscle, points },
  { muscle, points: mirror(points) },
];

export const HEAD = { cx: 50, cy: 13.6, rx: 8.6, ry: 11.6 } as const;

/** Neck, torso and legs, the right half from the neck down and back up the inside leg. */
const TRUNK = whole([
  [54.4, 20],
  [55.0, 27.6],
  [57.8, 31.4],
  [63.4, 33.8],
  [68.4, 36.2],
  [71.4, 39.2],
  [70.8, 46.4],
  [68.8, 56],
  [67.4, 66],
  [65.8, 78],
  [64.2, 89],
  [64.0, 96],
  [65.4, 103],
  [67.2, 110],
  [68.0, 118],
  [67.8, 128],
  [66.6, 140],
  [64.8, 151],
  [63.8, 158],
  [64.6, 166],
  [65.0, 174],
  [63.6, 186],
  [61.8, 196],
  [62.4, 201.2],
  [64.6, 205.4],
  [63.4, 208.4],
  [56.8, 208.6],
  [55.4, 204],
  [55.8, 197],
  [55.0, 188],
  [54.2, 177],
  [54.4, 166],
  [54.8, 158],
  [53.8, 147],
  [52.6, 134],
  [51.4, 123],
  [50.6, 118.4],
]);

/** One arm, shoulder to fingertips and back up the inside. */
const ARM: Pt[] = [
  [68.6, 36.8],
  [73.6, 38.4],
  [76.6, 42.6],
  [77.8, 50],
  [78.0, 58],
  [78.8, 68],
  [79.8, 78],
  [81.6, 88],
  [82.8, 98],
  [83.2, 107],
  [83.4, 112.6],
  [84.8, 117.6],
  [85.4, 123.6],
  [84.2, 129],
  [81.6, 130.6],
  [79.6, 127.4],
  [79.0, 121],
  [78.6, 114],
  [77.0, 104],
  [75.0, 94],
  [73.4, 85],
  [72.4, 78.6],
  [71.4, 70.4],
  [69.8, 61],
  [68.0, 52],
  [67.0, 44],
];

/** The bare figure: head, trunk and arms, filled in one colour. */
export const BODY: Pt[][] = [TRUNK, ARM, mirror(ARM)];

const SIDE_DELTS: Pt[] = [
  [74.0, 38.6],
  [76.8, 41.6],
  [78.4, 46.6],
  [78.6, 53],
  [77.4, 58.8],
  [75.8, 60.8],
  [75.6, 54],
  [75.4, 47],
  [74.4, 42.4],
];

export const FRONT: Region[] = [
  ...both('traps', [
    [55.6, 28.8],
    [58.2, 31.8],
    [63.4, 34.2],
    [67.4, 36.2],
    [62.6, 36.0],
    [57.8, 35.0],
    [55.8, 33.0],
  ]),
  ...both('chest', [
    [51.0, 39.6],
    [56.8, 38.2],
    [63.2, 38.6],
    [67.8, 40.8],
    [69.8, 45.4],
    [69.2, 50.8],
    [66.4, 55.6],
    [61.0, 58.4],
    [55.0, 58.6],
    [51.2, 56.0],
    [50.8, 47.6],
  ]),
  ...both('front_delts', [
    [67.0, 37.2],
    [71.6, 37.8],
    [74.8, 41.0],
    [75.8, 47.0],
    [75.0, 53.6],
    [73.0, 58.4],
    [71.2, 54.0],
    [70.2, 47.6],
    [68.4, 41.6],
  ]),
  ...both('side_delts', SIDE_DELTS),
  ...both('biceps', [
    [71.4, 60.6],
    [75.8, 61.4],
    [78.2, 65.0],
    [79.0, 71.0],
    [78.6, 77.0],
    [76.0, 80.6],
    [73.2, 79.4],
    [71.8, 72.0],
    [70.6, 65.0],
  ]),
  // The abdominals down the middle, the obliques either side: all core.
  {
    muscle: 'core',
    points: whole([
      [51.6, 61.0],
      [55.2, 61.8],
      [56.4, 72],
      [56.2, 86],
      [55.2, 97.6],
      [53.0, 105.4],
      [50.6, 108.0],
    ]),
  },
  ...both('core', [
    [57.6, 61.4],
    [62.6, 59.4],
    [67.4, 61.6],
    [66.8, 70.0],
    [65.6, 79.0],
    [64.0, 89.0],
    [63.4, 96.0],
    [60.0, 101.4],
    [57.6, 97.0],
    [57.8, 84.0],
    [58.0, 72.0],
  ]),
  // The outer quadriceps and the inner teardrop above the knee.
  ...both('quads', [
    [60.4, 112.4],
    [64.6, 110.2],
    [67.6, 115.0],
    [67.8, 124.0],
    [67.0, 136.0],
    [65.6, 146.0],
    [63.4, 153.6],
    [60.8, 152.6],
    [59.4, 142.0],
    [58.8, 128.0],
    [59.0, 117.6],
  ]),
  ...both('quads', [
    [57.0, 117.4],
    [57.4, 128.0],
    [57.8, 140.0],
    [58.8, 150.4],
    [57.6, 156.0],
    [55.0, 154.6],
    [53.8, 147.6],
    [52.8, 137.0],
    [51.8, 127.0],
    [51.6, 121.4],
    [54.4, 118.4],
  ]),
];

export const BACK: Region[] = [
  {
    muscle: 'traps',
    points: whole([
      [50.6, 24.0],
      [54.8, 27.6],
      [58.2, 31.6],
      [63.8, 34.2],
      [68.0, 36.8],
      [63.6, 39.8],
      [57.8, 44.6],
      [54.6, 52.0],
      [52.4, 62.0],
      [50.6, 69.0],
    ]),
  },
  ...both('rear_delts', [
    [68.4, 38.6],
    [72.4, 38.6],
    [75.0, 42.0],
    [75.6, 48.0],
    [74.4, 54.0],
    [72.2, 57.0],
    [70.6, 51.0],
    [68.8, 45.0],
    [66.6, 41.4],
  ]),
  ...both('side_delts', SIDE_DELTS),
  ...both('triceps', [
    [71.0, 58.8],
    [75.6, 59.8],
    [78.4, 64.0],
    [79.2, 71.0],
    [78.8, 77.4],
    [76.0, 80.8],
    [73.2, 79.6],
    [71.8, 72.0],
    [70.2, 64.6],
  ]),
  // Across the shoulder blade, then the lats down to the waist, then the
  // long muscles beside the spine: all back.
  ...both('back', [
    [58.6, 45.6],
    [64.0, 40.6],
    [67.0, 41.4],
    [69.0, 46.6],
    [68.6, 53.6],
    [62.4, 57.6],
    [56.4, 59.4],
    [55.8, 52.4],
  ]),
  ...both('back', [
    [56.2, 62.4],
    [62.6, 60.4],
    [68.4, 57.0],
    [67.4, 66.0],
    [65.8, 78.0],
    [64.2, 88.0],
    [61.0, 93.0],
    [56.8, 96.0],
    [55.4, 86.0],
    [55.2, 72.0],
  ]),
  ...both('back', [
    [51.0, 71.6],
    [53.4, 67.4],
    [54.0, 78.0],
    [54.6, 90.0],
    [54.8, 99.0],
    [52.8, 102.4],
    [51.0, 100.6],
  ]),
  ...both('glutes', [
    [51.0, 105.4],
    [55.8, 102.8],
    [61.8, 102.6],
    [65.8, 105.4],
    [67.8, 112.0],
    [67.6, 119.0],
    [64.0, 124.0],
    [57.8, 125.6],
    [52.6, 124.2],
    [50.8, 116.0],
  ]),
  // The two hamstrings, parting towards the knee.
  ...both('hamstrings', [
    [59.8, 128.2],
    [64.8, 126.8],
    [67.6, 128.6],
    [67.2, 138.0],
    [65.8, 147.0],
    [63.8, 154.6],
    [61.4, 156.8],
    [59.6, 150.0],
    [59.0, 140.0],
    [59.0, 132.0],
  ]),
  ...both('hamstrings', [
    [52.2, 127.2],
    [57.4, 128.2],
    [57.8, 134.0],
    [58.0, 144.0],
    [57.4, 152.0],
    [55.6, 157.0],
    [54.0, 151.4],
    [53.0, 141.0],
    [52.0, 133.0],
  ]),
  // The calf's two heads.
  ...both('calves', [
    [59.8, 160.4],
    [63.6, 160.2],
    [64.8, 166.0],
    [64.8, 174.0],
    [63.4, 182.4],
    [60.6, 186.0],
    [59.6, 177.0],
    [59.2, 168.0],
  ]),
  ...both('calves', [
    [55.0, 160.6],
    [58.4, 160.6],
    [58.8, 168.0],
    [58.6, 177.0],
    [57.2, 186.4],
    [55.0, 181.0],
    [54.2, 172.0],
    [54.4, 165.0],
  ]),
];

export const REGIONS: Record<ViewSide, Region[]> = { front: FRONT, back: BACK };

/** The abdominals' midline and the two lines across them, drawn as gaps. */
export const AB_LINES: Pt[][] = [
  [
    [50, 61.6],
    [50, 107],
  ],
  [
    [44.4, 72.4],
    [55.6, 72.4],
  ],
  [
    [44.0, 84.0],
    [56.0, 84.0],
  ],
];

const f = (value: number) => value.toFixed(2);

/** A closed outline drawn smoothly through its points (a Catmull-Rom spline as cubic Béziers). */
export function smoothPath(points: readonly Pt[]): string {
  const n = points.length;
  if (n < 3) return '';
  const at = (i: number) => points[(i + n) % n];
  let d = `M${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < n; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d}Z`;
}

/** Whether a point lies inside a polygon (even-odd). */
export function insidePolygon(x: number, y: number, points: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a polygon's edge (0 inside). */
export function distanceToPolygon(x: number, y: number, points: readonly Pt[]): number {
  if (insidePolygon(x, y, points)) return 0;
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

/**
 * The muscle under a point in a figure's own box, or the nearest one within
 * `reach`. Regions drawn later sit on top, so the last one under the point wins.
 */
export function regionAt(x: number, y: number, side: ViewSide, reach: number): MuscleGroup | null {
  let under: MuscleGroup | null = null;
  let nearest: { muscle: MuscleGroup; distance: number } | null = null;
  for (const region of REGIONS[side]) {
    const distance = distanceToPolygon(x, y, region.points);
    if (distance === 0) under = region.muscle;
    else if (distance <= reach && (!nearest || distance < nearest.distance)) nearest = { muscle: region.muscle, distance };
  }
  return under ?? nearest?.muscle ?? null;
}
