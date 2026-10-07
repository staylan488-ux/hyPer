import type { MuscleGroup, MuscleVolume } from '@/types';

/**
 * The volume map: a flat, engraved front/back figure whose muscle regions are
 * toned by this week's training volume. Pure data — the drawing lives in
 * `VolumeMap`.
 *
 * Coordinates describe the figure's right half (x ≥ 0) in a 100 × 220 box
 * centred on x = 0; every part is mirrored across the midline, which leaves a
 * hairline at the sternum, the linea alba and the spine.
 */

export type ViewSide = 'front' | 'back';

/** Unshaded body: head, torso, limbs. Same silhouette front and back. */
export const BODY_PATHS: string[] = [
  // Head
  'M0,1.4 C5.8,1.4 9.4,5.8 9.4,12.4 C9.4,18.6 6.2,24.2 0,24.8 Z',
  // Neck
  'M0,21 L5.4,21 C5.6,25 6,28.6 6.8,31 L0,31 Z',
  // Torso: trapezius slope, shoulder, flank, waist, hip
  'M0,28 L6.6,28 C7,32 8.6,34.6 11.5,35.8 C17,37.6 23.4,38.2 28,40 C32,41.8 33.4,46.6 31,52 L25.6,60 C24.8,73 21.4,87 20.4,97 C20.4,105 22.6,111 24,118 L24.4,126 L0,129 Z',
  // Upper arm
  'M25,46 C26,41.6 34,40.6 36.4,46.2 C38.6,56 39.6,70 40,82 C40.2,89 38.8,93.4 36.4,95.4 L31,95.4 C29.4,89 28.6,82 27.6,74 C26.6,64 25.4,55 25,46 Z',
  // Forearm
  'M31,93 L39,93 C42.6,103 43.6,114 43,124 C42.6,129 41.6,132 41,134 L37.4,134 C35.6,124 32.6,112 31.2,103 Z',
  // Hand
  'M37.4,133 L41.2,133 C43.4,137 43.6,143 41.8,147.6 C40.2,150.4 37.6,149.6 37.2,146.4 C36.4,141.6 36.4,137 37.4,133 Z',
  // Leg: thigh, knee, calf, foot
  'M0,124 L24.4,119 C26.8,129 26.6,143 24,157 C22.8,164 21,169 20,173 C21.8,181 22.2,191 20.2,201 C19.2,205.6 18.6,208.6 18.6,211 L19.4,215 C18.6,217.4 14,218 9.4,217 L10.2,211 C9.6,205 8.2,196 7.6,188 C7.1,181 7.1,175 7.6,170 C5.4,160 3.4,146 2.2,134 L0,131 Z',
];

export interface MapRegion {
  muscle: MuscleGroup;
  side: ViewSide;
  d: string;
}

// Deltoid cap, split into its inner head (front or rear) and the side head.
const DELT_INNER = 'M23.6,41 C26,39.8 28.2,39.4 30.2,39.6 C31.4,46 31.8,54 31.6,61.6 C30,62 28.6,61 28,59.4 C26.2,53.4 24.8,47 23.6,41 Z';
const DELT_OUTER = 'M30.2,39.6 C33.4,40.2 35.8,42.4 36.6,46 C37.6,51 36.6,56.6 33.6,61.4 L31.6,61.6 C31.8,54 31.4,46 30.2,39.6 Z';

const front = (muscle: MuscleGroup, ...paths: string[]): MapRegion[] => paths.map((d) => ({ muscle, side: 'front', d }));
const back = (muscle: MuscleGroup, ...paths: string[]): MapRegion[] => paths.map((d) => ({ muscle, side: 'back', d }));

/** Muscle regions for each view, drawn over the body in this order. */
export const MAP_REGIONS: MapRegion[] = [
  // ── Front ──
  ...front('traps', 'M8,33.6 C10.6,35.8 16,37.2 24.6,38.8 C18.4,39.8 12.4,39.6 9,37.8 C8.2,36.6 8,35 8,33.6 Z'),
  ...front('chest', 'M1,41.6 C8,39.6 17,39.8 22.8,41.8 C24.8,47 26,53 26.4,58.4 C22,62.4 15,65 9,64.6 C5,64.2 2.2,62.6 1,60.4 Z'),
  ...front('front_delts', DELT_INNER),
  ...front('side_delts', DELT_OUTER),
  ...front('biceps', 'M28.2,62 C30,58.6 34.4,58.8 36.2,62.8 C38.2,70 38.4,80 36.6,87.6 C34.8,90.6 31.6,90.4 30.6,87.2 C29,80 28.2,71 28.2,62 Z'),
  ...front(
    'core',
    // Rectus abdominis, three rows and the lower belly
    'M1,67 L9.6,66.4 C10.8,66.3 11.4,67 11.4,68 L11.4,77.6 L1,78.2 Z',
    'M1,80.4 L11.4,79.8 L11.4,90.6 L1,91 Z',
    'M1,93.2 L11.2,92.8 L11,103.4 L1,103.6 Z',
    'M1,105.8 L10.8,105.6 C10.6,111.6 8,117.4 4,120.6 L1,121.6 Z',
    // Obliques
    'M14,66.6 C18,66.4 22,68.4 24.4,72 C23.4,80 21.6,90 20.6,97.6 C19.8,103.6 18.4,107.8 16.4,110 C14.8,100 13.6,84 14,66.6 Z',
  ),
  ...front(
    'quads',
    'M5,129.4 C10,125 18,121.6 23.4,121.4 C25.4,131 25.2,144 22.6,157.6 C21.6,162.8 19.2,166.8 16.2,167.8 C13.4,168.2 11.2,166.6 10,164 C7,153 5.4,141 5,129.4 Z',
  ),
  ...front('calves', 'M17.6,176.6 C20.4,181 21.2,188.6 19.8,196.8 C18.8,199.4 17.2,198.8 16.8,195.6 C16.2,189.6 16.4,182.6 17.6,176.6 Z'),

  // ── Back ──
  ...back(
    'traps',
    'M1,28.6 L6.4,28.6 C7,32.4 8.8,35.2 12,36.6 C18,38.6 24,39.4 28.4,41 C22,44.4 15.4,50.4 10.6,58 C6.6,64.6 3.4,71.6 1,78.6 Z',
  ),
  ...back('rear_delts', DELT_INNER),
  ...back('side_delts', DELT_OUTER),
  ...back(
    'back',
    // Infraspinatus and teres
    'M12.6,59.4 C16.4,51.4 21.2,46.2 25.6,44.4 C27.4,49 28,55 26.8,60.6 C22,62 17,61.8 12.6,59.4 Z',
    // Latissimus
    'M3.4,79.6 C6,72 9,66.4 11.6,62.6 C17,64.6 22.6,64.4 26.6,63 C26,72 23.8,84 21,94 C17,99 11.4,102 6.4,103.2 C4.6,95 3.6,87 3.4,79.6 Z',
  ),
  ...back('triceps', 'M28.4,61.4 C29.8,56.4 33.6,55.6 36.2,58.4 C38.6,65 39.6,75 38.8,84.6 C37.4,88.4 34.6,89 33.2,86.8 C31,80 29.4,70 28.4,61.4 Z'),
  ...back('glutes', 'M1,114 C7,108.6 16,108.2 22.2,112 C25,118 25.6,126 23.6,132.4 C19,137 11,138 5,135.4 C2.4,132.4 1,126.4 1,120 Z'),
  ...back(
    'hamstrings',
    'M5.4,140.6 C10.4,139.4 17.6,138.6 23.4,137 C24.4,146 23.4,156 21.2,164 C20,167.6 17.6,168.6 15.4,167 L14.2,160.6 C13.2,165.4 11.4,168 9.2,167 C7,163.6 5.6,155 5.4,140.6 Z',
  ),
  ...back(
    'calves',
    'M14.4,174.2 C17.8,173.4 20.4,176.2 21.2,182.4 C21.6,190 20.2,196 17.4,200.4 C15.4,198.4 14.2,192.4 14,186 C13.9,181.4 14,177.4 14.4,174.2 Z',
    'M8.2,175.4 C10.6,173.8 12.6,174.2 13,176.4 C13.2,184 12.6,192 11.2,198.4 C8.8,196.6 7.4,190.4 7.4,184.4 C7.4,180.6 7.6,177.6 8.2,175.4 Z',
  ),
];

/** The view a muscle is mainly read from (deltoid sides show on both). */
export function primarySide(muscle: MuscleGroup): ViewSide {
  const sides = new Set(MAP_REGIONS.filter((region) => region.muscle === muscle).map((region) => region.side));
  return sides.has('front') ? 'front' : 'back';
}

// ═══════════════════════════════════
// SHADING
// ═══════════════════════════════════

/** Ink share per volume status, lightest (under MEV) to heaviest (near MRV). */
export const STATUS_INK: Record<MuscleVolume['status'], number> = {
  below_mev: 0.26,
  mev_mav: 0.44,
  mav: 0.64,
  approaching_mrv: 0.86,
  above_mrv: 0.86,
};

export interface MuscleShade {
  muscle: MuscleGroup;
  /** 0 = untrained, 1 = full ink. */
  ink: number;
  /** Past recoverable volume: shown in lacquer. */
  hot: boolean;
  sets: number;
  status: MuscleVolume['status'] | null;
}

const DELTS: MuscleGroup[] = ['front_delts', 'side_delts', 'rear_delts'];

/**
 * Shade for every drawn muscle. General "shoulders" volume stands in for any
 * deltoid head without its own entry; muscles not trained this week stay bare.
 */
export function shadeMuscles(volume: MuscleVolume[]): Map<MuscleGroup, MuscleShade> {
  const byMuscle = new Map(volume.map((entry) => [entry.muscle_group, entry]));
  const shades = new Map<MuscleGroup, MuscleShade>();
  const drawn = new Set(MAP_REGIONS.map((region) => region.muscle));
  for (const muscle of drawn) {
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

/** Ink share for the body; untrained muscles stay this tone and read only by
 * their engraved seams. */
export const BODY_INK = 0.1;

/** Fill for a muscle as a CSS colour built from the theme tokens. */
export function muscleFill(shade: MuscleShade | undefined): string {
  if (shade?.hot) return 'var(--color-accent)';
  const ink = shade && shade.ink > 0 ? shade.ink : BODY_INK;
  return inkFill(ink);
}

export function inkFill(ink: number): string {
  return `color-mix(in srgb, var(--color-text) ${Math.round(ink * 1000) / 10}%, var(--color-base))`;
}
