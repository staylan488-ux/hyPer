// The flat front and back body figure on Progress: one silhouette and the
// muscles that tile it, as a map of shared lines. Each figure sits in a box
// about 100 × 210, y down, the midline at x = 50, and is drawn for its right
// half and mirrored, so the two sides always match. Neighbouring muscles are
// bounded by the very same curve, so the seams between them come out one
// width everywhere, and a muscle that reaches the body's edge follows the
// silhouette exactly. The arms hang a little away from the body, the way
// anatomy charts stand, which shows the lats and the inner arm and gives
// the figure its width. The back view is the same silhouette seen from
// behind. Pure data and geometry.
import type { MuscleGroup } from '@/types';

export type Pt = readonly [number, number];
export type ViewSide = 'front' | 'back';
/** One cubic Bézier: start, two controls, end. */
export type Cubic = readonly [Pt, Pt, Pt, Pt];

export interface Region {
  muscle: MuscleGroup;
  /** The muscle's closed outline. */
  cubics: Cubic[];
  /** The parts of its outline inside the body, where it meets a neighbour: drawn as seams. */
  seams: Cubic[][];
  /** The outline as a polygon, for finding the muscle under a finger. */
  points: Pt[];
}

/** The arms hang this far from straight down, in degrees. */
const ARM_ANGLE = 20;
const SHOULDER: Pt = [71.5, 41];
const ux = Math.sin((ARM_ANGLE * Math.PI) / 180);
const uy = Math.cos((ARM_ANGLE * Math.PI) / 180);
/** A point on the arm: `t` down the arm from the shoulder joint, `s` across it (outward positive). */
const arm = (t: number, s: number): Pt => [SHOULDER[0] + t * ux + s * uy, SHOULDER[1] + t * uy - s * ux];

export const HEAD = { cx: 50, cy: 12.6, rx: 8.2, ry: 11.4 } as const;

/** Where lines meet: the corners every muscle is drawn between. */
const NODES: Record<string, Pt> = {
  // On the silhouette, neck to crotch.
  neckTop: [55.0, 19.0],
  nape: [55.0, 23.4],
  neckBase: [55.3, 27.0],
  acromion: arm(-6.2, -0.2),
  deltTip: arm(21, 6.8),
  armOut: arm(31, 6.1),
  armIn: arm(33, -5.3),
  armpit: [67.6, 49.6],
  ribs: [67.1, 58.6],
  flank: [65.0, 90.0],
  waist: [64.5, 83.0],
  iliac: [66.4, 97.0],
  hipOut: [68.0, 104.0],
  troch: [69.0, 111.0],
  gluteFold: [69.2, 120.0],
  kneeOut: [65.6, 151.0],
  calfOut: [65.4, 162.0],
  calfOutLow: [65.0, 183.4],
  calfInLow: [55.7, 189.0],
  calfIn: [54.3, 162.0],
  kneeIn: [54.0, 150.0],
  vmTop: [52.6, 136.0],
  crotch: [50, 118.0],
  // Inside the body: front.
  clavIn: [53.8, 33.6],
  clavOut: arm(-6.0, -6.6),
  armRoot: arm(8, -3.0),
  sternumTop: [50, 34.8],
  sternumLow: [50, 58.6],
  pecAbs: [57.6, 59.6],
  absSide: [58.0, 64.0],
  abs1: [58.4, 70.4],
  abs2: [58.4, 81.0],
  abs3: [58.0, 91.6],
  oblBase: [57.0, 100.4],
  pubis: [50, 110.5],
  mid1: [50, 70.8],
  mid2: [50, 81.4],
  mid3: [50, 92.2],
  rectusTop: [60.4, 107.0],
  kneeMid: [61.8, 148.0],
  vmIn: [58.6, 147.0],
  vmTopIn: [56.0, 127.0],
  // Inside the body: back.
  napeMid: [50, 25.6],
  rdTop: [65.8, 37.8],
  scapSpine: [58.4, 43.2],
  scapTip: [56.0, 52.6],
  erTop: [53.8, 61.0],
  trapBase: [50, 70.2],
  erMid: [56.0, 94.0],
  erBase: [53.4, 102.8],
  sacrum: [50, 104.2],
  tricepsSplit: arm(15, 1.6),
  triBase: arm(35.4, 0.8),
  glMed: [63.6, 102.2],
  hamSplitTop: [60.6, 125.4],
  hamLow: [60.6, 149.2],
  calfSplitTop: [59.6, 159.8],
  calfSplitLow: [59.8, 182.8],
};

/** Nodes a line turns sharply at, rather than passing smoothly through. */
const CORNERS = new Set(['neckTop', 'armpit', 'crotch']);

type Entry = string | Pt;

/**
 * The silhouette's right half, from under the head out along the shoulder,
 * round the arm and hand, down the side and the outside of the leg, round
 * the foot and up the inside of the leg to the crotch.
 */
const OUTLINE: Entry[] = [
  'neckTop',
  'nape',
  'neckBase',
  [57.6, 30.4],
  [62.0, 32.6],
  [66.4, 34.0],
  'acromion',
  arm(-4.6, 4.2),
  arm(-1.4, 7.6),
  arm(3, 9.3),
  arm(9, 9.0),
  arm(15, 8.0),
  'deltTip',
  arm(26, 6.4),
  'armOut',
  arm(37, 5.3),
  arm(42, 5.6),
  arm(49, 5.4),
  arm(57, 4.6),
  arm(64, 3.8),
  arm(69, 3.3),
  arm(74, 4.0),
  arm(80, 4.2),
  arm(86, 3.0),
  arm(89.5, 0.8),
  arm(89.2, -1.6),
  arm(85, -3.6),
  arm(78, -4.0),
  arm(72, -3.5),
  arm(68, -3.1),
  arm(61, -3.8),
  arm(52, -4.7),
  arm(44, -5.1),
  arm(38.5, -4.7),
  'armIn',
  arm(26, -6.1),
  arm(18, -6.5),
  arm(12.5, -6.4),
  'armpit',
  [67.4, 54.5],
  'ribs',
  [65.9, 68.0],
  [64.8, 76.0],
  'waist',
  'flank',
  'iliac',
  'hipOut',
  'troch',
  'gluteFold',
  [68.6, 131.0],
  [67.2, 142.0],
  'kneeOut',
  [64.8, 157.0],
  'calfOut',
  [66.8, 170.0],
  [66.3, 177.0],
  'calfOutLow',
  [63.6, 189.4],
  [62.7, 194.0],
  [63.4, 200.0],
  [65.0, 205.0],
  [63.6, 208.8],
  [58.6, 209.2],
  [56.6, 207.0],
  [56.6, 202.0],
  [56.8, 196.0],
  'calfInLow',
  [54.2, 179.0],
  [53.4, 170.0],
  'calfIn',
  [54.6, 156.5],
  'kneeIn',
  [53.2, 143.0],
  'vmTop',
  [52.0, 129.0],
  [51.2, 122.5],
  'crotch',
];

/** The lines inside the body, each from node to node through the points between. */
const LINES: Record<string, Entry[]> = {
  outline: OUTLINE,
  // Shoulders, both views: the seam between the side delt and the front or rear one.
  deltSeam: ['acromion', arm(1.5, 3.6), arm(9, 4.6), arm(16, 5.7), 'deltTip'],
  fold: ['armpit', 'armRoot'],
  // Front.
  scm: ['clavIn', [54.5, 30.2], 'neckBase'],
  clavicle: ['acromion', [66.6, 36.3], 'clavOut', [59.0, 35.8], 'clavIn'],
  sternumTopEdge: ['sternumTop', [52.0, 34.4], 'clavIn'],
  midFront: ['sternumTop', 'sternumLow', 'mid1', 'mid2', 'mid3', 'pubis'],
  groove: ['clavOut', arm(0, -5.4), 'armRoot', 'tricepsSplit', 'deltTip'],
  pecLow: ['armpit', [64.6, 56.6], [61.2, 58.9], 'pecAbs', [53.8, 59.7], 'sternumLow'],
  absEdge: ['pecAbs', 'absSide', 'abs1', [58.6, 75.8], 'abs2', [58.3, 86.4], 'abs3', [57.7, 96.2], 'oblBase', [55.2, 105.4], 'pubis'],
  inscr1: ['abs1', [54.2, 71.2], 'mid1'],
  inscr2: ['abs2', [54.2, 81.8], 'mid2'],
  inscr3: ['abs3', [54.0, 92.4], 'mid3'],
  obliqueTop: ['absSide', [61.6, 62.0], [64.6, 60.0], 'ribs'],
  obliqueLow: ['iliac', [63.6, 99.6], [60.2, 100.9], 'oblBase'],
  bicepsLow: ['armOut', arm(34.6, 3.4), arm(36.4, 0), arm(35.4, -3.4), 'armIn'],
  rfLat: ['rectusTop', [62.8, 116.0], [63.3, 128.0], [62.8, 140.0], 'kneeMid'],
  rfMed: ['rectusTop', [57.6, 116.0], 'vmTopIn', [56.6, 138.0], 'vmIn'],
  vlTop: ['rectusTop', [64.0, 104.6], 'hipOut'],
  vlLow: ['kneeOut', [63.6, 149.8], 'kneeMid'],
  rfLow: ['kneeMid', [60.2, 148.4], 'vmIn'],
  vmLow: ['vmIn', [57.4, 151.4], [55.4, 151.2], 'kneeIn'],
  vmTopEdge: ['vmTopIn', [54.0, 130.4], 'vmTop'],
  // Back.
  trapTop: ['napeMid', [53.0, 25.0], 'nape'],
  trapEdge: ['acromion', 'rdTop', [61.8, 40.4], 'scapSpine', [57.0, 48.0], 'scapTip', 'erTop', 'trapBase'],
  midBack: ['napeMid', 'trapBase', 'sacrum', 'crotch'],
  rdInner: ['rdTop', [66.8, 42.2], 'armRoot'],
  triSplit: ['tricepsSplit', arm(22, 1.4), arm(29, 1.0), 'triBase'],
  triLow: ['armOut', arm(34, 3.4), 'triBase', arm(35.4, -2.6), 'armIn'],
  latTop: ['scapTip', [59.8, 56.6], [64.0, 55.2], 'armpit'],
  erLat: ['erTop', [55.6, 70.0], [56.2, 82.0], 'erMid', [55.2, 99.4], 'erBase'],
  erLow: ['erBase', [51.6, 104.0], 'sacrum'],
  latLow: ['flank', [61.0, 93.0], 'erMid'],
  glTop: ['erBase', [58.6, 101.4], 'glMed'],
  glMedLow: ['glMed', [66.8, 106.4], 'troch'],
  glMedTop: ['glMed', [64.8, 99.0], 'iliac'],
  glFold: ['gluteFold', [64.4, 124.2], 'hamSplitTop', [55.6, 125.0], [52.2, 122.6], 'crotch'],
  hamSplit: ['hamSplitTop', [61.0, 134.0], [61.2, 142.0], 'hamLow'],
  hamLowOut: ['kneeOut', [63.2, 151.2], 'hamLow'],
  hamLowIn: ['hamLow', [58.0, 151.4], 'kneeIn'],
  calfSplit: ['calfSplitTop', [59.2, 168.0], [59.3, 176.0], 'calfSplitLow'],
  calfTopOut: ['calfSplitTop', [62.6, 159.0], 'calfOut'],
  calfTopIn: ['calfSplitTop', [57.0, 159.0], 'calfIn'],
  calfLowOut: ['calfOutLow', [61.8, 184.6], 'calfSplitLow'],
  calfLowIn: ['calfSplitLow', [58.0, 188.6], 'calfInLow'],
};

/**
 * Each muscle of the right half, as the nodes it runs between and the line
 * it follows from each to the next, round to where it began. Some muscles
 * are drawn as their parts (the rows of the abs, the heads of the quads),
 * so the seams between the parts show.
 */
const FRONT_TILES: Array<[MuscleGroup, string[]]> = [
  ['traps', ['neckBase', 'outline', 'acromion', 'clavicle', 'clavIn', 'scm', 'neckBase']],
  ['chest', ['sternumTop', 'sternumTopEdge', 'clavIn', 'clavicle', 'clavOut', 'groove', 'armRoot', 'fold', 'armpit', 'pecLow', 'sternumLow', 'midFront', 'sternumTop']],
  ['front_delts', ['clavOut', 'clavicle', 'acromion', 'deltSeam', 'deltTip', 'groove', 'clavOut']],
  ['side_delts', ['acromion', 'outline', 'deltTip', 'deltSeam', 'acromion']],
  ['biceps', ['armRoot', 'groove', 'deltTip', 'outline', 'armOut', 'bicepsLow', 'armIn', 'outline', 'armpit', 'fold', 'armRoot']],
  ['core', ['sternumLow', 'pecLow', 'pecAbs', 'absEdge', 'abs1', 'inscr1', 'mid1', 'midFront', 'sternumLow']],
  ['core', ['mid1', 'inscr1', 'abs1', 'absEdge', 'abs2', 'inscr2', 'mid2', 'midFront', 'mid1']],
  ['core', ['mid2', 'inscr2', 'abs2', 'absEdge', 'abs3', 'inscr3', 'mid3', 'midFront', 'mid2']],
  ['core', ['mid3', 'inscr3', 'abs3', 'absEdge', 'pubis', 'midFront', 'mid3']],
  ['core', ['absSide', 'obliqueTop', 'ribs', 'outline', 'iliac', 'obliqueLow', 'oblBase', 'absEdge', 'absSide']],
  ['quads', ['hipOut', 'outline', 'kneeOut', 'vlLow', 'kneeMid', 'rfLat', 'rectusTop', 'vlTop', 'hipOut']],
  ['quads', ['rectusTop', 'rfLat', 'kneeMid', 'rfLow', 'vmIn', 'rfMed', 'rectusTop']],
  ['quads', ['vmTopIn', 'rfMed', 'vmIn', 'vmLow', 'kneeIn', 'outline', 'vmTop', 'vmTopEdge', 'vmTopIn']],
];

const BACK_TILES: Array<[MuscleGroup, string[]]> = [
  ['traps', ['napeMid', 'trapTop', 'nape', 'outline', 'acromion', 'trapEdge', 'trapBase', 'midBack', 'napeMid']],
  ['rear_delts', ['acromion', 'trapEdge', 'rdTop', 'rdInner', 'armRoot', 'groove', 'deltTip', 'deltSeam', 'acromion']],
  ['side_delts', ['acromion', 'outline', 'deltTip', 'deltSeam', 'acromion']],
  // The triceps' outer head and its long head.
  ['triceps', ['tricepsSplit', 'groove', 'deltTip', 'outline', 'armOut', 'triLow', 'triBase', 'triSplit', 'tricepsSplit']],
  ['triceps', ['armRoot', 'groove', 'tricepsSplit', 'triSplit', 'triBase', 'triLow', 'armIn', 'outline', 'armpit', 'fold', 'armRoot']],
  // Across the shoulder blade, the lats from the armpit to the waist, and the long muscles beside the spine: all back.
  ['back', ['rdTop', 'trapEdge', 'scapTip', 'latTop', 'armpit', 'fold', 'armRoot', 'rdInner', 'rdTop']],
  ['back', ['scapTip', 'latTop', 'armpit', 'outline', 'flank', 'latLow', 'erMid', 'erLat', 'erTop', 'trapEdge', 'scapTip']],
  ['back', ['erTop', 'trapEdge', 'trapBase', 'midBack', 'sacrum', 'erLow', 'erBase', 'erLat', 'erTop']],
  ['glutes', ['sacrum', 'erLow', 'erBase', 'glTop', 'glMed', 'glMedLow', 'troch', 'outline', 'gluteFold', 'glFold', 'crotch', 'midBack', 'sacrum']],
  ['glutes', ['glMed', 'glMedTop', 'iliac', 'outline', 'troch', 'glMedLow', 'glMed']],
  // The two hamstrings, parting towards the knee, and the calf's two heads.
  ['hamstrings', ['hamSplitTop', 'glFold', 'gluteFold', 'outline', 'kneeOut', 'hamLowOut', 'hamLow', 'hamSplit', 'hamSplitTop']],
  ['hamstrings', ['hamSplitTop', 'hamSplit', 'hamLow', 'hamLowIn', 'kneeIn', 'outline', 'crotch', 'glFold', 'hamSplitTop']],
  ['calves', ['calfSplitTop', 'calfTopOut', 'calfOut', 'outline', 'calfOutLow', 'calfLowOut', 'calfSplitLow', 'calfSplit', 'calfSplitTop']],
  ['calves', ['calfSplitTop', 'calfSplit', 'calfSplitLow', 'calfLowIn', 'calfInLow', 'outline', 'calfIn', 'calfTopIn', 'calfSplitTop']],
];

interface Line {
  nodes: Map<string, number>;
  cubics: Cubic[];
}

/**
 * A line drawn smoothly through its points (a Catmull-Rom spline as cubic
 * Béziers). Its ends and its corner nodes take their direction from one
 * side only, so they turn sharply instead of overshooting.
 */
function buildLine(entries: Entry[]): Line {
  const points = entries.map((entry) => {
    if (typeof entry !== 'string') return entry;
    const point = NODES[entry];
    if (!point) throw new Error(`No node ${entry}`);
    return point;
  });
  const nodes = new Map<string, number>();
  const corner = new Set<number>([0, points.length - 1]);
  entries.forEach((entry, index) => {
    if (typeof entry !== 'string') return;
    nodes.set(entry, index);
    if (CORNERS.has(entry)) corner.add(index);
  });
  const cubics: Cubic[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const p0 = corner.has(i) ? p1 : points[i - 1];
    const p3 = corner.has(i + 1) ? p2 : points[i + 2];
    cubics.push([
      p1,
      [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
      [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
      p2,
    ]);
  }
  return { nodes, cubics };
}

const BUILT: Record<string, Line> = Object.fromEntries(Object.entries(LINES).map(([name, entries]) => [name, buildLine(entries)]));

const reverse = ([a, b, c, d]: Cubic): Cubic => [d, c, b, a];

/** A line's stretch from one of its nodes to another, in that direction. */
function span(name: string, from: string, to: string): Cubic[] {
  const line = BUILT[name];
  const i = line?.nodes.get(from);
  const j = line?.nodes.get(to);
  if (i === undefined || j === undefined) throw new Error(`No ${from} to ${to} on ${name}`);
  return i < j ? line.cubics.slice(i, j) : line.cubics.slice(j, i).reverse().map(reverse);
}

const mirrorPt = ([x, y]: Pt): Pt => [100 - x, y];
const mirrorCubic = (cubic: Cubic): Cubic => cubic.map(mirrorPt) as unknown as Cubic;

const cubicAt = ([a, b, c, d]: Cubic, t: number): Pt => {
  const u = 1 - t;
  return [
    u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0],
    u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1],
  ];
};
/** A closed run of cubics as a polygon, a few points to each. */
const polygonOf = (cubics: Cubic[]): Pt[] => cubics.flatMap((cubic) => [0, 0.25, 0.5, 0.75].map((t) => cubicAt(cubic, t)));

function buildTile(muscle: MuscleGroup, spec: string[]): Region {
  const cubics: Cubic[] = [];
  const seams: Cubic[][] = [];
  for (let k = 0; k + 2 < spec.length; k += 2) {
    const part = span(spec[k + 1], spec[k], spec[k + 2]);
    cubics.push(...part);
    if (spec[k + 1] !== 'outline') seams.push(part);
  }
  return { muscle, cubics, seams, points: polygonOf(cubics) };
}

const mirrorRegion = (region: Region): Region => ({
  muscle: region.muscle,
  cubics: region.cubics.map(mirrorCubic),
  seams: region.seams.map((seam) => seam.map(mirrorCubic)),
  points: region.points.map(mirrorPt),
});

const bothSides = (tiles: Array<[MuscleGroup, string[]]>): Region[] =>
  tiles.flatMap(([muscle, spec]) => {
    const region = buildTile(muscle, spec);
    return [region, mirrorRegion(region)];
  });

export const REGIONS: Record<ViewSide, Region[]> = { front: bothSides(FRONT_TILES), back: bothSides(BACK_TILES) };

/** The whole silhouette below the head: the right half, then the left back up, joined under the chin. */
export const SILHOUETTE: Cubic[] = (() => {
  const right = BUILT.outline.cubics;
  const left = right.map(mirrorCubic).reverse().map(reverse);
  const a = left[left.length - 1][3];
  const b = right[0][0];
  return [...right, ...left, [a, a, b, b] as Cubic];
})();
export const SILHOUETTE_POINTS: Pt[] = polygonOf(SILHOUETTE);

/** The box each figure is drawn in, from the hands' reach and the head to the feet. */
export const FIGURE = (() => {
  const xs = SILHOUETTE_POINTS.map(([x]) => x);
  const ys = SILHOUETTE_POINTS.map(([, y]) => y);
  const reach = Math.max(...xs.map((x) => Math.abs(x - 50))) + 0.8;
  return { left: 50 - reach, right: 50 + reach, top: HEAD.cy - HEAD.ry - 0.8, bottom: Math.max(...ys) + 0.8 } as const;
})();

const f = (value: number) => Number(value.toFixed(2));

/** Cubics as SVG path data, moved right by `dx`: one subpath, closed if asked. */
export function pathOf(cubics: readonly Cubic[], dx = 0, closed = true): string {
  if (cubics.length === 0) return '';
  const [start] = cubics[0];
  let d = `M${f(start[0] + dx)} ${f(start[1])}`;
  for (const [, b, c, e] of cubics) d += `C${f(b[0] + dx)} ${f(b[1])} ${f(c[0] + dx)} ${f(c[1])} ${f(e[0] + dx)} ${f(e[1])}`;
  return closed ? `${d}Z` : d;
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
 * `reach`. The muscles tile the body without overlapping, so at most one is
 * under any point.
 */
export function regionAt(x: number, y: number, side: ViewSide, reach: number): MuscleGroup | null {
  let nearest: { muscle: MuscleGroup; distance: number } | null = null;
  for (const region of REGIONS[side]) {
    const distance = distanceToPolygon(x, y, region.points);
    if (distance === 0) return region.muscle;
    if (distance <= reach && (!nearest || distance < nearest.distance)) nearest = { muscle: region.muscle, distance };
  }
  return nearest?.muscle ?? null;
}
