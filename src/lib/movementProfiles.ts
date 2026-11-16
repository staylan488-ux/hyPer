/**
 * What a movement trains and how, worked out from its name.
 *
 * The exercise library files a movement under one main muscle and one second
 * muscle. That is enough to count weekly sets, and too coarse to say which
 * movement can stand in for another: a leg extension and a squat are both
 * "quads", and train different parts of them. A profile adds what the swap
 * suggestions need (src/lib/swapSuggestions.ts): the movement pattern, the
 * parts of each muscle it trains, whether it loads the muscle at long length,
 * and what it is done with.
 *
 * Profiles come from the name, so they cover the shared library, movements
 * production holds that the repo does not, and the ones people type in. A
 * name no rule knows has no profile, and gets no suggestions.
 *
 * What each choice rests on is in docs/movement-swaps.md.
 */
import type { Exercise } from '@/types';

/**
 * Muscles as finely as the research separates them. Where two movements for
 * the same muscle grow different parts of it, the parts are listed apart.
 */
export type MusclePart =
  | 'chest_upper'
  | 'chest_mid'
  | 'front_delts'
  | 'side_delts'
  | 'rear_delts'
  | 'triceps'
  | 'biceps'
  | 'brachialis'
  | 'lats'
  | 'upper_back'
  | 'traps'
  | 'lower_back'
  | 'quads_vasti'
  | 'quads_rf'
  | 'glutes'
  | 'glute_med'
  | 'adductors'
  | 'hamstrings'
  | 'gastrocnemius'
  | 'soleus'
  | 'abs'
  | 'obliques'
  | 'hip_flexors';

/** How a part reads inside a line such as "Less upper chest". */
export const MUSCLE_PART_WORDS: Record<MusclePart, string> = {
  chest_upper: 'upper chest',
  chest_mid: 'mid chest',
  front_delts: 'front delts',
  side_delts: 'side delts',
  rear_delts: 'rear delts',
  triceps: 'triceps',
  biceps: 'biceps',
  brachialis: 'brachialis',
  lats: 'lats',
  upper_back: 'upper back',
  traps: 'traps',
  lower_back: 'lower back',
  quads_vasti: 'quads',
  quads_rf: 'rectus femoris',
  glutes: 'glutes',
  glute_med: 'side glutes',
  adductors: 'adductors',
  hamstrings: 'hamstrings',
  gastrocnemius: 'gastrocnemius',
  soleus: 'soleus',
  abs: 'abs',
  obliques: 'obliques',
  hip_flexors: 'hip flexors',
};

export type MovementPattern =
  | 'squat'
  | 'leg_press'
  | 'lunge'
  | 'knee_extension'
  | 'hinge'
  | 'deadlift'
  | 'swing'
  | 'back_extension'
  | 'hip_thrust'
  | 'glute_kickback'
  | 'hip_abduction'
  | 'hip_adduction'
  | 'leg_curl'
  | 'calf_raise'
  | 'calf_raise_seated'
  | 'press_flat'
  | 'press_incline'
  | 'press_decline'
  | 'press_close_grip'
  | 'dip'
  | 'fly'
  | 'fly_incline'
  | 'pullover'
  | 'press_overhead'
  | 'raise_lateral'
  | 'raise_front'
  | 'upright_row'
  | 'rear_fly'
  | 'face_pull'
  | 'shrug'
  | 'pull_vertical'
  | 'row'
  | 'straight_arm_pulldown'
  | 'curl'
  | 'curl_hammer'
  | 'triceps_overhead'
  | 'triceps_lying'
  | 'triceps_pushdown'
  | 'crunch'
  | 'leg_raise'
  | 'anti_extension'
  | 'rotation';

export type EquipmentKind = 'machine' | 'smith' | 'cable' | 'barbell' | 'dumbbell' | 'kettlebell' | 'bodyweight' | 'other';

type Muscles = Partial<Record<MusclePart, number>>;

/**
 * The parts each pattern trains: 1 for a part it trains directly, 0.5 for one
 * that helps, the same two weights weekly sets are counted with.
 */
export const PATTERN_MUSCLES: Record<MovementPattern, Muscles> = {
  // Squats grow the vasti, glutes and adductors, and leave the rectus femoris
  // and the hamstrings where they were (Kubo 2019).
  squat: { quads_vasti: 1, glutes: 1, adductors: 0.5 },
  leg_press: { quads_vasti: 1, glutes: 1, adductors: 0.5 },
  lunge: { quads_vasti: 1, glutes: 1, adductors: 0.5 },
  // The rectus femoris grows from knee extension alone (Zabaleta-Korta 2021).
  knee_extension: { quads_vasti: 1, quads_rf: 1 },
  hinge: { hamstrings: 1, glutes: 1, lower_back: 0.5 },
  deadlift: { glutes: 1, lower_back: 1, hamstrings: 0.5, quads_vasti: 0.5, traps: 0.5 },
  swing: { glutes: 1, hamstrings: 0.5 },
  back_extension: { glutes: 1, hamstrings: 1, lower_back: 0.5 },
  hip_thrust: { glutes: 1, hamstrings: 0.5 },
  glute_kickback: { glutes: 1, hamstrings: 0.5 },
  hip_abduction: { glute_med: 1 },
  hip_adduction: { adductors: 1 },
  leg_curl: { hamstrings: 1 },
  // With the knee straight the gastrocnemius works at length; seated, it
  // barely grew (Kinoshita 2023).
  calf_raise: { gastrocnemius: 1, soleus: 1 },
  calf_raise_seated: { soleus: 1 },
  press_flat: { chest_mid: 1, chest_upper: 0.5, front_delts: 0.5, triceps: 0.5 },
  // The incline press grows the upper chest more than the flat press (Chaves 2020).
  press_incline: { chest_upper: 1, chest_mid: 0.5, front_delts: 0.5, triceps: 0.5 },
  press_decline: { chest_mid: 1, front_delts: 0.5, triceps: 0.5 },
  press_close_grip: { triceps: 1, chest_mid: 0.5, front_delts: 0.5 },
  dip: { chest_mid: 1, triceps: 1, front_delts: 0.5 },
  fly: { chest_mid: 1, chest_upper: 0.5, front_delts: 0.5 },
  fly_incline: { chest_upper: 1, chest_mid: 0.5, front_delts: 0.5 },
  pullover: { lats: 1, chest_mid: 0.5 },
  press_overhead: { front_delts: 1, side_delts: 0.5, triceps: 0.5 },
  raise_lateral: { side_delts: 1 },
  raise_front: { front_delts: 1 },
  upright_row: { side_delts: 1, traps: 1 },
  rear_fly: { rear_delts: 1 },
  face_pull: { rear_delts: 1, traps: 0.5 },
  shrug: { traps: 1 },
  pull_vertical: { lats: 1, upper_back: 0.5, biceps: 0.5 },
  row: { upper_back: 1, lats: 0.5, biceps: 0.5, rear_delts: 0.5 },
  straight_arm_pulldown: { lats: 1 },
  curl: { biceps: 1, brachialis: 0.5 },
  curl_hammer: { brachialis: 1, biceps: 0.5 },
  triceps_overhead: { triceps: 1 },
  triceps_lying: { triceps: 1 },
  triceps_pushdown: { triceps: 1 },
  crunch: { abs: 1 },
  leg_raise: { abs: 1, hip_flexors: 0.5 },
  anti_extension: { abs: 1 },
  rotation: { obliques: 1, abs: 0.5 },
};

/**
 * How near two different patterns are as movements, from 0 to 1. A pair not
 * listed shares nothing but, perhaps, a muscle. Judgments, written out so
 * they can be argued with; the muscle parts above carry the evidence.
 */
const NEAR: ReadonlyArray<readonly [MovementPattern, MovementPattern, number]> = [
  ['squat', 'leg_press', 0.9],
  ['squat', 'lunge', 0.7],
  ['leg_press', 'lunge', 0.7],
  ['squat', 'knee_extension', 0.3],
  ['leg_press', 'knee_extension', 0.3],
  ['lunge', 'knee_extension', 0.3],
  ['squat', 'deadlift', 0.3],
  ['hinge', 'back_extension', 0.8],
  ['hinge', 'deadlift', 0.7],
  ['hinge', 'leg_curl', 0.4],
  ['hinge', 'hip_thrust', 0.4],
  ['back_extension', 'leg_curl', 0.3],
  ['back_extension', 'hip_thrust', 0.6],
  ['back_extension', 'deadlift', 0.5],
  ['hip_thrust', 'glute_kickback', 0.7],
  ['hip_thrust', 'deadlift', 0.5],
  ['hip_thrust', 'squat', 0.3],
  ['calf_raise', 'calf_raise_seated', 0.7],
  ['press_flat', 'press_decline', 0.9],
  ['press_flat', 'press_incline', 0.8],
  ['press_incline', 'press_decline', 0.7],
  ['press_flat', 'press_close_grip', 0.7],
  ['press_flat', 'dip', 0.6],
  ['press_decline', 'dip', 0.7],
  ['press_close_grip', 'dip', 0.7],
  ['press_flat', 'fly', 0.4],
  ['press_incline', 'fly_incline', 0.4],
  ['fly', 'fly_incline', 0.85],
  ['press_incline', 'press_overhead', 0.4],
  ['pullover', 'straight_arm_pulldown', 0.8],
  ['pull_vertical', 'straight_arm_pulldown', 0.5],
  ['pull_vertical', 'pullover', 0.4],
  ['pull_vertical', 'row', 0.6],
  ['raise_lateral', 'upright_row', 0.6],
  ['raise_front', 'press_overhead', 0.5],
  ['rear_fly', 'face_pull', 0.8],
  ['row', 'face_pull', 0.3],
  ['shrug', 'upright_row', 0.5],
  ['curl', 'curl_hammer', 0.8],
  ['triceps_overhead', 'triceps_lying', 0.85],
  ['triceps_overhead', 'triceps_pushdown', 0.8],
  ['triceps_lying', 'triceps_pushdown', 0.85],
  ['triceps_overhead', 'press_close_grip', 0.5],
  ['triceps_lying', 'press_close_grip', 0.5],
  ['triceps_pushdown', 'press_close_grip', 0.5],
  ['triceps_overhead', 'dip', 0.4],
  ['triceps_lying', 'dip', 0.4],
  ['triceps_pushdown', 'dip', 0.4],
  ['crunch', 'leg_raise', 0.8],
  ['crunch', 'anti_extension', 0.6],
  ['leg_raise', 'anti_extension', 0.6],
  ['rotation', 'anti_extension', 0.4],
  ['rotation', 'crunch', 0.4],
];

const nearness = new Map<string, number>();
for (const [a, b, value] of NEAR) {
  nearness.set(`${a}|${b}`, value);
  nearness.set(`${b}|${a}`, value);
}

/** 1 for the same pattern, the listed nearness for a related one, otherwise 0. */
export function patternNearness(a: MovementPattern, b: MovementPattern): number {
  return a === b ? 1 : nearness.get(`${a}|${b}`) ?? 0;
}

export interface MovementProfile {
  pattern: MovementPattern;
  muscles: Muscles;
  equipment: EquipmentKind;
  /**
   * Where in its range the main muscle is loaded: 1 at long length (a seated
   * leg curl, an overhead triceps extension), 0 at short length (a lying leg
   * curl, a pushdown), 0.5 in between or not known.
   */
  length: 0 | 0.5 | 1;
  /** The lower back holds the load (a bar on the back, a hinge, a bent-over row). */
  loadsLowerBack: boolean;
  /** One side at a time. */
  unilateral: boolean;
  /** Something other than the target muscle limits the load (a goblet hold, bodyweight). */
  hardToLoad: boolean;
  /** Needs equipment few gyms have. */
  rare: boolean;
}

type Rule = readonly [RegExp, MovementPattern];

/**
 * Name rules, first match wins, on the name in lower case with punctuation
 * as spaces. Order matters: "Pallof Press" is not a press, "Leg Press Calf
 * Raise" is not a leg press, "Reverse Pec Deck" is not a fly.
 */
const RULES: readonly Rule[] = [
  // Core
  [/\b(pallof|russian twist|wood ?chop|side bend|side plank|windshield|oblique)/, 'rotation'],
  [/\b(plank|rollout|ab wheel|hollow|dragon flag|dead bug|l sit|v sit)/, 'anti_extension'],
  [/\b(leg|knee) raises?\b|\btoes to bar\b|\breverse crunch|\bv ups?\b/, 'leg_raise'],
  [/\b(crunch|sit ups?)\b/, 'crunch'],
  // Calves
  [/\bseated\b.*\b(calf|calves)\b/, 'calf_raise_seated'],
  [/\b(calf|calves)\b/, 'calf_raise'],
  // Hips
  [/\badduct/, 'hip_adduction'],
  [/\babduct/, 'hip_abduction'],
  [/\b(hip thrust|glute bridge)/, 'hip_thrust'],
  [/\bglute\b.*\bkickback|\bkickback\b.*\bglute|\bdonkey kick/, 'glute_kickback'],
  [/\b(back extension|hyperextension|reverse hyper)/, 'back_extension'],
  [/\b(good morning|pull through)/, 'hinge'],
  [/\bswings?\b/, 'swing'],
  [/\b(romanian|rdl|stiff leg|straight leg)\b/, 'hinge'],
  [/\b(deadlift|rack pull)/, 'deadlift'],
  // Legs
  [/\b(leg extension|sissy|reverse nordic)/, 'knee_extension'],
  [/\b(leg curl|hamstring curl|nordic|glute ham)/, 'leg_curl'],
  [/\bleg press\b/, 'leg_press'],
  [/\b(split squat|lunges?|step ups?)\b/, 'lunge'],
  [/\bsquats?\b/, 'squat'],
  // Triceps, before the presses they share words with
  [/\b(triceps?|skull ?crushers?|push ?downs?|press ?downs?|french press)\b/, 'triceps_pushdown'],
  // Shoulders and upper back
  [/\b(lateral raise|side raise|side lateral)/, 'raise_lateral'],
  [/\bfront raise/, 'raise_front'],
  [/\bupright row/, 'upright_row'],
  [/\bshrugs?\b/, 'shrug'],
  [/\bface pull/, 'face_pull'],
  [/\brear delt|\breverse (pec deck|fly|flye)\b|\brear fly/, 'rear_fly'],
  // Chest
  [/\bpull ?overs?\b/, 'pullover'],
  [/\b(fly|flye|flyes|flies|pec deck|crossover)\b/, 'fly'],
  [/\bclose grip\b.*\b(bench|press)\b|\bjm press\b|\bdiamond push/, 'press_close_grip'],
  [/\bdips?\b/, 'dip'],
  [/\b(pike push|handstand push)|\b(overhead|shoulder|military|arnold)\b.*\bpress\b|\bohp\b/, 'press_overhead'],
  [/\bincline\b.*\b(press|bench|push ?ups?)\b/, 'press_incline'],
  [/\bdecline\b.*\b(press|bench)\b/, 'press_decline'],
  [/\b(bench|chest press|push ?ups?|press ups?|floor press)\b/, 'press_flat'],
  // Back
  [/\bstraight arm\b/, 'straight_arm_pulldown'],
  [/\b(australian|inverted row)/, 'row'],
  [/\b(pull ?downs?|pull ?ups?|chin ?ups?|muscle ?ups?)\b/, 'pull_vertical'],
  [/\brows?\b/, 'row'],
  // Arms
  [/\b(hammer|reverse curl|zottman)/, 'curl_hammer'],
  [/\b(wrist|finger)\b.*\bcurl/, 'curl_hammer'],
  [/\bcurls?\b/, 'curl'],
];

function plain(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function patternOf(name: string): MovementPattern | null {
  const pattern = RULES.find(([rule]) => rule.test(name))?.[1] ?? null;
  if (pattern === 'triceps_pushdown') {
    if (/\b(overhead|french)\b/.test(name)) return 'triceps_overhead';
    if (/\b(skull|lying)\b/.test(name)) return 'triceps_lying';
  }
  if (pattern === 'fly' && /\b(incline|low to high)\b/.test(name)) return 'fly_incline';
  // A wrist curl is forearm work, which the app has no muscle for.
  if (pattern === 'curl_hammer' && /\b(wrist|finger)\b/.test(name)) return null;
  return pattern;
}

/** What it is done with: the library's equipment column, else the name. */
function equipmentOf(name: string, column: string | null): EquipmentKind {
  const filed = (column ?? '').toLowerCase();
  for (const text of [filed, name]) {
    if (!text) continue;
    if (/smith/.test(text)) return 'smith';
    if (/machine|pec deck|leg press|hack squat|pendulum|belt squat|leg extension|leg curl/.test(text)) return 'machine';
    if (/cable|pull ?down|push ?down|press ?down|rope|face pull|crossover/.test(text)) return 'cable';
    if (/kettlebell|\bkb\b/.test(text)) return 'kettlebell';
    if (/dumbbell|\bdb\b|goblet/.test(text)) return 'dumbbell';
    if (/barbell|ez bar|trap bar|\bbb\b|pendlay|t bar|landmine/.test(text)) return 'barbell';
    if (/bodyweight|body weight|rings?\b|pull ?up bar|parallettes/.test(text)) return 'bodyweight';
  }
  return 'other';
}

/** Bodyweight movements that take added load well, or need none. */
const BODYWEIGHT_LOADS_WELL: ReadonlySet<MovementPattern> = new Set([
  'pull_vertical', 'dip', 'back_extension', 'leg_curl', 'crunch', 'leg_raise', 'anti_extension', 'rotation',
]);

function lengthOf(pattern: MovementPattern, name: string): 0 | 0.5 | 1 {
  switch (pattern) {
    case 'leg_curl':
      // Seated, the hip is bent and the hamstrings are long (Maeo 2021).
      if (/\bseated\b/.test(name)) return 1;
      return /\b(lying|prone|standing|nordic|glute ham)\b/.test(name) ? 0 : 0.5;
    case 'triceps_overhead':
      return 1; // Maeo 2023
    case 'triceps_pushdown':
      return 0;
    case 'calf_raise':
    case 'hinge':
    case 'back_extension':
    case 'fly':
    case 'fly_incline':
    case 'pullover':
      return 1;
    case 'curl':
      // Behind the body the biceps is long at the shoulder.
      return /\b(incline|bayesian|behind)\b/.test(name) ? 1 : 0.5;
    default:
      return 0.5;
  }
}

function loadsLowerBack(pattern: MovementPattern, equipment: EquipmentKind, name: string): boolean {
  switch (pattern) {
    case 'hinge':
    case 'deadlift':
    case 'swing':
    case 'back_extension':
      return true;
    case 'squat':
      return (equipment === 'barbell' || equipment === 'smith' || equipment === 'other') && !/\b(hack|pendulum|belt)\b/.test(name);
    case 'row':
      return (equipment === 'barbell' || /\b(bent over|pendlay|t bar)\b/.test(name)) && !/\b(chest supported|seal)\b/.test(name);
    default:
      return false;
  }
}

/**
 * The profile of a movement, or null when its name says too little to place
 * it. Two names for one movement get the same profile, so a duplicate row is
 * a perfect match for its twin.
 */
export function movementProfile(exercise: Pick<Exercise, 'name' | 'equipment'>): MovementProfile | null {
  const name = plain(exercise.name);
  const pattern = patternOf(name);
  if (!pattern) return null;
  const equipment = equipmentOf(name, exercise.equipment);
  const unilateral =
    pattern === 'lunge' ||
    pattern === 'glute_kickback' ||
    /\b(one|single) (arm|leg)\b|\bunilateral\b|\b(pistol|shrimp|skater|concentration)\b/.test(name);
  const hardToLoad =
    /\b(goblet|band|banded|kickbacks?)\b/.test(name) && pattern !== 'glute_kickback'
      ? true
      : equipment === 'bodyweight' && !BODYWEIGHT_LOADS_WELL.has(pattern);
  return {
    pattern,
    muscles: PATTERN_MUSCLES[pattern],
    equipment,
    length: lengthOf(pattern, name),
    loadsLowerBack: loadsLowerBack(pattern, equipment, name),
    unilateral,
    hardToLoad,
    rare: /\b(pendulum|belt squat|reverse hyper|glute ham|nordic|sissy)\b/.test(name),
  };
}
