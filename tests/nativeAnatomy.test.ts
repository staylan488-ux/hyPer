import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { MUSCLE_PARTS } from '@/lib/maquette';
import { distanceToPolygon, FIGURE, insidePolygon, REGIONS, regionAt, SILHOUETTE, SILHOUETTE_POINTS, type Pt, type ViewSide } from '../native/src/lib/anatomy';
import { MUSCLE_TONES } from '../native/src/theme/muscleTones';

const SIDES: ViewSide[] = ['front', 'back'];
/** Progress draws the figure this tall (MuscleFigure's height), in points. */
const FIGURE_POINTS = 136;
const pointsPerUnit = FIGURE_POINTS / (FIGURE.bottom - FIGURE.top);

/** How far a point inside a polygon is from its edge. */
const depth = (x: number, y: number, points: readonly Pt[]) => {
  let best = Infinity;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [ax, ay] = points[j];
    const [bx, by] = points[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
};

/** Points on a fine grid over the figure's box. */
const grid = (step: number): Pt[] => {
  const points: Pt[] = [];
  for (let y = FIGURE.top + 0.237; y < FIGURE.bottom; y += step) for (let x = FIGURE.left + 0.113; x < FIGURE.right; x += step) points.push([x, y]);
  return points;
};

const close = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;

describe("Progress's muscle figure", () => {
  it('draws every muscle the shared shading grades', () => {
    const drawn = new Set([...REGIONS.front, ...REGIONS.back].map((region) => region.muscle));
    expect([...drawn].sort()).toEqual([...new Set(MUSCLE_PARTS.map((part) => part.muscle))].sort());
  });

  it('draws each muscle as one closed, unbroken outline', () => {
    for (const side of SIDES) {
      for (const region of REGIONS[side]) {
        const { cubics } = region;
        cubics.forEach((cubic, i) => expect(close(cubic[3], cubics[(i + 1) % cubics.length][0]), `${side} ${region.muscle}`).toBe(true));
      }
    }
    SILHOUETTE.forEach((cubic, i) => expect(close(cubic[3], SILHOUETTE[(i + 1) % SILHOUETTE.length][0])).toBe(true));
  });

  it('mirrors every muscle across the midline', () => {
    for (const side of SIDES) {
      for (const region of REGIONS[side]) {
        const mirrored = region.points.map(([x, y]) => [100 - x, y] as const);
        const twin = REGIONS[side].find(
          (other) => other.muscle === region.muscle && other.points.length === mirrored.length && other.points.every((point, i) => close(point, mirrored[i])),
        );
        expect(twin, `${side} ${region.muscle}`).toBeDefined();
      }
    }
  });

  it('never lays one muscle over another', () => {
    for (const side of SIDES) {
      for (const [x, y] of grid(0.5)) {
        const under = REGIONS[side].filter((region) => insidePolygon(x, y, region.points));
        expect(under.length, `${side} at ${x.toFixed(1)}, ${y.toFixed(1)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps every muscle inside the silhouette', () => {
    for (const side of SIDES) {
      for (const region of REGIONS[side]) {
        for (const [x, y] of region.points) {
          expect(distanceToPolygon(x, y, SILHOUETTE_POINTS), `${side} ${region.muscle} at ${x}, ${y}`).toBeLessThanOrEqual(0.05);
        }
      }
    }
  });

  it('draws seams only inside the body, never along its edge', () => {
    for (const side of SIDES) {
      for (const region of REGIONS[side]) {
        for (const seam of region.seams) {
          for (const [a, b, c, d] of seam) {
            // The middle of each piece of the seam.
            const mid: Pt = [(a[0] + 3 * b[0] + 3 * c[0] + d[0]) / 8, (a[1] + 3 * b[1] + 3 * c[1] + d[1]) / 8];
            expect(insidePolygon(mid[0], mid[1], SILHOUETTE_POINTS) && depth(mid[0], mid[1], SILHOUETTE_POINTS) > 0.2, `${side} ${region.muscle} at ${mid}`).toBe(true);
          }
        }
      }
    }
  });

  it('finds the muscle under any point well inside it', () => {
    for (const side of SIDES) {
      for (const region of REGIONS[side]) {
        const inside = grid(1).filter(([x, y]) => insidePolygon(x, y, region.points) && depth(x, y, region.points) > 0.8);
        expect(inside.length, `${side} ${region.muscle}`).toBeGreaterThan(0);
        for (const [x, y] of inside) expect(regionAt(x, y, side, 0), `${side} ${region.muscle}`).toBe(region.muscle);
      }
    }
  });

  it('counts a near miss within reach and nothing far from every muscle', () => {
    // Just outside the side delt's outer edge, then past the hand and between the shins.
    const delt = REGIONS.front.find((region) => region.muscle === 'side_delts' && region.points[0][0] > 50)!;
    // Straight out from the delt's middle to past its edge.
    const y = delt.points.reduce((sum, [, py]) => sum + py, 0) / delt.points.length;
    let x = delt.points.reduce((sum, [px]) => sum + px, 0) / delt.points.length;
    while (insidePolygon(x, y, SILHOUETTE_POINTS)) x += 0.1;
    expect(regionAt(x + 2, y, 'front', 4)).toBe('side_delts');
    expect(regionAt(FIGURE.right + 2, 200, 'front', 4)).toBeNull();
    expect(regionAt(50, 178, 'front', 3)).toBeNull();
  });

  it('draws the side delt wide enough to read at the figure’s size', () => {
    for (const side of SIDES) {
      const delt = REGIONS[side].find((region) => region.muscle === 'side_delts')!;
      const xs = delt.points.map(([px]) => px);
      expect((Math.max(...xs) - Math.min(...xs)) * pointsPerUnit, side).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('is drawn at the height these checks assume', () => {
    const source = readFileSync(path.join(__dirname, '../native/src/components/MuscleFigure.tsx'), 'utf8');
    expect(source).toContain(`height = ${FIGURE_POINTS} }`);
  });

  it('gives the figure room across, an arm hanging clear of the body', () => {
    // Each figure at least 70 pt wide at Progress's height.
    expect((FIGURE.right - FIGURE.left) * pointsPerUnit).toBeGreaterThanOrEqual(70);
  });
});

const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
/** WCAG contrast between two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r, g, bl]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
  const [high, low] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
/** A Blanc palette's solid colours, read from the theme's text (it imports React Native). */
function palette(name: string): Record<string, string> {
  const theme = readFileSync(path.join(__dirname, '../native/src/theme/blanc.ts'), 'utf8');
  const body = theme.match(new RegExp(`\\n {2}${name}: \\{([\\s\\S]*?)\\n {2}\\}`))?.[1] ?? '';
  return Object.fromEntries([...body.matchAll(/(\w+): '(#[0-9A-F]{6})'/g)].map((match) => [match[1], match[2]]));
}

// In range is the palette's `mark` on the figure, the key and the rails' band;
// below range is outlined in the palette's ink.
describe('Progress\'s in-range tone', () => {
  for (const name of Object.keys(MUSCLE_TONES) as Array<keyof typeof MUSCLE_TONES>) {
    it(`draws the rail's band in the figure's in-range tone, at 3:1 against its track and the card (${name})`, () => {
      const tones = MUSCLE_TONES[name];
      const { mark, fill, label } = palette(name);
      expect(mark && fill && label, name).toBeTruthy();
      // The rail's track is `fill`: against `track` the band would fall short of 3:1.
      expect(contrast(mark, fill), name).toBeGreaterThanOrEqual(3);
      expect(contrast(mark, label), name).toBeGreaterThanOrEqual(3);
      // The best range, a deeper step of the same tone, stands out from the band and reads on the card.
      expect(contrast(tones.best, mark), name).toBeGreaterThanOrEqual(2);
      expect(contrast(tones.best, label), name).toBeGreaterThanOrEqual(3);
    });

    it(`outlines a muscle below range in ink, against the body and its own light fill (${name})`, () => {
      const tones = MUSCLE_TONES[name];
      const { ink, mark } = palette(name);
      expect(contrast(ink, tones.body), name).toBeGreaterThanOrEqual(4.5);
      expect(contrast(ink, tones.below), name).toBeGreaterThanOrEqual(4.5);
      // In range is clearly a fill, but quieter than the outline, so below range leads.
      expect(contrast(mark, tones.body), name).toBeGreaterThanOrEqual(3);
      expect(contrast(ink, tones.body), name).toBeGreaterThan(contrast(mark, tones.body));
    });
  }

  it('keeps in range a mid-tone on the dark cards, never the brightest thing on screen', () => {
    for (const name of ['dark', 'darkContrast'] as const) {
      // Quieter against the card than the dark palette's ink, the screen's own text.
      expect(contrast(palette(name).mark, palette(name).label), name).toBeLessThan(contrast(palette(name).ink, palette(name).label) / 2);
    }
  });

  it("edges the light body in graphite at about 30%, so it stands off the white card", () => {
    const { graphite, label } = palette('light');
    // Graphite laid over the card at 30%.
    const edge = rgb(graphite).map((value, i) => Math.round(0.3 * value + 0.7 * rgb(label)[i]));
    rgb(MUSCLE_TONES.light.contour).forEach((value, i) => expect(Math.abs(value - edge[i])).toBeLessThanOrEqual(3));
    expect(contrast(MUSCLE_TONES.light.contour, MUSCLE_TONES.light.body)).toBeGreaterThanOrEqual(1.4);
    // Quieter than below range's ink outline, so an outlined muscle never reads as the bare body.
    expect(contrast(palette('light').ink, MUSCLE_TONES.light.body)).toBeGreaterThan(2 * contrast(MUSCLE_TONES.light.contour, MUSCLE_TONES.light.body));
    const source = readFileSync(path.join(__dirname, '../native/src/components/MuscleFigure.tsx'), 'utf8');
    expect(source).toContain('const BODY_EDGE = 1;');
  });

  it('draws an untrained muscle as the body alone, with no fill or outline of its own', () => {
    const source = readFileSync(path.join(__dirname, '../native/src/components/MuscleFigure.tsx'), 'utf8');
    // Its fill and seams are left out, and only below range is outlined.
    expect(source.match(/bare\(region\.muscle\) \? null/g)?.length).toBe(2);
    expect(source).toContain("if (stateOf(shades.get(muscle)) !== 'below') return null;");
  });

  it("keeps the body's edge readable on the dark cards", () => {
    for (const name of ['dark', 'darkContrast'] as const) {
      expect(contrast(MUSCLE_TONES[name].contour, palette(name).label), name).toBeGreaterThanOrEqual(2.2);
    }
  });
});
