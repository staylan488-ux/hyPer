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

/** The box each figure is drawn in; the hands reach to about 13 and 87. */
export const FIGURE = { left: 11.5, right: 88.5, top: 0.5, bottom: 210 } as const;

const mirror = (points: Pt[]): Pt[] => points.map(([x, y]) => [100 - x, y] as const);

/** The legs' own middle line, which they widen about. */
const LEG_MIDDLE = 59.4;
/**
 * The legs, a tenth wider than they were first drawn: points below the hips
 * spread from the leg's middle, easing in from the hip down to the thigh, so
 * the waist and the hips keep their line. Never past the body's midline.
 */
const legs = (points: Pt[]): Pt[] =>
  points.map(([x, y]) => {
    const k = 1 + 0.1 * Math.min(1, Math.max(0, (y - 106) / 18));
    return [Math.max(50.4, LEG_MIDDLE + (x - LEG_MIDDLE) * k), y] as const;
  });

/**
 * A muscle drawn a little larger than its points, every edge moved outward by
 * `by` along the corner's normal, so neighbours sit about a seam apart.
 */
function grow(points: Pt[], by = GROW): Pt[] {
  const n = points.length;
  // Which way round the outline runs, so "outward" is outward.
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const turn = area > 0 ? 1 : -1;
  return points.map(([x, y], i) => {
    const [px, py] = points[(i - 1 + n) % n];
    const [nx, ny] = points[(i + 1) % n];
    // The corner's normal: the mean of its two edges' normals.
    const edge = (dx: number, dy: number) => {
      const length = Math.hypot(dx, dy) || 1;
      return [(dy / length) * turn, (-dx / length) * turn];
    };
    const [ax, ay] = edge(x - px, y - py);
    const [bx, by2] = edge(nx - x, ny - y);
    const mx = ax + bx;
    const my = ay + by2;
    const length = Math.hypot(mx, my) || 1;
    return [Number((x + (mx / length) * by).toFixed(2)), Number((y + (my / length) * by).toFixed(2))] as const;
  });
}
/** How far each muscle grows past its points, in figure units (about a third of a point). */
const GROW = 0.45;
/** A shape given by its right half, top to bottom, closed through its mirror. */
const whole = (half: Pt[]): Pt[] => [...half, ...mirror(half).reverse()];
/** A region drawn on both sides of the body. */
const both = (muscle: MuscleGroup, points: Pt[]): Region[] => {
  const grown = grow(points);
  return [
    { muscle, points: grown },
    { muscle, points: mirror(grown) },
  ];
};
/** A leg muscle on both sides, widened with the legs. */
const bothLegs = (muscle: MuscleGroup, points: Pt[]): Region[] => both(muscle, legs(points));

export const HEAD = { cx: 50, cy: 13.6, rx: 8.6, ry: 11.6 } as const;

/** Neck, torso and legs, the right half from the neck down and back up the inside leg. */
const TRUNK = whole(legs([
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
]));

/** One arm, shoulder to fingertips and back up the inside. */
const ARM: Pt[] = [
  [68.6, 36.6],
  [74.6, 37.6],
  [79.0, 41.0],
  [81.2, 47.0],
  [81.4, 54],
  [81.0, 61],
  [81.0, 69],
  [81.8, 78],
  [83.4, 88],
  [84.6, 98],
  [85.0, 107],
  [84.9, 112.6],
  [86.2, 117.6],
  [86.8, 123.6],
  [85.6, 129.2],
  [82.8, 131.0],
  [80.6, 127.8],
  [79.8, 121],
  [79.2, 114],
  [77.2, 104],
  [74.8, 94],
  [72.9, 85],
  [71.7, 78.6],
  [70.7, 70.4],
  [69.4, 61],
  [67.9, 52],
  [67.0, 44],
];

/** The bare figure: head, trunk and arms, filled in one colour. */
export const BODY: Pt[][] = [TRUNK, ARM, mirror(ARM)];

/** The side delt: the shoulder's outer cap, wide enough to read in any state. */
const SIDE_DELTS: Pt[] = [
  [75.0, 38.4],
  [78.4, 41.4],
  [80.4, 46.8],
  [80.6, 53],
  [79.4, 58.0],
  [77.4, 59.6],
  [75.6, 55],
  [75.0, 48.6],
  [74.4, 43.0],
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
    [67.4, 37.4],
    [71.6, 37.6],
    [73.2, 40.6],
    [73.8, 47.0],
    [74.2, 53.6],
    [73.6, 58.6],
    [71.6, 54.6],
    [70.4, 47.8],
    [68.8, 41.6],
  ]),
  ...both('side_delts', SIDE_DELTS),
  ...both('biceps', [
    [71.0, 60.4],
    [76.2, 61.2],
    [79.4, 64.6],
    [80.0, 71.0],
    [79.6, 77.4],
    [76.8, 81.0],
    [73.4, 79.8],
    [71.6, 72.6],
    [70.4, 65.4],
  ]),
  // The abdominals down the middle, the obliques either side: all core.
  {
    muscle: 'core',
    points: grow(whole([
      [51.6, 61.0],
      [55.2, 61.8],
      [56.4, 72],
      [56.2, 86],
      [55.2, 97.6],
      [53.0, 105.4],
      [50.6, 108.0],
    ])),
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
  ...bothLegs('quads', [
    [60.4, 112.4],
    [64.6, 110.2],
    [67.6, 115.0],
    [67.4, 124.0],
    [66.6, 136.0],
    [65.2, 146.0],
    [63.4, 153.6],
    [60.8, 152.6],
    [59.4, 142.0],
    [58.8, 128.0],
    [59.0, 117.6],
  ]),
  ...bothLegs('quads', [
    [57.0, 117.4],
    [57.4, 128.0],
    [57.8, 140.0],
    [58.8, 150.4],
    [57.6, 156.0],
    [55.0, 154.6],
    [54.1, 147.6],
    [53.1, 137.0],
    [52.1, 127.0],
    [51.6, 121.4],
    [54.4, 118.4],
  ]),
];

export const BACK: Region[] = [
  {
    muscle: 'traps',
    points: grow(whole([
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
    ])),
  },
  ...both('rear_delts', [
    [68.4, 38.4],
    [72.4, 38.2],
    [73.4, 41.6],
    [73.8, 47.6],
    [73.8, 53.6],
    [72.4, 57.2],
    [70.6, 51.0],
    [68.8, 45.0],
    [66.6, 41.4],
  ]),
  ...both('side_delts', SIDE_DELTS),
  ...both('triceps', [
    [70.8, 59.2],
    [76.6, 60.4],
    [79.6, 64.2],
    [80.2, 71.0],
    [79.8, 77.6],
    [76.8, 81.2],
    [73.4, 80.0],
    [71.6, 72.6],
    [70.2, 65.0],
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
  ...bothLegs('glutes', [
    [51.0, 105.4],
    [55.8, 102.8],
    [61.8, 102.6],
    [65.6, 105.4],
    [67.2, 112.0],
    [67.4, 119.0],
    [64.0, 124.0],
    [57.8, 125.6],
    [52.6, 124.2],
    [50.8, 116.0],
  ]),
  // The two hamstrings, parting towards the knee.
  ...bothLegs('hamstrings', [
    [59.8, 128.2],
    [64.8, 126.8],
    [67.6, 128.6],
    [66.6, 138.0],
    [65.3, 147.0],
    [63.8, 154.6],
    [61.4, 156.8],
    [59.6, 150.0],
    [59.0, 140.0],
    [59.0, 132.0],
  ]),
  ...bothLegs('hamstrings', [
    [52.2, 127.2],
    [57.4, 128.2],
    [57.8, 134.0],
    [58.0, 144.0],
    [57.4, 152.0],
    [55.6, 157.0],
    [54.5, 151.4],
    [53.5, 141.0],
    [52.7, 133.0],
  ]),
  // The calf's two heads.
  ...bothLegs('calves', [
    [59.8, 160.4],
    [63.6, 160.2],
    [64.3, 166.0],
    [64.8, 174.0],
    [63.4, 182.4],
    [60.6, 186.0],
    [59.6, 177.0],
    [59.2, 168.0],
  ]),
  ...bothLegs('calves', [
    [55.0, 160.6],
    [58.4, 160.6],
    [58.8, 168.0],
    [58.6, 177.0],
    [57.2, 186.4],
    [55.0, 181.0],
    [54.6, 172.0],
    [54.8, 165.0],
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
    [44.0, 72.4],
    [56.0, 72.4],
  ],
  [
    [43.6, 84.0],
    [56.4, 84.0],
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
