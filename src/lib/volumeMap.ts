import type { MuscleGroup, MuscleVolume } from '@/types';

/**
 * The volume map: a flat front/back figure whose muscle regions are toned by
 * this week's training volume. Pure data — the drawing lives in `VolumeMap`.
 *
 * Coordinates describe the figure's right half (x ≥ 0) in a 100 × 220 box
 * centred on x = 0; every part is mirrored across the midline. Regions on the
 * midline start at x = 0 and neighbouring regions share their edges, so the
 * drawing's one seam (a gap in the page colour) is the only line anywhere:
 * at the sternum, between muscles and around each muscle. Every region keeps
 * about a unit of body tone inside the silhouette's contour, so its seam
 * never cuts the contour.
 */

export type ViewSide = 'front' | 'back';

/** Unshaded body: head, torso, limbs. Same silhouette front and back. */
export const BODY_PATHS: string[] = [
  // Head
  'M0,1.5 C6,1.5 9.6,6 9.6,12.6 C9.6,19 6.4,24.4 0,25 Z',
  // Neck
  'M0,21 L5.6,21 C5.8,25 6.4,28.4 7.4,30.6 L0,31 Z',
  // Torso: trapezius slope, shoulder, flank, waist, hip
  'M0,28 L6.8,28 C7.4,32 9,34.6 12,35.8 C17.4,37.4 23.6,38 28.2,39.8 C32.4,41.6 34,46.6 31.4,52.4 L26,60 C25.2,73 21.8,87 20.8,97 C20.8,105 22.8,111 24.2,118 L24.6,126 L0,129 Z',
  // Upper arm
  'M25.2,46 C26,41.4 34.4,40.4 37,46 C39.4,55.6 40.6,69.6 40.8,81.4 C40.9,88.6 39.4,93 37,95.2 L30.8,95.2 C29.2,89 28.2,82 27.4,74 C26.4,64 25.4,55 25.2,46 Z',
  // Forearm: full under the elbow, tapering to the wrist
  'M30.6,93 L40.4,93 C43.4,99 44.6,107 44.4,115 C44.2,122 43.2,128.6 42.2,134 L37.4,134 C35.4,126 32.8,116 31.4,106 C30.9,101 30.6,97 30.6,93 Z',
  // Hand
  'M37.2,133 L42.4,133 C44.6,137 44.8,143 43,147.6 C41.4,150.6 38.4,150 37.8,146.6 C36.8,141.8 36.6,137.2 37.2,133 Z',
  // Leg: thigh, knee, a full calf, ankle, foot
  'M0,124 L24.6,119 C27,129 26.8,143 24.4,157 C23.4,163 21.8,168 21,172.6 C23.2,179 23.6,188 22,197 C21,203 19.6,207.6 19,211 L19.8,215 C19,217.4 14.2,218 9.4,217 L10.2,211 C9.4,205 7.6,197 6.8,189 C6.2,182 6.4,176 7.4,170 C5.2,160 3.4,146 2.2,134 L0,131 Z',
];

export interface MapRegion {
  muscle: MuscleGroup;
  side: ViewSide;
  d: string;
}

// Deltoid cap, split into its inner head (front or rear) and the side head;
// the inner head's edge is the chest's (front) or the traps' (back).
const DELT_INNER = 'M24.2,41.4 C26.6,40 28.8,39.6 30.6,39.8 C31.8,46 32.2,53.6 32,60.6 C30.2,61.2 28.8,60.6 28,59.2 C27.4,52.6 26.2,46.6 24.2,41.4 Z';
const DELT_OUTER = 'M30.6,39.8 C33.6,40.4 35.8,42.6 36.4,46.4 C37.2,51.4 36.2,56.4 33.6,60.4 L32,60.6 C32.2,53.6 31.8,46 30.6,39.8 Z';

const front = (muscle: MuscleGroup, ...paths: string[]): MapRegion[] => paths.map((d) => ({ muscle, side: 'front', d }));
const back = (muscle: MuscleGroup, ...paths: string[]): MapRegion[] => paths.map((d) => ({ muscle, side: 'back', d }));

/** Muscle regions for each view, drawn over the body in this order. */
export const MAP_REGIONS: MapRegion[] = [
  // ── Front ──
  ...front('traps', 'M8.2,32 C10.2,34.6 14.6,36.2 22.4,37.8 C16.4,38.8 12,38.6 9.4,37.2 C8.6,35.8 8.2,34 8.2,32 Z'),
  ...front('chest', 'M0,41 C8,39.4 17.4,39.6 24.2,41.4 C26.2,46.6 27.4,52.6 28,59.2 C23.4,62.8 16,65 9.4,64.6 C4.8,64.2 1.6,62.8 0,61.2 Z'),
  ...front('front_delts', DELT_INNER),
  ...front('side_delts', DELT_OUTER),
  ...front('biceps', 'M28.6,62.6 C30.6,59.6 35,59.8 37,63.4 C38.9,70.4 39.2,80 37.6,87.4 C36,90.8 32.4,90.8 31.4,87.6 C29.8,80.4 28.8,71.4 28.6,62.6 Z'),
  ...front(
    'core',
    // Rectus abdominis: three rows and the lower belly, sharing their edges
    'M0,66.8 L10.2,66.2 C11.2,66.2 11.8,66.8 11.8,67.8 L11.8,78.4 L0,78.8 Z',
    'M0,78.8 L11.8,78.4 L11.8,90.6 L0,90.8 Z',
    'M0,90.8 L11.8,90.6 L11.4,102.8 L0,103 Z',
    'M0,103 L11.4,102.8 C11.2,110 8.6,116.6 4.2,120.4 L0,121.6 Z',
    // External oblique, along the abdominis edge
    'M11.8,67.8 C17,66.4 22,68.4 24.6,72 C23.6,80 21.6,90 20.4,97.6 C19.6,103.6 18.2,108.4 15.8,111.2 C13.8,113 11.4,111.6 10.8,108.6 C11.2,106.6 11.4,104.6 11.4,102.8 L11.8,90.6 Z',
  ),
  ...front(
    'quads',
    'M3.4,133.6 C9.6,127.4 17.4,123.2 23.6,122.4 C25.6,132 25.4,145 22.8,157.6 C21.8,163 19.2,167.4 15.8,168.4 C12.6,168.8 10.2,167 8.8,164 C5.8,154.8 4,144.2 3.4,133.6 Z',
  ),
  ...front(
    'calves',
    // Both heads show either side of the shin, which stays body
    'M8.2,173.4 C11.6,174.2 13.4,179.4 13.2,186.6 C13,193 11.6,198.4 9.8,201 C8.4,197 7.8,191.6 7.8,186.2 C7.8,181.4 7.9,177 8.2,173.4 Z',
    'M20.2,174.4 C22,179.4 22.4,186 21.6,192.4 C21,196.6 19.6,199.8 17.6,201 C16.2,196 15.8,189 16.4,182.6 C16.8,179 18.2,176 20.2,174.4 Z',
  ),

  // ── Back ──
  ...back(
    'traps',
    // Its lower edge ends on the rear delt's corner, never crossing the cap.
    'M0,29.2 L6.8,29.2 C7.4,32.6 9.2,35.2 12.4,36.6 C18.2,38.6 22,39.6 24.2,41.4 C19.6,45 15.2,50.6 11.2,57.4 C7.2,63.8 3.4,71 0,78.6 Z',
  ),
  ...back('rear_delts', DELT_INNER),
  ...back('side_delts', DELT_OUTER),
  ...back(
    'back',
    // Over the shoulder blade, between the traps' edge and the rear delt's
    // (its lower edge meets the delt's in a T, at (27.57, 55.31))
    'M11.2,57.4 C15.2,50.6 19.6,45 24.2,41.4 C25.8,45.56 26.89,50.23 27.57,55.31 C22.6,60.4 16,60.6 11.2,57.4 Z',
    // Latissimus: from the traps' tip and the shoulder blade, tapering along
    // the flank to the waist; the spine between the two stays body. Its top
    // follows the delt's edge to the delt's corner, where the flank starts.
    'M0,78.6 C3.4,71 7.2,63.8 11.2,57.4 C16,60.6 22.6,60.4 27.57,55.31 C27.74,56.58 27.88,57.88 28,59.2 L27.2,62.4 C24.8,73 22.4,85 20.4,94 C15.6,98.8 9.4,101.4 3.6,102.2 C2.2,94 1,86 0,78.6 Z',
  ),
  // Its top is the delt's lower edge (from a T on it), no arc of its own.
  ...back('triceps', 'M28.71,60.09 C29.53,60.83 30.65,61.05 32,60.6 L33.6,60.4 C35,59.4 36,59 36.6,59.2 C38.8,65.6 39.8,75.4 39,84.6 C37.6,88.6 34.6,89.2 33.2,86.8 C31,80 29.4,70.8 28.71,60.09 Z'),
  ...back('glutes', 'M0,112.4 C7,107.8 16.6,107.6 22.8,111.4 C25.4,117.6 25.8,125.6 24,131.8 C19.4,136.6 11.2,137.8 4.6,135.4 C1.8,133.2 0.4,130 0,127 Z'),
  ...back(
    'hamstrings',
    // One tapering muscle under the glute fold, ending in a single curve
    'M4.6,135.4 C11.2,137.8 19.4,136.6 24,131.8 C25.4,142 24.6,154 22,163.6 C20.8,167.8 17.6,169.6 14,169.4 C10.2,169.2 7.8,166.6 6.8,162.2 C5.4,154 4.6,145 4.6,135.4 Z',
  ),
  ...back(
    'calves',
    // Gastrocnemius: two full heads sharing their upper edge
    'M14.6,172.8 C19,172 21.8,176.2 22.2,183.4 C22.6,190.6 21.2,197.4 18,202.6 C15.8,200.4 14.8,193 14.6,185.4 Z',
    'M14.6,172.8 L14.6,185.4 C14.6,192.6 14,198.4 12.8,202.6 C9.6,200.4 7.8,193.8 7.8,187 C7.8,181 8.6,176.8 10.6,174.4 C11.8,173.4 13.2,172.8 14.6,172.8 Z',
  ),
];

/** The view a muscle is mainly read from (deltoid sides show on both). */
export function primarySide(muscle: MuscleGroup): ViewSide {
  const sides = new Set(MAP_REGIONS.filter((region) => isSubjectMuscle(region.muscle, muscle)).map((region) => region.side));
  return sides.has('front') ? 'front' : 'back';
}

// ═══════════════════════════════════
// SHADING
// ═══════════════════════════════════

/** Ink share per volume status, lightest (under MEV) to heaviest (near MRV).
 * The first in-range step sits at least 2:1 from the under tone in both
 * themes, so a muscle in range never reads as one more under it. */
export const STATUS_INK: Record<MuscleVolume['status'], number> = {
  below_mev: 0.26,
  mev_mav: 0.56,
  mav: 0.72,
  approaching_mrv: 0.9,
  above_mrv: 0.9,
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
 * their seams. (VolumeMap draws it as the theme's --map-body, which lifts
 * the silhouette in dark mode so its contour never sinks into the black.) */
export const BODY_INK = 0.1;

/** Fill for a muscle as a CSS colour built from the theme tokens. */
export function muscleFill(shade: MuscleShade | undefined): string {
  if (shade?.hot) return 'var(--color-accent)';
  const ink = shade && shade.ink > 0 ? shade.ink : BODY_INK;
  return inkFill(ink);
}

/** Whether a drawn muscle belongs to the subject of a sentence; general
 * "shoulders" covers every deltoid head. */
export function isSubjectMuscle(muscle: MuscleGroup, subject: MuscleGroup | null): boolean {
  if (!subject) return false;
  return muscle === subject || (subject === 'shoulders' && DELTS.includes(muscle));
}

/**
 * A figure that illustrates one sentence (Today's insight) speaks the
 * Progress legend: the muscle the sentence is about keeps its own legend
 * style (the under tone below MEV, its status ink otherwise, lacquer only past
 * recoverable volume), and every other muscle stays at the silhouette's own
 * tone, so no other muscle competes with the story.
 */
export function subjectFill(shade: MuscleShade | undefined, isSubject: boolean): string {
  if (!isSubject || isSubjectUnder(shade)) return inkFill(BODY_INK);
  return muscleFill(shade);
}

/** The sentence's muscle is under MEV (trained or not): the under tone, the
 * legend's "Under", never a fill that reads as more sets. */
export function isSubjectUnder(shade: MuscleShade | undefined): boolean {
  return Boolean(shade && shade.status === 'below_mev');
}

/** Trained this week but below MEV: the quietest mark, the ramp's lowest tone. */
export function isUnderStimulated(shade: MuscleShade | undefined): boolean {
  return Boolean(shade && shade.sets > 0 && shade.status === 'below_mev');
}

export function inkFill(ink: number): string {
  return `color-mix(in srgb, var(--color-text) ${Math.round(ink * 1000) / 10}%, var(--color-base))`;
}

/** A status ink as the figure draws it: Black takes it a step toward the page
 * (`--map-ink-drop`) so trained muscles stay tones, not stickers. The legend
 * and the row chips use the same tone. */
export function mapInk(fill: string): string {
  return `color-mix(in srgb, ${fill}, var(--color-base) var(--map-ink-drop, 0%))`;
}

/** The figure's own tone for a trained muscle in range (its row chip's mark). */
export function inRangeTone(status: MuscleVolume['status']): string {
  return mapInk(inkFill(STATUS_INK[status]));
}
