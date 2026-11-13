/**
 * Turns the builder's five answers into a program: the built-in program for
 * the day count (src/lib/programBlueprints.ts), with sets shared out by
 * muscle. Each muscle has a number of sets a week to aim at, set by
 * experience and emphasis; each session has room for only so many sets, set
 * by its length. Sets go one at a time to whichever muscle is furthest from
 * its aim until the aims are met or the sessions are full.
 *
 * What every number rests on is in docs/program-design.md.
 */
import { normalizeExerciseName } from '@/lib/customExercises';
import { DESIGNER_MOVEMENTS } from '@/lib/designerMovements';
import { MAIN_MUSCLES, VOLUME_BAND_EDGES, addMovementSets, formatSetCount, isMainMuscle, volumeMuscle, type MuscleSets } from '@/lib/muscleVolume';
import { PROGRAM_BLUEPRINTS, type BlueprintRow, type ProgramBlueprint, type RepRange } from '@/lib/programBlueprints';
import type { MuscleGroup, SplitTemplate } from '@/types';

export type ProgramFocus = 'no_focus' | 'upper_focus' | 'lower_focus';
export type EquipmentProfile = 'full_gym' | 'dumbbell_only';
export type SessionLength = 'short' | 'moderate' | 'long';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
type LegacyEquipmentProfile = 'limited_gym' | 'minimal';

export interface ProgramDesignAnswers {
  daysPerWeek: number;
  focus: ProgramFocus;
  equipment: EquipmentProfile | LegacyEquipmentProfile;
  sessionLength: SessionLength;
  experience: ExperienceLevel;
}

// ── The numbers ─────────────────────────────────────────────────────

/**
 * Most working sets in one session. A working set with its rest takes about
 * 3 minutes, after about 5 minutes of warm-up: 45 minutes holds 13, 60 holds
 * 18 and 75 holds 23.
 */
export const SESSION_SET_CAPS: Readonly<Record<SessionLength, number>> = {
  short: 13,
  moderate: 18,
  long: 23,
};

export const SESSION_MINUTES: Readonly<Record<SessionLength, number>> = {
  short: 45,
  moderate: 60,
  long: 75,
};

const WARM_UP_MINUTES = 5;
const MINUTES_PER_SET = 3;

/**
 * Sets a week the plan aims each main muscle at, counted as the app counts
 * them (1 for a movement's main muscle, half for its second). A beginner
 * starts just above the smallest dose that grows muscle; 10 is the top of the
 * tier where each added set buys the most; 14 sits in the next tier, for
 * someone the easy gains have left. The plan lands under these when the
 * sessions cannot hold them, never over on purpose.
 */
export const WEEKLY_SET_TARGETS: Readonly<Record<ExperienceLevel, number>> = {
  beginner: 6,
  intermediate: 10,
  advanced: 14,
};

/** Under an emphasis the favoured half of the body aims this much higher, and the other half this much lower. */
export const EMPHASIS = { favoured: 1.3, other: 0.75 } as const;

/**
 * Glutes aim a little lower than the other main muscles. Squats, leg presses
 * and Romanian deadlifts grow them about as well as hip thrusts do, and the
 * app counts those as half a set each, so a plan that chased the full number
 * would pile on hip thrusts.
 */
const GLUTE_SHARE = 0.8;

/**
 * The smaller muscles the plan also feeds, as a share of a main muscle's aim,
 * and how long they wait: a muscle with a wait of 0.6 gets its first set once
 * the main muscles are 60% of the way to theirs, and its last after they have
 * arrived. Presses already train the front delts and rows the rear delts, so
 * their direct work comes when there is room to spare.
 */
const SUPPORT_MUSCLES: Readonly<Record<string, { share: number; wait: number }>> = {
  calves: { share: 0.6, wait: 0.6 },
  rear_delts: { share: 0.6, wait: 0.6 },
  front_delts: { share: 0.6, wait: 0.7 },
  core: { share: 0.4, wait: 0.7 },
};

/** Fewest movements a training day holds. */
const MIN_DAY_MOVEMENTS = 3;

/** Sets a movement has when it is in a plan. */
const MOVEMENT_SETS = { min: 2, usual: 3, max: 4 } as const;

/**
 * Most sets one muscle gets in one session. More sets in a session keep
 * helping up to about 11 (docs/program-design.md); the plan stops short of it.
 */
const SESSION_MUSCLE_SETS = 10;

/** The half of the body the Lower emphasis favours. Abs belong to neither half. */
export const LOWER_BODY: ReadonlySet<string> = new Set(['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors', 'tibialis', 'hip_flexors']);

function emphasisFactor(muscle: string, focus: ProgramFocus): number {
  if (focus === 'no_focus' || muscle === 'core') return 1;
  const favoured = (focus === 'lower_focus') === LOWER_BODY.has(muscle);
  return favoured ? EMPHASIS.favoured : EMPHASIS.other;
}

/** Sets a week the plan aims a muscle at for these answers; 0 for a muscle it does not plan for. */
export function weeklySetTarget(muscle: string, answers: Pick<ProgramDesignAnswers, 'experience' | 'focus'>): number {
  const base = WEEKLY_SET_TARGETS[answers.experience] * emphasisFactor(muscle, answers.focus);
  if (!isMainMuscle(muscle)) return base * (SUPPORT_MUSCLES[muscle]?.share ?? 0);
  // No main muscle is aimed under the smallest dose that grows it.
  return Math.max(VOLUME_BAND_EDGES.solidFrom, base * (muscle === 'glutes' ? GLUTE_SHARE : 1));
}

// ── Movements ───────────────────────────────────────────────────────

const movementByName = new Map(Object.entries(DESIGNER_MOVEMENTS).map(([name, row]) => [normalizeExerciseName(name), row]));

/**
 * What a movement in the built-in programs trains, as the seeded library
 * files it: its main and second muscle and whether it is a compound. Null for
 * any other name.
 */
export function designerMovementMuscles(exerciseName: string): { muscle_group: MuscleGroup; muscle_group_secondary: MuscleGroup | null; is_compound: boolean } | null {
  const row = movementByName.get(normalizeExerciseName(exerciseName));
  return row ? { muscle_group: row[0] as MuscleGroup, muscle_group_secondary: row[1] as MuscleGroup | null, is_compound: row[2] } : null;
}

function dumbbellName(row: BlueprintRow): string | null {
  if (row.dumbbell === undefined) return row.name;
  if (row.dumbbell === null) return null;
  return typeof row.dumbbell === 'string' ? row.dumbbell : row.dumbbell.name;
}

/** Every movement name a built-in program can hold, for any answers. Tests check each against the seeded library. */
export function designerMovementNames(): string[] {
  const names = new Set<string>();
  for (const blueprint of PROGRAM_BLUEPRINTS) {
    for (const day of blueprint.days) {
      for (const row of day.rows) {
        names.add(row.name);
        const stand = dumbbellName(row);
        if (stand) names.add(stand);
      }
    }
  }
  return [...names].sort();
}

/** Rows that also train the rear delts, which the library's one second muscle (biceps) cannot say. */
const ROWS = new Set(['seated cable row', 'one arm dumbbell row']);

// ── Sharing out the sets ────────────────────────────────────────────

interface Slot {
  day: number;
  order: number;
  name: string;
  reps: RepRange;
  pick: BlueprintRow['pick'];
  /** The favoured half's work on the other half's day: used once that half's own days can take no more. */
  spill: boolean;
  /** Light work for the other half of the body in a plan with no emphasis on it: joins only into room the day's own muscles leave. */
  spare: boolean;
  primary: string;
  /** Sets each muscle is fed by one set of this movement, the designer's own view. */
  feeds: ReadonlyArray<readonly [muscle: string, share: number]>;
  sets: number;
}

function slotsFor(blueprint: ProgramBlueprint, equipment: EquipmentProfile, focus: ProgramFocus): Slot[] {
  return blueprint.days.flatMap((day, dayIndex) => day.rows.flatMap((row, order): Slot[] => {
    const spare = Boolean(row.only && row.only !== focus);
    if (spare && !row.spare) return [];
    const name = equipment === 'dumbbell_only' ? dumbbellName(row) : row.name;
    if (!name) return [];
    const movement = movementByName.get(normalizeExerciseName(name));
    const primary = volumeMuscle(movement?.[0]);
    if (!movement || !primary) throw new Error(`${name} is not in DESIGNER_MOVEMENTS`);
    const secondary = volumeMuscle(movement[1]);
    const feeds: Array<readonly [string, number]> = [[primary, 1]];
    if (secondary && secondary !== primary) feeds.push([secondary, 0.5]);
    // A press is also front-delt work and a row rear-delt work. Counted here
    // only so the plan does not pile direct work on top of them.
    if (primary === 'chest' && movement[2]) feeds.push(['front_delts', 0.5]);
    if (ROWS.has(normalizeExerciseName(name))) feeds.push(['rear_delts', 0.5]);
    const reps = equipment === 'dumbbell_only' && row.dumbbell && typeof row.dumbbell !== 'string' ? row.dumbbell.reps : row.reps;
    return [{ day: dayIndex, order, name, reps, pick: row.pick, spill: row.only === focus, spare, primary, feeds, sets: 0 }];
  }));
}

function fedBy(slot: Slot, muscle: string): number {
  return slot.feeds.find(([fed]) => fed === muscle)?.[1] ?? 0;
}

function shareOut(slots: Slot[], dayCount: number, answers: ProgramDesignAnswers): void {
  const cap = SESSION_SET_CAPS[answers.sessionLength];
  const muscles = [...MAIN_MUSCLES, ...Object.keys(SUPPORT_MUSCLES)];
  const target = new Map(muscles.map((muscle) => [muscle, weeklySetTarget(muscle, answers)]));

  const weekly = (muscle: string) => slots.reduce((sum, slot) => sum + slot.sets * fedBy(slot, muscle), 0);
  const onDay = (muscle: string, day: number) => slots.reduce((sum, slot) => (slot.day === day ? sum + slot.sets * fedBy(slot, muscle) : sum), 0);
  const room = (day: number) => cap - slots.reduce((sum, slot) => (slot.day === day ? sum + slot.sets : sum), 0);

  /**
   * More for `muscle`, short by `short` sets, on one of `rows`: a movement
   * joins at 2 sets, or one already in gets one more. First-choice movements
   * join first. Then a third set, or a second-choice movement, whichever
   * lands on the day with less of this muscle. Then a fourth set, then the
   * third choices, and last the emphasis rows on the other half's days. A
   * muscle one set short gets a set, not another movement.
   */
  const give = (muscle: string, short: number, rows: Slot[]): boolean => {
    // A smaller muscle's movement never takes a main muscle it also trains more than a set past its aim.
    const overfeeds = (slot: Slot, sets: number) => !isMainMuscle(muscle) && slot.feeds.some(([fed, share]) => (
      isMainMuscle(fed) && weekly(fed) + sets * share > target.get(fed)! + 1
    ));
    const fits = (slot: Slot, sets: number) => room(slot.day) >= sets
      && onDay(muscle, slot.day) + sets * fedBy(slot, muscle) <= SESSION_MUSCLE_SETS
      && !overfeeds(slot, sets);
    const home = rows.filter((slot) => !slot.spill);
    const away = rows.filter((slot) => slot.spill);
    const joins = (from: Slot[], pick?: BlueprintRow['pick']) => from
      .filter((slot) => slot.sets === 0 && (pick === undefined || slot.pick === pick) && fits(slot, MOVEMENT_SETS.min))
      .map((slot) => ({ slot, add: MOVEMENT_SETS.min as number }));
    const raises = (from: Slot[], to: number) => from
      .filter((slot) => slot.sets > 0 && slot.sets < to && fits(slot, 1))
      .map((slot) => ({ slot, add: 1 }));
    // A smaller muscle's movement stops at 3 sets.
    const most = isMainMuscle(muscle) ? MOVEMENT_SETS.max : MOVEMENT_SETS.usual;
    const steps = short > 1
      ? [joins(home, 1), [...raises(home, MOVEMENT_SETS.usual), ...joins(home, 2)], raises(home, most), joins(home, 3), joins(away), raises(away, MOVEMENT_SETS.usual)]
      : [joins(home, 1), raises(home, most), joins(home, 2), joins(home, 3), raises(away, MOVEMENT_SETS.usual), joins(away)];
    const moves = steps.find((step) => step.length > 0);
    if (!moves) return false;
    // The day with the least of this muscle, so the week's sets spread over
    // its days; then the day with the most room, so the days stay even.
    const { slot, add } = [...moves].sort((a, b) => (
      onDay(muscle, a.slot.day) - onDay(muscle, b.slot.day)
      || a.add - b.add
      || room(b.slot.day) - room(a.slot.day)
      || a.slot.sets - b.slot.sets
      || a.slot.day - b.slot.day
      || a.slot.order - b.slot.order
    ))[0];
    slot.sets += add;
    return true;
  };

  /** Shares out sets over `open` rows until every muscle has arrived or can take no more. */
  const run = (open: Slot[]) => {
    const done = new Set<string>();
    for (let guard = 0; guard < dayCount * cap + muscles.length; guard += 1) {
      const sets = new Map(muscles.map((muscle) => [muscle, weekly(muscle)]));
      // Whoever is furthest from their aim goes next. A main muscle under the
      // smallest useful dose goes before everyone, and a muscle within half a
      // set of its aim has arrived.
      const turn = (muscle: string) => {
        const have = sets.get(muscle)!;
        if (isMainMuscle(muscle) && have < VOLUME_BAND_EDGES.solidFrom) return have / VOLUME_BAND_EDGES.solidFrom - 1;
        return have / target.get(muscle)! + (SUPPORT_MUSCLES[muscle]?.wait ?? 0);
      };
      const waiting = muscles
        .filter((muscle) => !done.has(muscle) && target.get(muscle)! - sets.get(muscle)! > 0.5)
        .map((muscle) => ({ muscle, turn: turn(muscle) }))
        .sort((a, b) => a.turn - b.turn);
      if (!waiting.length) break;

      let given = false;
      for (const { muscle } of waiting) {
        const short = target.get(muscle)! - sets.get(muscle)!;
        // Its own movements first. A main muscle with none left takes a compound
        // that trains it second, unless that movement's own muscle is already
        // well past its aim.
        const own = open.filter((slot) => slot.primary === muscle);
        const shared = isMainMuscle(muscle)
          ? open.filter((slot) => slot.primary !== muscle && fedBy(slot, muscle) > 0 && sets.get(slot.primary)! < (target.get(slot.primary) ?? 0) * 1.2)
          : [];
        if (give(muscle, short, own) || give(muscle, short, shared)) { given = true; break; }
        done.add(muscle);
      }
      if (!given) break;
    }
  };
  // The day's own work first. Spare rows take what room is left.
  run(slots.filter((slot) => !slot.spare));
  run(slots);

  // A day left with one or two movements, as a beginner's can be when the
  // week is spread over many days, takes another: the one whose muscle is
  // furthest from its aim.
  for (let day = 0; day < dayCount; day += 1) {
    for (let guard = 0; guard < MIN_DAY_MOVEMENTS; guard += 1) {
      if (slots.filter((slot) => slot.day === day && slot.sets > 0).length >= MIN_DAY_MOVEMENTS) break;
      const next = slots
        .filter((slot) => slot.day === day && slot.sets === 0 && room(day) >= MOVEMENT_SETS.min && target.get(slot.primary))
        .sort((a, b) => weekly(a.primary) / target.get(a.primary)! - weekly(b.primary) / target.get(b.primary)! || a.pick - b.pick || a.order - b.order)[0];
      if (!next) break;
      next.sets = MOVEMENT_SETS.min;
    }
  }
}

// ── The plan ────────────────────────────────────────────────────────

function normalizeEquipment(equipment: ProgramDesignAnswers['equipment']): EquipmentProfile {
  return equipment === 'full_gym' ? 'full_gym' : 'dumbbell_only';
}

/** The built-in program for a day count: the one with that many days, or the nearest. */
export function programBlueprintFor(daysPerWeek: number): ProgramBlueprint {
  return [...PROGRAM_BLUEPRINTS].sort((a, b) => (
    Math.abs(a.days.length - daysPerWeek) - Math.abs(b.days.length - daysPerWeek) || a.days.length - b.days.length
  ))[0];
}

/** The program the five answers call for. */
export function designProgram(answers: ProgramDesignAnswers): SplitTemplate {
  const blueprint = programBlueprintFor(answers.daysPerWeek);
  const slots = slotsFor(blueprint, normalizeEquipment(answers.equipment), answers.focus);
  shareOut(slots, blueprint.days.length, answers);

  const days = blueprint.days.map((day, dayIndex) => ({
    day_name: day.name,
    exercises: slots
      .filter((slot) => slot.day === dayIndex && slot.sets > 0)
      .map((slot) => ({ name: slot.name, sets: slot.sets, reps_min: slot.reps[0], reps_max: slot.reps[1] })),
  }));
  return {
    name: blueprint.name,
    description: describeProgram(days, answers),
    days_per_week: days.length,
    days,
  };
}

// ── What the plan says about itself ─────────────────────────────────

/** Sets a week for each muscle as the app counts them, and how many days train each main muscle. */
function programFacts(days: SplitTemplate['days']) {
  const weekly: MuscleSets = new Map();
  const daysTraining = new Map<string, number>();
  for (const day of days) {
    const today: MuscleSets = new Map();
    for (const exercise of day.exercises) addMovementSets(today, designerMovementMuscles(exercise.name), exercise.sets);
    for (const [muscle, sets] of today) {
      weekly.set(muscle, (weekly.get(muscle) ?? 0) + sets);
      if (sets >= 1) daysTraining.set(muscle, (daysTraining.get(muscle) ?? 0) + 1);
    }
  }
  const daySets = days.map((day) => day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0));
  return { weekly, daysTraining, shortest: Math.min(...daySets), longest: Math.max(...daySets) };
}

const TIMES = ['', 'once', 'twice', '3 times', '4 times', '5 times', '6 times'];

function setsPhrase(counts: number[]): string {
  const low = Math.round(Math.min(...counts));
  const high = Math.round(Math.max(...counts));
  if (high - low > 1) return `${low} to ${high} sets each`;
  return `about ${formatSetCount(Math.round(counts.reduce((sum, value) => sum + value, 0) / counts.length))} sets each`;
}

/**
 * How the plan is built, in plain words and from its own numbers: "Planned by
 * sets per muscle: every main muscle twice a week, 8 to 10 sets each.
 * Sessions take 55 to 60 minutes." A new program starts with it as its
 * description.
 */
export function describeProgram(days: SplitTemplate['days'], answers: Pick<ProgramDesignAnswers, 'focus'>): string {
  const { weekly, daysTraining, shortest, longest } = programFacts(days);
  const count = (muscle: string) => weekly.get(muscle) ?? 0;
  const trained = MAIN_MUSCLES.map((muscle) => daysTraining.get(muscle) ?? 0);
  const least = Math.min(...trained);
  const often = least === Math.max(...trained) ? TIMES[least] : `at least ${TIMES[least]}`;

  const upper = MAIN_MUSCLES.filter((muscle) => !LOWER_BODY.has(muscle)).map(count);
  const lower = MAIN_MUSCLES.filter((muscle) => LOWER_BODY.has(muscle)).map(count);
  const mean = (counts: number[]) => formatSetCount(Math.round(counts.reduce((sum, value) => sum + value, 0) / counts.length));
  const sets = answers.focus === 'upper_focus'
    ? ` a week. Upper body leads at about ${mean(upper)} sets for each muscle, and legs hold at about ${mean(lower)}.`
    : answers.focus === 'lower_focus'
      ? ` a week. Legs lead at about ${mean(lower)} sets for each muscle, and upper body holds at about ${mean(upper)}.`
      : ` a week, ${setsPhrase(MAIN_MUSCLES.map(count))}.`;

  const minutesFor = (daySets: number) => Math.round((WARM_UP_MINUTES + daySets * MINUTES_PER_SET) / 5) * 5;
  const minutes = minutesFor(shortest) === minutesFor(longest) ? `about ${minutesFor(longest)}` : `${minutesFor(shortest)} to ${minutesFor(longest)}`;
  return `Planned by sets per muscle: every main muscle ${often}${sets} Sessions take ${minutes} minutes.`;
}
