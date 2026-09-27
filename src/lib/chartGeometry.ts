/**
 * Chart geometry for the Kinetic data layer. Pure: numbers in, numbers or SVG
 * path strings out, so scrubbing and drawing can be tested without a DOM.
 */

export interface Point {
  x: number;
  y: number;
}

export type ScrubLayout = 'band' | 'point';

/** Map a value from one interval onto another. Degenerate domains map to the range midpoint. */
export function linearScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0));
}

/**
 * A y-domain around `values` with breathing room, never narrower than
 * `minSpan` so a flat series does not magnify noise into cliffs.
 */
export function paddedDomain(values: number[], pad = 0.12, minSpan = 1): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, minSpan];
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const room = (hi - lo) * pad;
  return [lo - room, hi + room];
}

/**
 * Which datum a finger at `x` is over. Bands split the width into equal
 * columns (bar charts); points sit on the column edges, first at 0 and last
 * at `width` (line charts), and snap to the nearest.
 */
export function indexAtX(x: number, width: number, count: number, layout: ScrubLayout): number | null {
  if (count <= 0 || !(width > 0) || !Number.isFinite(x)) return null;
  const clamped = Math.min(width, Math.max(0, x));
  if (layout === 'band') return Math.min(count - 1, Math.floor((clamped / width) * count));
  if (count === 1) return 0;
  return Math.round((clamped / width) * (count - 1));
}

/** Horizontal centre of item `index` for the given layout. */
export function xAtIndex(index: number, width: number, count: number, layout: ScrubLayout): number {
  if (count <= 0) return 0;
  if (layout === 'band') return ((index + 0.5) / count) * width;
  if (count === 1) return width / 2;
  return (index / (count - 1)) * width;
}

/**
 * Smooth SVG path through points that never overshoots the data between
 * samples (Fritsch–Carlson monotone cubic). Points must be sorted by x.
 */
export function monotonePath(points: Point[]): string {
  const n = points.length;
  if (n === 0) return '';
  const fmt = (v: number) => (Math.round(v * 100) / 100).toString();
  if (n === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  if (n === 2) {
    return `M${fmt(points[0].x)},${fmt(points[0].y)}L${fmt(points[1].x)},${fmt(points[1].y)}`;
  }

  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const h = points[i + 1].x - points[i].x;
    dx.push(h);
    slope.push(h === 0 ? 0 : (points[i + 1].y - points[i].y) / h);
  }

  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }

  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`;
  for (let i = 0; i < n - 1; i += 1) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const h = dx[i] / 3;
    d += `C${fmt(p0.x + h)},${fmt(p0.y + tangent[i] * h)} ${fmt(p1.x - h)},${fmt(p1.y - tangent[i + 1] * h)} ${fmt(p1.x)},${fmt(p1.y)}`;
  }
  return d;
}
