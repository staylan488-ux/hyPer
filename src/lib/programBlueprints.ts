/**
 * The built-in programs, one for each number of training days the builder
 * offers. Each is a list of days, and each day a list of movements in the
 * order they are trained. They are written by hand; why each choice was made,
 * with the research behind it, is in docs/program-design.md.
 *
 * A blueprint holds no set counts. The designer (src/lib/programDesigner.ts)
 * shares out sets for the session length, experience and emphasis asked for,
 * so a row here is a movement the plan may use, not one it always has.
 */
import type { ProgramFocus } from '@/lib/programDesigner';

export type RepRange = readonly [min: number, max: number];

export interface BlueprintRow {
  /** A name in the seeded exercise library and in DESIGNER_MOVEMENTS. */
  name: string;
  reps: RepRange;
  /**
   * When the row joins its day, among the day's rows for the same muscle:
   * 1 first, 2 once the first has 3 sets, 3 only when the others are full.
   */
  pick: 1 | 2 | 3;
  /**
   * The stand-in for a dumbbells-only plan: another movement for the same
   * job, or null when dumbbells have none and the row is left out. Omitted
   * when the movement itself needs only dumbbells or bodyweight.
   */
  dumbbell?: string | { name: string; reps: RepRange } | null;
  /** A row for this emphasis: the favoured half's work on the other half's days. Left out of any other plan. */
  only?: Exclude<ProgramFocus, 'no_focus'>;
  /**
   * With `only`: the row stays in other plans as a last choice (pick 3). For
   * light single-muscle work, a lateral raise or a curl, that a leg day can
   * take when the upper days are full.
   */
  spare?: boolean;
}

export interface BlueprintDay {
  name: string;
  /** In training order. */
  rows: readonly BlueprintRow[];
}

export interface ProgramBlueprint {
  /** "Upper/Lower". Also the name a new program starts with. */
  name: string;
  days: readonly BlueprintDay[];
}

// Rep ranges by the job a movement does. All sit inside the span where a set
// taken close to failure grows muscle equally well, so the choice is about
// time, joints and how well the load can be stepped.
const HEAVY: RepRange = [6, 10];
const MID: RepRange = [8, 12];
const ISO: RepRange = [10, 15];
const LIGHT: RepRange = [12, 20];

type Extra = Pick<BlueprintRow, 'dumbbell' | 'only' | 'spare'>;
const row = (name: string, reps: RepRange, pick: BlueprintRow['pick'], extra: Extra = {}): BlueprintRow => ({ name, reps, pick, ...extra });
const forUpper = (name: string, reps: RepRange, dumbbell?: BlueprintRow['dumbbell'], spare?: boolean): BlueprintRow => row(name, reps, 1, { only: 'upper_focus', dumbbell, spare });
const forLower = (name: string, reps: RepRange, dumbbell?: BlueprintRow['dumbbell']): BlueprintRow => row(name, reps, 1, { only: 'lower_focus', dumbbell });

// ── Lower-body days ─────────────────────────────────────────────────
// Shared by Upper/Lower, the 5-day plan and Push/Pull/Legs.

/** Led by the squat: quads first, a leg curl for the hamstrings, then the single-muscle work. */
const QUAD_LED: readonly BlueprintRow[] = [
  row('Barbell Back Squat', HEAVY, 1, { dumbbell: { name: 'Bulgarian Split Squat', reps: MID } }),
  row('Seated Leg Curl', ISO, 1, { dumbbell: { name: 'Dumbbell Romanian Deadlift', reps: MID } }),
  row('Leg Extension', ISO, 2, { dumbbell: 'Goblet Squat' }),
  row('45° Back Extension', ISO, 1, { dumbbell: null }),
  row('Standing Calf Raise', ISO, 1),
  row('Cable Crunch', ISO, 1, { dumbbell: 'Crunch' }),
  forUpper('Pec Deck / Machine Fly', ISO, 'Dumbbell Fly'),
  forUpper('Machine Lateral Raise', LIGHT, 'Lateral Raise', true),
  forUpper('Cable Curl', ISO, 'Dumbbell Curl', true),
];

/** Led by the Romanian deadlift: hamstrings and glutes first, quads on a stable machine. */
const HINGE_LED: readonly BlueprintRow[] = [
  row('Romanian Deadlift', HEAVY, 1, { dumbbell: { name: 'Dumbbell Romanian Deadlift', reps: MID } }),
  row('Leg Press', MID, 1, { dumbbell: 'Walking Lunge' }),
  row('Hip Thrust', MID, 1, { dumbbell: null }),
  row('Lying Leg Curl', ISO, 2, { dumbbell: null }),
  row('Leg Extension', ISO, 2, { dumbbell: 'Step-Up' }),
  row('Leg Press Calf Raise', ISO, 1, { dumbbell: 'Standing Calf Raise' }),
  row('Hanging Leg Raise', ISO, 1),
  forUpper('Close-Grip Lat Pulldown', MID, 'Chin-Up'),
  forUpper('Machine Lateral Raise', LIGHT, 'Lateral Raise', true),
  forUpper('Rope Pushdown', ISO, 'Tricep Kickback', true),
];

// ── Upper/Lower: 4 days ─────────────────────────────────────────────

const UPPER_LOWER: ProgramBlueprint = {
  name: 'Upper/Lower',
  days: [
    {
      name: 'Upper A',
      rows: [
        row('Flat Barbell Bench Press', HEAVY, 1, { dumbbell: { name: 'Flat Dumbbell Bench Press', reps: MID } }),
        row('Seated Cable Row', MID, 1, { dumbbell: 'One-Arm Dumbbell Row' }),
        row('Cable Fly', ISO, 2, { dumbbell: 'Dumbbell Fly' }),
        row('Lat Pulldown', MID, 2, { dumbbell: 'Chin-Up' }),
        row('Machine Shoulder Press', MID, 1, { dumbbell: 'Overhead Dumbbell Press' }),
        row('Lateral Raise', LIGHT, 1),
        row('Cable Overhead Tricep Extension', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
        row('Preacher Curl', ISO, 1, { dumbbell: 'Concentration Curl' }),
        row('Reverse Pec Deck', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
        forLower('Leg Extension', ISO, 'Goblet Squat'),
        forLower('Seated Leg Curl', ISO, { name: 'Dumbbell Romanian Deadlift', reps: MID }),
      ],
    },
    { name: 'Lower A', rows: QUAD_LED },
    {
      name: 'Upper B',
      rows: [
        row('Lat Pulldown', MID, 1, { dumbbell: 'Pull-Up' }),
        row('Incline Dumbbell Bench Press', MID, 1),
        row('One-Arm Dumbbell Row', MID, 2),
        row('Machine Chest Press', MID, 2, { dumbbell: { name: 'Push-Up', reps: LIGHT } }),
        row('Cable Lateral Raise', LIGHT, 1, { dumbbell: 'Lateral Raise' }),
        row('Tricep Pushdown', ISO, 1, { dumbbell: 'Tricep Kickback' }),
        row('Incline Dumbbell Curl', ISO, 1),
        row('Face Pull', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
        forLower('Leg Press', MID, 'Walking Lunge'),
        forLower('Lying Leg Curl', ISO, { name: 'Dumbbell Romanian Deadlift', reps: MID }),
      ],
    },
    { name: 'Lower B', rows: HINGE_LED },
  ],
};

// ── Full Body: 3 days ───────────────────────────────────────────────
// One movement for each muscle on the days that train it, a different lead
// lift each day.

const FULL_BODY: ProgramBlueprint = {
  name: 'Full Body',
  days: [
    {
      name: 'Full Body A',
      rows: [
        row('Barbell Back Squat', HEAVY, 1, { dumbbell: { name: 'Bulgarian Split Squat', reps: MID } }),
        row('Flat Barbell Bench Press', HEAVY, 1, { dumbbell: { name: 'Flat Dumbbell Bench Press', reps: MID } }),
        row('Lat Pulldown', MID, 1, { dumbbell: 'Pull-Up' }),
        row('Seated Leg Curl', ISO, 1, { dumbbell: { name: 'Dumbbell Romanian Deadlift', reps: MID } }),
        row('Lateral Raise', LIGHT, 1),
        row('Cable Overhead Tricep Extension', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
        row('Incline Dumbbell Curl', ISO, 1),
        row('Standing Calf Raise', ISO, 1),
      ],
    },
    {
      name: 'Full Body B',
      rows: [
        row('Romanian Deadlift', HEAVY, 1, { dumbbell: { name: 'Dumbbell Romanian Deadlift', reps: MID } }),
        row('Incline Dumbbell Bench Press', MID, 1),
        row('One-Arm Dumbbell Row', MID, 1),
        row('Leg Press', MID, 1, { dumbbell: 'Walking Lunge' }),
        row('Cable Lateral Raise', LIGHT, 1, { dumbbell: 'Lateral Raise' }),
        row('Preacher Curl', ISO, 1, { dumbbell: 'Concentration Curl' }),
        row('Tricep Pushdown', ISO, 1, { dumbbell: 'Tricep Kickback' }),
        row('Reverse Pec Deck', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
        row('Hanging Leg Raise', ISO, 1),
      ],
    },
    {
      name: 'Full Body C',
      rows: [
        row('Seated Cable Row', MID, 1, { dumbbell: 'Chin-Up' }),
        row('Machine Chest Press', MID, 1, { dumbbell: { name: 'Push-Up', reps: LIGHT } }),
        row('Leg Extension', ISO, 1, { dumbbell: 'Goblet Squat' }),
        row('Hip Thrust', MID, 1, { dumbbell: null }),
        row('Machine Shoulder Press', MID, 1, { dumbbell: 'Overhead Dumbbell Press' }),
        row('Machine Lateral Raise', LIGHT, 1, { dumbbell: 'Lateral Raise' }),
        row('Lying Leg Curl', ISO, 1, { dumbbell: { name: 'Dumbbell Romanian Deadlift', reps: MID } }),
        row('Hammer Curl', ISO, 1),
        row('Rope Pushdown', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
        row('Leg Press Calf Raise', ISO, 1, { dumbbell: 'Standing Calf Raise' }),
        row('Cable Crunch', ISO, 1, { dumbbell: 'Crunch' }),
      ],
    },
  ],
};

// ── Push and pull days ──────────────────────────────────────────────
// Shared by the 5-day plan and Push/Pull/Legs.

/** Led by the flat press. */
const PUSH_FLAT: readonly BlueprintRow[] = [
  row('Flat Barbell Bench Press', HEAVY, 1, { dumbbell: { name: 'Flat Dumbbell Bench Press', reps: MID } }),
  row('Incline Dumbbell Bench Press', MID, 2),
  row('Machine Shoulder Press', MID, 1, { dumbbell: 'Overhead Dumbbell Press' }),
  row('Lateral Raise', LIGHT, 1),
  row('Cable Fly', ISO, 3, { dumbbell: 'Dumbbell Fly' }),
  row('Cable Overhead Tricep Extension', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
  row('Tricep Pushdown', ISO, 2, { dumbbell: 'Tricep Kickback' }),
  forLower('Leg Extension', ISO, 'Goblet Squat'),
];

/** Led by the incline press, with side delts second while they are fresh. */
const PUSH_INCLINE: readonly BlueprintRow[] = [
  row('Incline Barbell Bench Press', HEAVY, 1, { dumbbell: { name: 'Incline Dumbbell Bench Press', reps: MID } }),
  row('Machine Chest Press', MID, 2, { dumbbell: 'Flat Dumbbell Bench Press' }),
  row('Pec Deck / Machine Fly', ISO, 3, { dumbbell: 'Dumbbell Fly' }),
  row('Cable Lateral Raise', LIGHT, 1, { dumbbell: 'Lateral Raise' }),
  row('Skull Crushers', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
  row('Rope Pushdown', ISO, 2, { dumbbell: 'Tricep Kickback' }),
  forLower('Leg Press', MID, 'Walking Lunge'),
];

/** Led by the pulldown. */
const PULL_VERTICAL: readonly BlueprintRow[] = [
  row('Lat Pulldown', MID, 1, { dumbbell: 'Pull-Up' }),
  row('One-Arm Dumbbell Row', MID, 2),
  row('Reverse Pec Deck', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
  row('Preacher Curl', ISO, 1, { dumbbell: 'Concentration Curl' }),
  row('Hammer Curl', ISO, 2),
  row('Machine Lateral Raise', LIGHT, 2, { dumbbell: 'Lateral Raise' }),
  forLower('Seated Leg Curl', ISO, { name: 'Dumbbell Romanian Deadlift', reps: MID }),
];

/** Led by the row. */
const PULL_ROW: readonly BlueprintRow[] = [
  row('Seated Cable Row', MID, 1, { dumbbell: 'One-Arm Dumbbell Row' }),
  row('Close-Grip Lat Pulldown', MID, 2, { dumbbell: 'Chin-Up' }),
  row('Face Pull', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
  row('Incline Dumbbell Curl', ISO, 1),
  row('Cable Curl', ISO, 2, { dumbbell: 'Dumbbell Curl' }),
  row('Machine Lateral Raise', LIGHT, 2, { dumbbell: 'Lateral Raise' }),
  forLower('Lying Leg Curl', ISO, { name: 'Dumbbell Romanian Deadlift', reps: MID }),
];

// ── Upper/Lower + Push/Pull/Legs: 5 days ────────────────────────────

const UPPER_LOWER_PUSH_PULL_LEGS: ProgramBlueprint = {
  name: 'Upper/Lower + Push/Pull/Legs',
  days: [
    {
      name: 'Upper',
      rows: [
        row('Flat Barbell Bench Press', HEAVY, 1, { dumbbell: { name: 'Flat Dumbbell Bench Press', reps: MID } }),
        row('Lat Pulldown', MID, 1, { dumbbell: 'Pull-Up' }),
        row('Cable Fly', ISO, 2, { dumbbell: 'Dumbbell Fly' }),
        row('One-Arm Dumbbell Row', MID, 2),
        row('Lateral Raise', LIGHT, 1),
        row('Cable Overhead Tricep Extension', ISO, 1, { dumbbell: 'Overhead Tricep Extension' }),
        row('Preacher Curl', ISO, 1, { dumbbell: 'Concentration Curl' }),
        row('Reverse Pec Deck', LIGHT, 1, { dumbbell: 'Rear Delt Fly' }),
        forLower('Leg Extension', ISO, 'Goblet Squat'),
        forLower('Seated Leg Curl', ISO, { name: 'Dumbbell Romanian Deadlift', reps: MID }),
      ],
    },
    { name: 'Lower', rows: QUAD_LED },
    {
      name: 'Push',
      rows: [
        ...PUSH_INCLINE.slice(0, 2),
        row('Machine Shoulder Press', MID, 1, { dumbbell: 'Overhead Dumbbell Press' }),
        ...PUSH_INCLINE.slice(2),
      ],
    },
    { name: 'Pull', rows: PULL_ROW },
    { name: 'Legs', rows: HINGE_LED },
  ],
};

// ── Push/Pull/Legs: 6 days ──────────────────────────────────────────

const PUSH_PULL_LEGS: ProgramBlueprint = {
  name: 'Push/Pull/Legs',
  days: [
    { name: 'Push A', rows: PUSH_FLAT },
    { name: 'Pull A', rows: PULL_VERTICAL },
    { name: 'Legs A', rows: QUAD_LED },
    { name: 'Push B', rows: PUSH_INCLINE },
    { name: 'Pull B', rows: PULL_ROW },
    { name: 'Legs B', rows: HINGE_LED },
  ],
};

/** One program for each day count the builder offers, fewest days first. */
export const PROGRAM_BLUEPRINTS: readonly ProgramBlueprint[] = [FULL_BODY, UPPER_LOWER, UPPER_LOWER_PUSH_PULL_LEGS, PUSH_PULL_LEGS];
