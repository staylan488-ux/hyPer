import type { MuscleGroup, MuscleVolume } from '@/types';

/**
 * The volume maquette: a sculptor's mannequin whose muscle regions are shaded
 * by this week's training volume. One source of truth for the 3D scene and
 * the flat 2D fallback. Units are arbitrary (figure ≈ 3.3 tall), y up, the
 * figure faces +z. Pure data and maths — no three.js here.
 */

export type Vec3 = [number, number, number];

export interface Ellipsoid {
  kind: 'ellipsoid';
  center: Vec3;
  radii: Vec3;
  /** Roll around the view axis (z), radians. */
  roll?: number;
}

export interface Capsule {
  kind: 'capsule';
  from: Vec3;
  to: Vec3;
  radius: number;
}

/**
 * A turned form (like a mannequin torso): `profile` is [radius, y] from the
 * bottom up, revolved around the y axis, then flattened front-to-back.
 */
export interface Lathe {
  kind: 'lathe';
  profile: Array<[number, number]>;
  /** Depth relative to width (z scale). */
  depth: number;
}

export type Solid = Ellipsoid | Capsule | Lathe;

export interface MusclePart {
  muscle: MuscleGroup;
  solid: Ellipsoid;
}

const e = (center: Vec3, radii: Vec3, roll?: number): Ellipsoid => ({ kind: 'ellipsoid', center, radii, roll });
const c = (from: Vec3, to: Vec3, radius: number): Capsule => ({ kind: 'capsule', from, to, radius });

/** Mirror a solid across the body's midline. */
function mirror<T extends Solid>(solid: T): T {
  if (solid.kind === 'lathe') return solid;
  if (solid.kind === 'ellipsoid') {
    const [x, y, z] = solid.center;
    return { ...solid, center: [-x, y, z], roll: solid.roll ? -solid.roll : undefined } as T;
  }
  return { ...solid, from: [-solid.from[0], solid.from[1], solid.from[2]], to: [-solid.to[0], solid.to[1], solid.to[2]] } as T;
}

const pair = <T extends Solid>(solid: T): T[] => [solid, mirror(solid)];

/** The unshaded mannequin: head, torso, joints and limbs. */
export const BODY_SOLIDS: Solid[] = [
  e([0, 1.53, 0.01], [0.17, 0.215, 0.19]),
  c([0, 1.24, -0.01], [0, 1.36, 0], 0.075),
  {
    kind: 'lathe',
    depth: 0.56,
    profile: [
      [0.001, 0.0], [0.17, 0.02], [0.28, 0.08], [0.32, 0.18], [0.315, 0.3],
      [0.28, 0.44], [0.265, 0.54], [0.285, 0.66], [0.335, 0.8], [0.37, 0.94],
      [0.38, 1.05], [0.35, 1.14], [0.26, 1.21], [0.12, 1.25], [0.001, 1.26],
    ],
  },
  ...pair(e([0.43, 1.1, 0], [0.105, 0.1, 0.1])),
  ...pair(c([0.48, 1.04, 0], [0.56, 0.6, 0], 0.08)),
  ...pair(e([0.565, 0.56, 0], [0.068, 0.068, 0.068])),
  ...pair(c([0.57, 0.52, 0.02], [0.6, 0.14, 0.07], 0.066)),
  ...pair(e([0.605, 0.02, 0.08], [0.048, 0.1, 0.034])),
  ...pair(e([0.175, 0.08, 0], [0.11, 0.1, 0.11])),
  ...pair(c([0.185, 0.02, 0], [0.2, -0.72, 0], 0.115)),
  ...pair(e([0.2, -0.765, 0.01], [0.086, 0.086, 0.086])),
  ...pair(c([0.2, -0.82, 0], [0.2, -1.44, -0.01], 0.08)),
  ...pair(e([0.2, -1.55, 0.06], [0.068, 0.05, 0.14])),
];

/** Muscle regions, sculpted slightly proud of the mannequin. */
export const MUSCLE_PARTS: MusclePart[] = [
  ...pair(e([0.165, 1.0, 0.155], [0.155, 0.115, 0.085], -0.12)).map((solid) => ({ muscle: 'chest' as const, solid })),
  { muscle: 'core', solid: e([0, 0.56, 0.12], [0.165, 0.24, 0.075]) },
  { muscle: 'traps', solid: e([0, 1.19, -0.08], [0.25, 0.1, 0.1]) },
  ...pair(e([0.2, 0.84, -0.13], [0.15, 0.27, 0.085], 0.18)).map((solid) => ({ muscle: 'back' as const, solid })),
  ...pair(e([0.435, 1.1, 0.065], [0.075, 0.105, 0.06])).map((solid) => ({ muscle: 'front_delts' as const, solid })),
  ...pair(e([0.505, 1.085, 0], [0.058, 0.105, 0.078])).map((solid) => ({ muscle: 'side_delts' as const, solid })),
  ...pair(e([0.435, 1.1, -0.065], [0.075, 0.105, 0.06])).map((solid) => ({ muscle: 'rear_delts' as const, solid })),
  ...pair(e([0.53, 0.83, 0.055], [0.062, 0.16, 0.058], 0.17)).map((solid) => ({ muscle: 'biceps' as const, solid })),
  ...pair(e([0.52, 0.85, -0.055], [0.064, 0.17, 0.058], 0.17)).map((solid) => ({ muscle: 'triceps' as const, solid })),
  ...pair(e([0.125, 0.15, -0.14], [0.135, 0.135, 0.085])).map((solid) => ({ muscle: 'glutes' as const, solid })),
  ...pair(e([0.195, -0.33, 0.075], [0.1, 0.3, 0.068])).map((solid) => ({ muscle: 'quads' as const, solid })),
  ...pair(e([0.195, -0.35, -0.075], [0.098, 0.28, 0.066])).map((solid) => ({ muscle: 'hamstrings' as const, solid })),
  ...pair(e([0.2, -1.05, -0.055], [0.066, 0.17, 0.058])).map((solid) => ({ muscle: 'calves' as const, solid })),
];

// ═══════════════════════════════════
// SHADING
// ═══════════════════════════════════

/** Ink share per volume status — the same ramp as --color-volume-* tokens. */
const STATUS_INK: Record<MuscleVolume['status'], number> = {
  below_mev: 0.2,
  mev_mav: 0.4,
  mav: 0.62,
  approaching_mrv: 0.84,
  above_mrv: 0.84,
};

export interface MuscleShade {
  muscle: MuscleGroup;
  /** 0 = bare porcelain, 1 = full ink. */
  ink: number;
  /** Past recoverable volume: shown in lacquer. */
  hot: boolean;
  sets: number;
  status: MuscleVolume['status'] | null;
}

const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/**
 * Shade for every rendered muscle. General "shoulders" volume stands in for
 * any deltoid head without its own entry; muscles not trained this week stay
 * bare.
 */
export function shadeMuscles(volume: MuscleVolume[]): Map<MuscleGroup, MuscleShade> {
  const byMuscle = new Map(volume.map((entry) => [entry.muscle_group, entry]));
  const shades = new Map<MuscleGroup, MuscleShade>();
  const rendered = new Set(MUSCLE_PARTS.map((part) => part.muscle));
  for (const muscle of rendered) {
    const entry = byMuscle.get(muscle) ?? (DELTS.includes(muscle) ? byMuscle.get('shoulders') : undefined);
    const trained = entry && entry.weekly_sets > 0;
    shades.set(muscle, {
      muscle,
      ink: trained ? STATUS_INK[entry.status] : 0,
      hot: Boolean(trained && entry.status === 'above_mrv'),
      sets: entry?.weekly_sets ?? 0,
      status: entry?.status ?? null,
    });
  }
  return shades;
}

// ═══════════════════════════════════
// COLOUR
// ═══════════════════════════════════

export type Rgb = [number, number, number];

export function parseColor(input: string, fallback: Rgb): Rgb {
  const value = input.trim();
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return fallback;
}

export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

export function rgbToCss([r, g, b]: Rgb): string {
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

export interface MaquettePalette {
  /** Bare figure: porcelain in Ivory, obsidian in Black. */
  body: Rgb;
  ink: Rgb;
  accent: Rgb;
}

export function muscleColor(shade: MuscleShade | undefined, palette: MaquettePalette): Rgb {
  if (!shade || shade.ink === 0) return palette.body;
  if (shade.hot) return palette.accent;
  return mixRgb(palette.body, palette.ink, shade.ink);
}

// ═══════════════════════════════════
// 2D PROJECTION (fallback)
// ═══════════════════════════════════

export type ViewSide = 'front' | 'back';

/** Whether a solid faces the viewer from a side (midline solids show on both). */
export function visibleFrom(solid: Solid, side: ViewSide): boolean {
  if (solid.kind === 'lathe') return true;
  const z = solid.kind === 'ellipsoid' ? solid.center[2] : (solid.from[2] + solid.to[2]) / 2;
  if (Math.abs(z) < 0.03) return true;
  return side === 'front' ? z > 0 : z < 0;
}

/** x as seen from a side: the back view is mirrored (the figure's left is on the right). */
export function projectX(x: number, side: ViewSide): number {
  return side === 'front' ? x : -x;
}

/** Outline of a lathe seen from the front or back, as an SVG path. */
export function latheOutline(solid: Lathe): string {
  const right = solid.profile.map(([r, y]) => `${r.toFixed(3)},${(-y).toFixed(3)}`);
  const left = [...solid.profile].reverse().map(([r, y]) => `${(-r).toFixed(3)},${(-y).toFixed(3)}`);
  return `M${right.join('L')}L${left.join('L')}Z`;
}
