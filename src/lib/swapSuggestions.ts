/**
 * The closest matches for a movement being swapped out: which movements
 * train the same muscles the same way, best first, each with one line saying
 * what stays the same and what changes.
 *
 * A match is judged on three things, in this order of weight:
 *   1. the muscle parts it shares with the movement it replaces,
 *   2. how near the movement pattern is (a hack squat is a squat; a leg press
 *      is close; a leg extension is not),
 *   3. whether it keeps the muscle loaded at long length where the original
 *      did.
 * Equipment never lowers a match: machines and free weights build the same
 * muscle (Haugen 2023). It only spreads the list, because the usual reason
 * for a swap is the equipment itself, and the app cannot know which.
 *
 * The parts, patterns and lengths are in src/lib/movementProfiles.ts; what
 * they rest on is in docs/movement-swaps.md.
 */
import { exerciseCategory } from '@/lib/exerciseSearch';
import {
  MUSCLE_PART_WORDS,
  movementProfile,
  patternNearness,
  type EquipmentKind,
  type MovementPattern,
  type MovementProfile,
  type MusclePart,
} from '@/lib/movementProfiles';
import type { Exercise } from '@/types';

export interface SwapMatch<T extends Exercise = Exercise> {
  exercise: T;
  /** What stays the same and what changes, e.g. "Same movement · machine, easier on the lower back". */
  line: string;
  /** 0 to about 1; for ordering and tests, never shown. */
  score: number;
}

/** One finding that bears on this swap, with the study it comes from. */
export interface SwapNote {
  /** The finding, with no full stop at the end. */
  text: string;
  /** Author and year, shown after the text. */
  source: string;
}

export interface SwapSuggestions<T extends Exercise = Exercise> {
  matches: SwapMatch<T>[];
  note: SwapNote | null;
}

const NONE: SwapSuggestions<never> = { matches: [], note: null };

/** How many matches the swap screen leads with. */
export const SWAP_MATCH_LIMIT = 5;

// A match shares at least half of what the original trains.
const MIN_COVERAGE = 0.5;
// Under this, a movement is offered only when nothing better exists.
const CLOSE_SCORE = 0.6;
// When nothing is close, the nearest few are still named, with what they miss.
const FALLBACK_LIMIT = 3;

const WEIGHT = { muscles: 0.6, pattern: 0.3, length: 0.1 } as const;
// A longer muscle length than the original is, if anything, a gain: this
// much for the full step from short to long.
const LONGER_BONUS = 0.06;
const HARD_TO_LOAD_PENALTY = 0.15;
const RARE_PENALTY = 0.05;
// Two sides at once is the nearer stand-in for a movement done that way.
const ONE_SIDE_PENALTY = 0.03;
// Spreading the list: each match already picked on the same equipment counts
// a little against the next pick.
const SAME_EQUIPMENT_PICKED = 0.05;

/** Ties go to the more stable setup, where the target muscle is the limit. */
const EQUIPMENT_ORDER: EquipmentKind[] = ['machine', 'smith', 'cable', 'barbell', 'dumbbell', 'kettlebell', 'bodyweight', 'other'];

const EQUIPMENT_WORDS: Record<EquipmentKind, string | null> = {
  machine: 'machine',
  smith: 'Smith machine',
  cable: 'cable',
  barbell: 'barbell',
  dumbbell: 'dumbbells',
  kettlebell: 'kettlebell',
  bodyweight: 'bodyweight',
  other: null,
};

/**
 * Findings worth one line on the swap screen. Each is a result of the study
 * named, in plain words; docs/movement-swaps.md has the full references.
 */
export const SWAP_NOTES = {
  machines: { text: 'Machines and free weights build muscle equally well', source: 'Haugen 2023' },
  legCurl: { text: 'Seated leg curls grew the hamstrings more than lying ones', source: 'Maeo 2021' },
  triceps: { text: 'Overhead extensions grew the triceps more than pushdowns', source: 'Maeo 2023' },
  calves: { text: 'Standing calf raises grew the calves more than seated ones', source: 'Kinoshita 2023' },
  kneeExtension: {
    text: 'Squats grow three of the four quad muscles. The fourth, the rectus femoris, grows from leg extensions',
    source: 'Kubo 2019',
  },
  incline: { text: 'The incline press grew the upper chest more than the flat press', source: 'Chaves 2020' },
  lateralRaise: { text: 'Cable and dumbbell lateral raises grew the side delts equally', source: 'Larsen 2025' },
} as const satisfies Record<string, SwapNote>;

/** The note as one sentence with its study: "… equally well (Haugen 2023)." */
export function swapNoteLine(note: SwapNote): string {
  return `${note.text} (${note.source}).`;
}

const PATTERN_NOTES: Partial<Record<MovementPattern, SwapNote>> = {
  leg_curl: SWAP_NOTES.legCurl,
  triceps_overhead: SWAP_NOTES.triceps,
  triceps_pushdown: SWAP_NOTES.triceps,
  calf_raise: SWAP_NOTES.calves,
  calf_raise_seated: SWAP_NOTES.calves,
  knee_extension: SWAP_NOTES.kneeExtension,
  press_incline: SWAP_NOTES.incline,
  raise_lateral: SWAP_NOTES.lateralRaise,
};

const FREE_WEIGHTS: ReadonlySet<EquipmentKind> = new Set(['barbell', 'dumbbell', 'kettlebell']);
const GUIDED: ReadonlySet<EquipmentKind> = new Set(['machine', 'smith']);

/**
 * The lifts the free-weight and machine comparison was run on: presses,
 * squats, rows and pulls. The finding is not stretched to cover a curl.
 */
const BIG_LIFTS: ReadonlySet<MovementPattern> = new Set([
  'squat', 'leg_press', 'lunge', 'press_flat', 'press_decline', 'press_close_grip', 'dip', 'press_overhead', 'row', 'pull_vertical',
]);

/** Patterns that are conditioning more than muscle work: never offered as a match. */
const NEVER_OFFERED: ReadonlySet<MovementPattern> = new Set(['swing']);

const PARTS = Object.keys(MUSCLE_PART_WORDS) as MusclePart[];

interface Scored<T extends Exercise> {
  exercise: T;
  profile: MovementProfile;
  score: number;
  coverage: number;
}

/** The share of what the original trains that the candidate trains too, and the candidate's share of extras. */
function overlap(original: MovementProfile, candidate: MovementProfile): { coverage: number; extra: number } {
  let shared = 0;
  let wanted = 0;
  let offered = 0;
  for (const part of PARTS) {
    const from = original.muscles[part] ?? 0;
    const to = candidate.muscles[part] ?? 0;
    shared += Math.min(from, to);
    wanted += from;
    offered += to;
  }
  return { coverage: wanted > 0 ? shared / wanted : 0, extra: offered > 0 ? (offered - shared) / offered : 0 };
}

function scoreMatch(original: MovementProfile, candidate: MovementProfile): { score: number; coverage: number } {
  const { coverage, extra } = overlap(original, candidate);
  // Extra muscles cost a little: they are work the day did not plan.
  const muscles = coverage * (1 - 0.2 * extra);
  const pattern = patternNearness(original.pattern, candidate.pattern);
  const shorter = Math.max(0, original.length - candidate.length);
  let score = WEIGHT.muscles * muscles + WEIGHT.pattern * pattern + WEIGHT.length * (1 - shorter);
  if (candidate.length > original.length) score += LONGER_BONUS * (candidate.length - original.length);
  if (candidate.hardToLoad && !original.hardToLoad) score -= HARD_TO_LOAD_PENALTY;
  if (candidate.rare && !original.rare) score -= RARE_PENALTY;
  if (candidate.unilateral && !original.unilateral) score -= ONE_SIDE_PENALTY;
  return { score, coverage };
}

/** "Same movement", "Same muscles", or the part that changes most: "Less glutes", "Adds triceps". */
function muscleWords(original: MovementProfile, candidate: MovementProfile): string {
  if (original.pattern === candidate.pattern) return 'Same movement';
  let lost: { part: MusclePart; by: number; from: number } | null = null;
  let gained: { part: MusclePart; by: number; from: number } | null = null;
  for (const part of PARTS) {
    const from = original.muscles[part] ?? 0;
    const to = candidate.muscles[part] ?? 0;
    if (from - to >= 0.5 && (!lost || from - to > lost.by || (from - to === lost.by && from > lost.from))) lost = { part, by: from - to, from };
    if (to - from >= 0.5 && (!gained || to - from > gained.by)) gained = { part, by: to - from, from };
  }
  // What goes missing matters more to a swap than what comes with it.
  if (lost) return `${lost.by >= lost.from ? 'No' : 'Less'} ${MUSCLE_PART_WORDS[lost.part]}`;
  if (gained) return `${gained.from === 0 ? 'Adds' : 'More'} ${MUSCLE_PART_WORDS[gained.part]}`;
  return 'Same muscles';
}

/** The one thing that changes most about doing it, if any. */
function changeWords(original: MovementProfile, candidate: MovementProfile): string | null {
  if (candidate.length - original.length >= 1) return 'more stretch';
  if (original.length - candidate.length >= 1) return 'less stretch';
  if (candidate.hardToLoad && !original.hardToLoad) return 'hard to load heavy';
  if (candidate.unilateral && !original.unilateral) return 'one side at a time';
  if (original.loadsLowerBack && !candidate.loadsLowerBack) return 'easier on the lower back';
  return null;
}

function matchLine(original: MovementProfile, candidate: MovementProfile): string {
  const equipment = candidate.equipment !== original.equipment ? EQUIPMENT_WORDS[candidate.equipment] : null;
  const change = [equipment, changeWords(original, candidate)].filter(Boolean).join(', ');
  return [muscleWords(original, candidate), change].filter(Boolean).join(' · ');
}

function noteFor<T extends Exercise>(original: MovementProfile, picked: Scored<T>[]): SwapNote | null {
  const specific = PATTERN_NOTES[original.pattern];
  if (specific) return specific;
  if (!BIG_LIFTS.has(original.pattern)) return null;
  const crosses =
    (FREE_WEIGHTS.has(original.equipment) && picked.some((entry) => GUIDED.has(entry.profile.equipment))) ||
    (GUIDED.has(original.equipment) && picked.some((entry) => FREE_WEIGHTS.has(entry.profile.equipment)));
  return crosses ? SWAP_NOTES.machines : null;
}

/** Best first, each pick counting a little against the next on the same equipment. */
function spread<T extends Exercise>(pool: Scored<T>[], limit: number): Scored<T>[] {
  const left = [...pool];
  const picked: Scored<T>[] = [];
  const used = new Map<EquipmentKind, number>();
  while (picked.length < limit && left.length > 0) {
    let best = 0;
    let bestValue = -Infinity;
    left.forEach((entry, index) => {
      const kind = entry.profile.equipment;
      const value = entry.score - SAME_EQUIPMENT_PICKED * (used.get(kind) ?? 0);
      const current = left[best];
      const tie = Math.abs(value - bestValue) < 1e-9;
      const steadier = EQUIPMENT_ORDER.indexOf(kind) < EQUIPMENT_ORDER.indexOf(current.profile.equipment);
      const sameKind = kind === current.profile.equipment;
      if (value > bestValue + 1e-9 || (tie && (steadier || (sameKind && entry.exercise.name.localeCompare(current.exercise.name) < 0)))) {
        best = index;
        bestValue = value;
      }
    });
    const [next] = left.splice(best, 1);
    picked.push(next);
    used.set(next.profile.equipment, (used.get(next.profile.equipment) ?? 0) + 1);
  }
  return picked;
}

/**
 * The closest matches for `original` among `candidates` (the movements the
 * picker may offer), with one finding that bears on the swap when there is
 * one. Empty when the original's name says too little to place it: better no
 * suggestion than a guess. Bodyweight skills are matched only to each other.
 */
export function suggestSwaps<T extends Exercise>(
  original: Pick<Exercise, 'id' | 'name' | 'equipment'> & { category?: Exercise['category'] },
  candidates: readonly T[],
  limit: number = SWAP_MATCH_LIMIT,
): SwapSuggestions<T> {
  const from = movementProfile(original);
  if (!from) return NONE;
  const skills = exerciseCategory(original) === 'calisthenics';

  const scored: Scored<T>[] = [];
  const seen = new Set<string>();
  for (const exercise of candidates) {
    if (exercise.id === original.id || seen.has(exercise.id) || exercise.retired_at) continue;
    seen.add(exercise.id);
    if (!skills && exerciseCategory(exercise) === 'calisthenics') continue;
    const profile = movementProfile(exercise);
    if (!profile || NEVER_OFFERED.has(profile.pattern)) continue;
    const { score, coverage } = scoreMatch(from, profile);
    if (coverage >= MIN_COVERAGE) scored.push({ exercise, profile, score, coverage });
  }

  const close = scored.filter((entry) => entry.score >= CLOSE_SCORE);
  const picked = close.length > 0 ? spread(close, limit) : spread(scored, Math.min(limit, FALLBACK_LIMIT));
  // The spread decides who is named; the list then reads best first.
  picked.sort((a, b) => b.score - a.score);

  return {
    matches: picked.map((entry) => ({ exercise: entry.exercise, line: matchLine(from, entry.profile), score: entry.score })),
    note: picked.length > 0 || PATTERN_NOTES[from.pattern] ? noteFor(from, picked) : null,
  };
}
