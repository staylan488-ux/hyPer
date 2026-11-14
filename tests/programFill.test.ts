import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { normalizeExerciseName } from '@/lib/customExercises';
import { MAIN_MUSCLES, dayVolume, plannedMovementSets, programVolume, volumeBand, type MainMuscle } from '@/lib/muscleVolume';
import { designProgram, designerMovementNames, weeklySetTarget, type ProgramDesignAnswers } from '@/lib/programDesigner';
import {
  BEGINNER_STARTING_SETS,
  SESSION_SET_CAPS,
  fillByMuscle,
  fitToLibrary,
  keepCurrentMovements,
  keptExerciseCount,
  thinLine,
  thinMuscles,
  topUpToAim,
} from '@/lib/programFill';
import { guidedDraft } from '@/lib/programQuestions';
import { newDraftDay, newDraftExercise, type DraftDay, type DraftSplit } from '@/lib/splitDraft';
import { templateSplitDraft } from '@/lib/splitDraftSeed';
import type { Exercise } from '@/types';
import { seededLibrary } from './helpers/seededLibrary';

const library = seededLibrary();
const byName = new Map(library.map((exercise) => [exercise.name.toLowerCase(), exercise]));
const lib = (name: string): Exercise => {
  const exercise = byName.get(name.toLowerCase());
  if (!exercise) throw new Error(`${name} is not in the seeded library`);
  return exercise;
};

const daySets = (day: DraftDay) => day.exercises.reduce((sum, exercise) => sum + plannedMovementSets(exercise), 0);
const sets = (draft: DraftSplit, muscle: string) => programVolume(draft).get(muscle) ?? 0;

function draftOf(days: Array<[string, Array<[string, number] | [string, number, Partial<{ reps: [number, number] }>]>]>): DraftSplit {
  return {
    id: 'draft',
    name: 'Test',
    description: null,
    days_per_week: days.length,
    days: days.map(([name, rows], dayIndex) => newDraftDay(name, dayIndex, rows.map(([exercise, count, extra], order) => newDraftExercise(lib(exercise), order, {
      target_sets: count,
      target_sets_min: count,
      target_sets_max: count,
      ...(extra?.reps ? { target_reps_min: extra.reps[0], target_reps_max: extra.reps[1] } : {}),
    })))),
  };
}

const DAYS = [3, 4, 5, 6];
const FOCUSES: ProgramDesignAnswers['focus'][] = ['no_focus', 'upper_focus', 'lower_focus'];
const EQUIPMENT: ProgramDesignAnswers['equipment'][] = ['full_gym', 'dumbbell_only'];
const LENGTHS: ProgramDesignAnswers['sessionLength'][] = ['short', 'moderate', 'long'];
const EXPERIENCE: ProgramDesignAnswers['experience'][] = ['beginner', 'intermediate', 'advanced'];

const ALL_ANSWERS: ProgramDesignAnswers[] = DAYS.flatMap((daysPerWeek) => FOCUSES.flatMap((focus) => EQUIPMENT.flatMap((equipment) => (
  LENGTHS.flatMap((sessionLength) => EXPERIENCE.map((experience) => ({ daysPerWeek, focus, equipment, sessionLength, experience })))
))));

/**
 * Answers allowed to leave a main muscle under solid, with the reason. Empty:
 * every combination fits. A case belongs here only when its days and session
 * length truly cannot hold every main muscle.
 */
const THIN_EXCEPTIONS: Record<string, string> = {};

const key = (answers: ProgramDesignAnswers) => `${answers.daysPerWeek}d ${answers.focus} ${answers.equipment} ${answers.sessionLength} ${answers.experience}`;

describe('every guided plan', () => {
  const plans = ALL_ANSWERS.map((answers) => ({ answers, ...guidedDraft(answers, library) }));

  it('covers all 216 combinations of the five answers', () => {
    expect(plans).toHaveLength(4 * 3 * 2 * 3 * 3);
  });

  it('has every main muscle at least solid, or is a written exception', () => {
    const thin = plans.flatMap(({ answers, draft }) => {
      const low = thinMuscles(draft);
      return low.length && !THIN_EXCEPTIONS[key(answers)] ? [`${key(answers)}: ${low.join(', ')}`] : [];
    });
    expect(thin).toEqual([]);
  });

  it('keeps every session inside the cap for its length', () => {
    const over = plans.flatMap(({ answers, draft }) => draft.days
      .filter((day) => daySets(day) > SESSION_SET_CAPS[answers.sessionLength])
      .map((day) => `${key(answers)} ${day.day_name}: ${daySets(day)}`));
    expect(over).toEqual([]);
  });

  it('never repeats a movement within a day', () => {
    const repeats = plans.flatMap(({ answers, draft }) => draft.days
      .filter((day) => new Set(day.exercises.map((exercise) => exercise.exercise_id)).size !== day.exercises.length)
      .map((day) => `${key(answers)} ${day.day_name}`));
    expect(repeats).toEqual([]);
  });

  it('leaves nothing out against the seeded library and offers no retired movement', () => {
    expect(plans.filter(({ notice }) => notice).map(({ answers, notice }) => `${key(answers)}: ${notice}`)).toEqual([]);
    expect(plans.flatMap(({ draft }) => draft.days.flatMap((day) => day.exercises)).filter((exercise) => exercise.exercise.retired_at)).toEqual([]);
  });

  it('fills dumbbells-only plans with dumbbell and bodyweight movements only', () => {
    const dumbbells = plans.filter(({ answers }) => answers.equipment === 'dumbbell_only');
    const other = dumbbells.flatMap(({ answers, draft }) => draft.days.flatMap((day) => day.exercises
      .filter((exercise) => !['dumbbells', 'bodyweight'].includes(exercise.exercise.equipment ?? ''))
      .map((exercise) => `${key(answers)} ${day.day_name}: ${exercise.exercise.name}`)));
    expect(other).toEqual([]);
    expect(dumbbells.every(({ draft }) => thinMuscles(draft).length === 0)).toBe(true);
  });

  it('builds the day count asked for', () => {
    const wrong = plans
      .filter(({ answers, draft }) => draft.days.length !== answers.daysPerWeek)
      .map(({ answers, draft }) => `${key(answers)}: ${draft.days.length}`);
    expect(wrong).toEqual([]);
  });

  it("keeps a beginner's main muscles near the starting count", () => {
    const beginner = plans.filter(({ answers }) => answers.experience === 'beginner');
    const balanced = beginner.filter(({ answers }) => answers.focus === 'no_focus');
    const counts = balanced.flatMap(({ draft }) => MAIN_MUSCLES.map((muscle) => sets(draft, muscle)));
    // A muscle can sit a little past its aim when its sets also carry another
    // muscle's (a squat's glutes), or a new movement brings 2 sets at once. An
    // emphasis raises the aim of the favoured half.
    for (const { answers, draft } of beginner) {
      for (const muscle of MAIN_MUSCLES) {
        expect(sets(draft, muscle), `${key(answers)} ${muscle}`).toBeLessThanOrEqual(Math.max(BEGINNER_STARTING_SETS, weeklySetTarget(muscle, answers)) + 2);
      }
    }
    expect(counts.reduce((sum, count) => sum + count, 0) / counts.length).toBeLessThanOrEqual(BEGINNER_STARTING_SETS + 0.5);
    const total = (experience: ProgramDesignAnswers['experience']) => plans
      .filter(({ answers }) => answers.experience === experience)
      .reduce((sum, { draft }) => sum + MAIN_MUSCLES.reduce((inner, muscle) => inner + sets(draft, muscle), 0), 0);
    expect(total('beginner')).toBeLessThan(total('intermediate'));
  });
});

describe('the built-in programs', () => {
  it('are solid on every main muscle and inside 60 minutes as designed, so the fill leaves them alone', () => {
    for (const daysPerWeek of DAYS) {
      const answers: ProgramDesignAnswers = { daysPerWeek, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' };
      const template = designProgram(answers);
      const { draft, missing } = templateSplitDraft(template, library);
      expect(missing).toEqual([]);
      expect(thinMuscles(draft), template.name).toEqual([]);
      expect(Math.max(...draft.days.map(daySets)), template.name).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
      expect(fillByMuscle(draft, library, { ...answers, equipment: 'full_gym' }), template.name).toBe(draft);
    }
  });
});

describe('names the builder can emit', () => {
  it('are all in the seeded library and none is retired', () => {
    const names = new Set(library.map((exercise) => normalizeExerciseName(exercise.name)));
    const missing = designerMovementNames().filter((name) => !names.has(normalizeExerciseName(name)));
    expect(missing).toEqual([]);
  });

  it('each have a row of muscles that matches the seed', async () => {
    const { DESIGNER_MOVEMENTS } = await import('@/lib/designerMovements');
    const rows = new Map(Object.entries(DESIGNER_MOVEMENTS).map(([name, row]) => [normalizeExerciseName(name), row]));
    for (const name of designerMovementNames()) {
      const seeded = library.find((exercise) => normalizeExerciseName(exercise.name) === normalizeExerciseName(name))!;
      expect(rows.get(normalizeExerciseName(name)), name).toEqual([seeded.muscle_group, seeded.muscle_group_secondary, seeded.is_compound, seeded.equipment]);
    }
  });

  it('never match a retired row', () => {
    const retired = { ...lib('Lunge'), id: 'retired-lunge', retired_at: '2026-11-11T00:00:00Z' };
    const { draft, missing } = templateSplitDraft(
      { name: 'T', description: '', days_per_week: 1, days: [{ day_name: 'Legs', exercises: [{ name: 'Lunge', sets: 3, reps_min: 8, reps_max: 12 }] }] },
      [retired],
    );
    expect(draft.days[0].exercises).toEqual([]);
    expect(missing).toEqual(['Lunge']);
  });
});

describe('the fill', () => {
  it("leaves a beginner's muscle that sits at the starting count alone, glutes too", () => {
    // Glutes are aimed a little under the others, but 6 sets is the starting count for every main muscle.
    const draft = draftOf([
      ['Upper', [['Flat Dumbbell Bench Press', 4], ['Seated Cable Row', 4], ['Lateral Raise', 4], ['Tricep Pushdown', 3], ['Dumbbell Curl', 3]]],
      ['Lower', [['Leg Press', 4], ['Lying Leg Curl', 4], ['Hip Thrust', 4]]],
    ]);
    expect(sets(draft, 'glutes')).toBe(BEGINNER_STARTING_SETS);
    const filled = fillByMuscle(draft, library, { focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'beginner' });
    expect(filled.days[1].exercises.map((exercise) => exercise.target_sets)).toEqual([4, 4, 4]);
  });

  it('trims a session over its cap from the muscle with the most to spare', () => {
    const draft = draftOf([['Upper', [
      ['Flat Dumbbell Bench Press', 5], ['Seated Cable Row', 5], ['Lat Pulldown', 5], ['Lateral Raise', 4], ['Tricep Pushdown', 4], ['Dumbbell Curl', 4],
    ]], ['Lower', [['Leg Press', 4], ['Lying Leg Curl', 4], ['Hip Thrust', 4]]]]);
    const filled = fillByMuscle(draft, library, { focus: 'no_focus', equipment: 'full_gym', sessionLength: 'short', experience: 'intermediate' });
    expect(daySets(filled.days[0])).toBeLessThanOrEqual(SESSION_SET_CAPS.short);
    // Back had 10 sets, far past solid; it gave up the most.
    expect(sets(filled, 'back')).toBeLessThan(10);
    expect(thinMuscles(filled)).toEqual([]);
  });

  it('raises a movement without a set range to a plain count, and keeps a set range it had', () => {
    const lower: [string, Array<[string, number]>] = ['Lower', [['Leg Press', 4], ['Lying Leg Curl', 4], ['Hip Thrust', 4]]];
    const draft = draftOf([['Upper', [['Flat Dumbbell Bench Press', 4], ['Seated Cable Row', 4], ['Lateral Raise', 2], ['Tricep Pushdown', 3], ['Dumbbell Curl', 3]]], lower]);
    draft.days[0].exercises[2] = { ...draft.days[0].exercises[2], target_sets_min: 2, target_sets_max: 3 };
    const filled = fillByMuscle(draft, library, { focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' });
    const lateral = filled.days[0].exercises[2];
    expect(lateral.target_sets).toBe(4);
    expect([lateral.target_sets_min, lateral.target_sets_max]).toEqual([2, 4]);
    const plain = fillByMuscle(draftOf([['Upper', [['Flat Dumbbell Bench Press', 4], ['Lateral Raise', 2]]], lower]), library, { focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' });
    expect(plain.days[0].exercises.find((exercise) => exercise.exercise.name === 'Lateral Raise')!.target_sets).toBe(4);
    for (const exercise of plain.days[0].exercises) expect([exercise.target_sets_min, exercise.target_sets_max]).toEqual([exercise.target_sets, exercise.target_sets]);
  });

  it('lets the Emphasis answer decide who gets the last room, and names what stays low', () => {
    // One 45-minute full-body day: 11 sets in, room for 2 more, nothing to spare.
    const draft = draftOf([['Full Body', [['Flat Dumbbell Bench Press', 4], ['Seated Cable Row', 4], ['Leg Press', 3]]]]);
    const upper = fillByMuscle(draft, library, { focus: 'upper_focus', equipment: 'full_gym', sessionLength: 'short', experience: 'intermediate' });
    const lower = fillByMuscle(draft, library, { focus: 'lower_focus', equipment: 'full_gym', sessionLength: 'short', experience: 'intermediate' });
    expect(daySets(upper.days[0])).toBeLessThanOrEqual(SESSION_SET_CAPS.short);
    expect(daySets(lower.days[0])).toBeLessThanOrEqual(SESSION_SET_CAPS.short);
    const gained = (filled: DraftSplit, muscles: MainMuscle[]) => muscles.reduce((sum, muscle) => sum + sets(filled, muscle) - sets(draft, muscle), 0);
    expect(gained(upper, ['chest', 'back', 'side_delts', 'biceps', 'triceps'])).toBeGreaterThan(0);
    expect(gained(upper, ['quads', 'hamstrings', 'glutes'])).toBe(0);
    expect(gained(lower, ['quads', 'hamstrings', 'glutes'])).toBeGreaterThan(0);
    expect(gained(lower, ['chest', 'back', 'side_delts', 'biceps', 'triceps'])).toBe(0);

    expect(thinMuscles(upper)).toContain('hamstrings');
    expect(thinLine(thinMuscles(upper), 1, 'short')).toMatch(/hamstrings.* under 4 sets a week: 1 day of 45 minutes leaves no room for more\.$/);
    expect(thinLine(['side_delts', 'biceps'], 3, 'short')).toBe('Side delts and biceps stay under 4 sets a week: 3 days of 45 minutes leave no room for more.');
    expect(thinLine([], 3, 'short')).toBeNull();
  });

  it('names the thin muscles in the plan description', () => {
    const answers: ProgramDesignAnswers = { daysPerWeek: 4, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' };
    expect(guidedDraft(answers, library).draft.description).not.toMatch(/under 4 sets/);
    // A library without any side delt or biceps movement cannot fill them.
    const bare = library.filter((exercise) => !['side_delts', 'biceps'].includes(exercise.muscle_group));
    const { draft } = guidedDraft(answers, bare);
    expect(thinMuscles(draft)).toEqual(expect.arrayContaining(['side_delts']));
    expect(draft.description).toMatch(/Side delts.* under 4 sets a week: 4 days of 60 minutes leave no room for more\.$/);
  });

  it('swaps what a dumbbells-only plan cannot do, and drops what has no swap', () => {
    const draft = draftOf([['Legs', [['Goblet Squat', 3], ['Leg Press', 3], ['Lying Leg Curl', 2]]]]);
    const fitted = fitToLibrary(draft, library, 'dumbbell_only');
    const names = fitted.days[0].exercises.map((exercise) => exercise.exercise.name);
    expect(names[0]).toBe('Goblet Squat');
    expect(fitted.days[0].exercises.every((exercise) => ['dumbbells', 'bodyweight'].includes(exercise.exercise.equipment ?? ''))).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(fitToLibrary(draft, library, 'full_gym')).toBe(draft);
  });
});

describe('keeping the current movements', () => {
  const template = () => draftOf([
    ['Upper A', [['Flat Barbell Bench Press', 3], ['Lat Pulldown', 3], ['Seated Cable Row', 3], ['Lateral Raise', 2], ['Tricep Pushdown', 2], ['Dumbbell Curl', 2]]],
    ['Lower A', [['Barbell Back Squat', 3], ['Romanian Deadlift', 3], ['Leg Extension', 2], ['Leg Curl', 2]]],
  ]);
  const current = () => draftOf([
    ['Push', [['Incline Dumbbell Bench Press', 4, { reps: [6, 10] }], ['Cable Lateral Raise', 3, { reps: [12, 20] }], ['Overhead Tricep Extension', 3]]],
    ['Pull', [['Pull-Up', 3], ['One-Arm Dumbbell Row', 3], ['Hammer Curl', 2]]],
    ['Legs', [['Hack Squat', 3], ['Leg Press', 2], ['Lying Leg Curl', 3], ['Hack Squat', 2]]],
    ['Pull 2', [['Pull-Up', 3]]],
  ]);

  it('fills each slot with a movement of the same muscle and role, most used first, each once a day', () => {
    const kept = keepCurrentMovements(template(), current(), { equipment: 'full_gym' });
    const names = kept.days.map((day) => day.exercises.map((exercise) => exercise.exercise.name));
    expect(names[0]).toEqual([
      'Incline Dumbbell Bench Press', // chest compound
      'Pull-Up', // back compound, 6 sets a week
      'One-Arm Dumbbell Row', // the next back compound; Pull-Up is already in the day
      'Cable Lateral Raise',
      'Overhead Tricep Extension',
      'Hammer Curl',
    ]);
    expect(names[1]).toEqual([
      'Hack Squat', // quads compound, 5 sets a week
      'Romanian Deadlift', // no hamstring compound of theirs: the template's own
      'Leg Extension', // no quads isolation of theirs
      'Lying Leg Curl',
    ]);
    // Their own sets and rep ranges come along.
    const incline = kept.days[0].exercises[0];
    expect([incline.target_sets, incline.target_reps_min, incline.target_reps_max]).toEqual([4, 6, 10]);
    expect(keptExerciseCount(kept, current())).toBe(8);
  });

  it('gives a day of the same name its own movements back', () => {
    const plan = draftOf([['Push', [['Flat Barbell Bench Press', 3], ['Incline Dumbbell Bench Press', 2], ['Lateral Raise', 3]]]]);
    const mine = draftOf([['Push', [['Flat Dumbbell Bench Press', 3], ['Incline Dumbbell Bench Press', 3], ['Cable Lateral Raise', 3], ['Tricep Pushdown', 2]]]]);
    const kept = keepCurrentMovements(plan, mine, { equipment: 'full_gym', maxDaySets: 18 });
    expect(kept.days[0].exercises.map((exercise) => exercise.exercise.name)).toEqual([
      'Flat Dumbbell Bench Press', 'Incline Dumbbell Bench Press', 'Cable Lateral Raise', 'Tricep Pushdown',
    ]);
    // Without room, the extra one stays out.
    expect(keepCurrentMovements(plan, mine, { equipment: 'full_gym', maxDaySets: 9 }).days[0].exercises).toHaveLength(3);
  });

  it('prefers the template movement itself when the program has it', () => {
    const plan = draftOf([['Upper', [['Seated Cable Row', 3], ['Lat Pulldown', 3]]]]);
    const mine = draftOf([['Back', [['One-Arm Dumbbell Row', 4], ['Lat Pulldown', 2]]]]);
    const kept = keepCurrentMovements(plan, mine, { equipment: 'full_gym' });
    expect(kept.days[0].exercises.map((exercise) => exercise.exercise.name)).toEqual(['One-Arm Dumbbell Row', 'Lat Pulldown']);
  });

  it('never takes a retired movement, or a machine into a dumbbells-only plan', () => {
    const mine = current();
    mine.days[0].exercises[0] = { ...mine.days[0].exercises[0], exercise: { ...mine.days[0].exercises[0].exercise, retired_at: '2026-11-11T00:00:00Z' } };
    const kept = keepCurrentMovements(template(), mine, { equipment: 'dumbbell_only' });
    const names = kept.days.flatMap((day) => day.exercises.map((exercise) => exercise.exercise.name));
    expect(names).not.toContain('Incline Dumbbell Bench Press');
    expect(names).not.toContain('Hack Squat');
    expect(names).not.toContain('Cable Lateral Raise');
    expect(names).toContain('Overhead Tricep Extension');
  });

  it('leaves the plan alone with no current program', () => {
    const plan = template();
    expect(keepCurrentMovements(plan, { ...plan, days: [] }, { equipment: 'full_gym' })).toBe(plan);
  });
});

// Sinan's own 6-day program, from the private export (never committed). The
// test only runs where the export is, as a check that a rebuild keeps his
// movements; it is not a plan to offer him.
const EXPORT = process.env.HYPER_PRIVATE_EXPORT ?? '/mnt/project-files/sinan.json';

describe.skipIf(!existsSync(EXPORT))('a real program rebuilt', () => {
  interface ExportRow {
    is_active: boolean; split_name: string; split_day_id: string; day_name: string; day_order: number;
    exercise_id: string; exercise_order: number; target_sets: number; target_reps_min: number; target_reps_max: number;
  }
  interface ExportExercise { id: string; name: string; muscle_group: string; muscle_group_secondary: string | null; equipment: string | null; category: string }

  const data = existsSync(EXPORT)
    ? JSON.parse(readFileSync(EXPORT, 'utf8')) as { program: ExportRow[]; exercises: ExportExercise[]; sets: Array<{ exercise_id: string; completed: boolean }> }
    : { program: [], exercises: [], sets: [] };
  // Library rows are shared, so a seeded name is the same row. The export has no
  // is_compound; the four rows only production has are set by hand.
  const COMPOUND: Record<string, boolean> = { 'chest-supported row': true, 'weighted hyperextension': true, 'hip adduction machine': false, 'weighted decline sit-up': false };
  const exercises = new Map(data.exercises.map((row) => [row.id, byName.get(row.name.toLowerCase()) ?? {
    ...row, muscle_group: row.muscle_group as Exercise['muscle_group'], muscle_group_secondary: row.muscle_group_secondary as Exercise['muscle_group_secondary'],
    is_compound: COMPOUND[row.name.toLowerCase()] ?? false, category: row.category as Exercise['category'],
  }]));
  const fullLibrary = [...library, ...[...exercises.values()].filter((exercise) => !library.includes(exercise))];
  const rows = data.program.filter((row) => row.is_active).sort((a, b) => a.day_order - b.day_order || a.exercise_order - b.exercise_order);
  const days = new Map<string, DraftDay>();
  for (const row of rows) {
    const day = days.get(row.split_day_id) ?? { id: row.split_day_id, day_name: row.day_name, day_order: row.day_order, exercises: [] };
    days.set(row.split_day_id, day);
    const exercise = exercises.get(row.exercise_id)!;
    day.exercises.push(newDraftExercise(exercise, day.exercises.length, {
      target_sets: row.target_sets, target_sets_min: row.target_sets, target_sets_max: row.target_sets,
      target_reps_min: row.target_reps_min, target_reps_max: row.target_reps_max,
    }));
  }
  const current: DraftSplit = { id: 'current', name: rows[0]?.split_name ?? '', description: null, days_per_week: days.size, days: [...days.values()] };
  const mine = new Set(current.days.flatMap((day) => day.exercises.map((exercise) => exercise.exercise_id)));
  // His main movements: the ones in the program he has logged most, 8 finished sets or more.
  const logged = new Map<string, number>();
  for (const set of data.sets) if (set.completed) logged.set(set.exercise_id, (logged.get(set.exercise_id) ?? 0) + 1);
  const main = data.program
    .filter((row) => row.is_active && (logged.get(row.exercise_id) ?? 0) >= 8)
    .map((row) => exercises.get(row.exercise_id)!.id)
    .filter((id, index, all) => all.indexOf(id) === index);

  it.each([4, 6])('keeps his main movements in a %i-day plan, every main muscle solid', (daysPerWeek) => {
    const { draft } = guidedDraft({ daysPerWeek, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' }, fullLibrary, current);
    const used = new Set(draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exercise_id)));
    expect(draft.days).toHaveLength(daysPerWeek);
    expect(main.length).toBeGreaterThanOrEqual(10);
    // At four days of 60 minutes the plan has no overhead press: the chest
    // presses already train the front delts, and the room goes to lateral
    // raises. Six days have the room, and keep his.
    expect(main.filter((id) => !used.has(id)).map((id) => fullLibrary.find((row) => row.id === id)?.name))
      .toEqual(daysPerWeek === 4 ? ['Overhead Dumbbell Press'] : []);
    expect([...mine].filter((id) => used.has(id)).length).toBeGreaterThanOrEqual(daysPerWeek === 6 ? 19 : 14);
    for (const muscle of MAIN_MUSCLES) expect(volumeBand(sets(draft, muscle)), muscle).not.toBe('low');
    expect(Math.max(...draft.days.map(daySets))).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
  });

  it('tops the six-day plan up to the weekly sets a designed plan aims at', () => {
    const answers: ProgramDesignAnswers = { daysPerWeek: 6, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' };
    const { draft } = guidedDraft(answers, fullLibrary, current);
    for (const muscle of MAIN_MUSCLES) expect(sets(draft, muscle), muscle).toBeGreaterThanOrEqual(weeklySetTarget(muscle, answers) - 0.5);
  });
});

describe('topping up a program that keeps the person\'s own movements', () => {
  const balanced = { focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' } as const;
  const rows = (plan: DraftSplit) => plan.days.map((day) => day.exercises.map((exercise) => `${exercise.exercise.name} ${plannedMovementSets(exercise)}`));
  // A six-day push/pull/legs of the person's own, light on biceps and side delts.
  const mine = () => draftOf([
    ['Push A', [['Incline Dumbbell Bench Press', 3], ['Machine Chest Press', 2], ['Cable Lateral Raise', 3], ['Tricep Pushdown', 3]]],
    ['Pull A', [['Seated Cable Row', 3], ['Lat Pulldown', 3], ['Barbell Curl', 2]]],
    ['Legs A', [['Hack Squat', 3], ['Seated Leg Curl', 3], ['Leg Extension', 2], ['Hip Thrust', 2]]],
    ['Push B', [['Flat Dumbbell Bench Press', 3], ['Cable Fly', 2], ['Lateral Raise', 2], ['Overhead Tricep Extension', 3]]],
    ['Pull B', [['One-Arm Dumbbell Row', 3], ['Lat Pulldown', 3], ['Hammer Curl', 2]]],
    ['Legs B', [['Romanian Deadlift', 3], ['Leg Press', 3], ['Lying Leg Curl', 2], ['Leg Extension', 2]]],
  ]);

  it('takes each main muscle to the weekly sets a designed plan aims at, inside the session length', () => {
    const before = mine();
    const after = topUpToAim(before, library, balanced);
    for (const muscle of MAIN_MUSCLES) {
      expect(sets(after, muscle), muscle).toBeGreaterThanOrEqual(weeklySetTarget(muscle, balanced) - 0.5);
      expect(sets(after, muscle), muscle).toBeGreaterThanOrEqual(sets(before, muscle));
    }
    for (const day of after.days) expect(daySets(day)).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
  });

  it('grows the person\'s own movements, never past 4 sets, takes nothing away, and adds only to a day that had nothing for that muscle', () => {
    for (const experience of ['intermediate', 'advanced'] as const) {
      const before = mine();
      const after = topUpToAim(before, library, { ...balanced, experience });
      before.days.forEach((day, dayIndex) => {
        day.exercises.forEach((exercise, at) => {
          const now = after.days[dayIndex].exercises[at];
          expect(now.exercise_id).toBe(exercise.exercise_id);
          expect(plannedMovementSets(now)).toBeGreaterThanOrEqual(plannedMovementSets(exercise));
          expect(plannedMovementSets(now)).toBeLessThanOrEqual(4);
        });
        const had = new Set(day.exercises.map((exercise) => exercise.exercise.muscle_group));
        for (const added of after.days[dayIndex].exercises.slice(day.exercises.length)) {
          expect(had.has(added.exercise.muscle_group), `${day.day_name} ${added.exercise.name}`).toBe(false);
          expect(added.target_sets).toBeGreaterThanOrEqual(2);
        }
      });
    }
    // Side delts had 5 sets on the two push days: the pull days, where the built-in program also trains them, take a raise each.
    const after = topUpToAim(mine(), library, balanced);
    expect(rows(after)[1]).toContain('Machine Lateral Raise 3');
    expect(rows(after)[4]).toContain('Machine Lateral Raise 2');
    expect(sets(after, 'side_delts')).toBe(10);
  });

  it('adds a movement where the built-in program trains that muscle: a curl on a pull day, at 2 sets with its rep range', () => {
    const before = mine();
    // No curls at all: biceps sit at the half sets rows give them.
    before.days[1].exercises = before.days[1].exercises.slice(0, 2);
    before.days[4].exercises = before.days[4].exercises.slice(0, 2);
    const after = topUpToAim(before, library, balanced);
    const curls = after.days.map((day) => day.exercises.filter((exercise) => exercise.exercise.muscle_group === 'biceps'));
    expect(curls.map((day) => day.length)).toEqual([0, 1, 0, 0, 1, 0]);
    // The 6-day program's own curls for those days.
    expect(curls[1][0].exercise.name).toBe('Preacher Curl');
    expect(curls[4][0].exercise.name).toBe('Incline Dumbbell Curl');
    expect([curls[1][0].target_reps_min, curls[1][0].target_reps_max]).toEqual([10, 15]);
    expect([curls[1][0].target_sets_min, curls[1][0].target_sets_max]).toEqual([curls[1][0].target_sets, curls[1][0].target_sets]);
  });

  it('leaves alone a muscle within half a set of its aim, and gives one a set short a set, not a movement', () => {
    const plan = draftOf([
      ['Upper A', [['Flat Dumbbell Bench Press', 4], ['Machine Chest Press', 4], ['Lateral Raise', 4], ['Dumbbell Curl', 4], ['Tricep Pushdown', 4]]],
      ['Upper B', [['Incline Dumbbell Bench Press', 2], ['Cable Lateral Raise', 3], ['Hammer Curl', 3], ['Rope Pushdown', 3]]],
    ]);
    // Chest 10, side delts 7, biceps 7, triceps 7 + 5 from presses = 12.
    const after = topUpToAim(plan, library, { ...balanced, sessionLength: 'long' });
    expect(sets(after, 'chest')).toBe(sets(plan, 'chest'));
    expect(sets(after, 'triceps')).toBe(sets(plan, 'triceps'));
    const cable = draftOf([['Upper A', [['Lateral Raise', 4]]], ['Upper B', [['Cable Lateral Raise', 4]]], ['Upper C', [['Machine Lateral Raise', 1]]]]);
    const topped = topUpToAim(cable, library, { ...balanced, sessionLength: 'long' });
    // 9 of 10: the short movement takes the set.
    expect(topped.days[2].exercises.map((exercise) => `${exercise.exercise.name} ${exercise.target_sets}`)).toContain('Machine Lateral Raise 2');
    expect(topped.days.flatMap((day) => day.exercises).filter((exercise) => exercise.exercise.muscle_group === 'side_delts' || exercise.exercise.muscle_group === 'shoulders')).toHaveLength(3);
  });

  it('never gives one muscle more than 10 sets in a session, and stops at the session length', () => {
    const plan = draftOf([['Arms', [['Barbell Curl', 4], ['Hammer Curl', 4], ['Tricep Pushdown', 4]]], ['Legs', [['Leg Press', 4], ['Lying Leg Curl', 4]]]]);
    const after = topUpToAim(plan, library, { ...balanced, experience: 'advanced', sessionLength: 'long' });
    for (const day of after.days) {
      expect(daySets(day)).toBeLessThanOrEqual(SESSION_SET_CAPS.long);
      for (const muscle of MAIN_MUSCLES) expect(dayVolume(day).get(muscle) ?? 0, `${day.day_name} ${muscle}`).toBeLessThanOrEqual(10);
    }
    const short = topUpToAim(mine(), library, { ...balanced, sessionLength: 'short' });
    for (const day of short.days) expect(daySets(day)).toBeLessThanOrEqual(SESSION_SET_CAPS.short);
  });

  it('aims where the answers say: an emphasis holds the other half back, an advanced lifter goes higher, a beginner stays near 6', () => {
    const answers = (focus: ProgramDesignAnswers['focus'], experience: ProgramDesignAnswers['experience']) => ({ ...balanced, focus, experience });
    const upperFirst = topUpToAim(mine(), library, answers('upper_focus', 'intermediate'));
    const even = topUpToAim(mine(), library, answers('no_focus', 'intermediate'));
    const advanced = topUpToAim(mine(), library, answers('no_focus', 'advanced'));
    const beginner = topUpToAim(mine(), library, answers('no_focus', 'beginner'));
    const start = mine();
    // Legs already sit over an upper emphasis's aim for them: nothing is added there.
    for (const muscle of ['quads', 'hamstrings'] as const) expect(sets(upperFirst, muscle), muscle).toBe(sets(mine(), muscle));
    expect(sets(upperFirst, 'biceps')).toBeGreaterThan(sets(even, 'biceps'));
    expect(sets(advanced, 'quads')).toBeGreaterThan(sets(even, 'quads'));
    // Only side delts sit under a beginner's 6: they take the one set, and nothing else moves.
    expect(sets(beginner, 'side_delts')).toBe(6);
    for (const muscle of MAIN_MUSCLES.filter((entry) => entry !== 'side_delts')) expect(sets(beginner, muscle), muscle).toBe(sets(start, muscle));
  });

  it('is what the builder does with a current program, and not with a plan that is still the designer\'s own', () => {
    const answers: ProgramDesignAnswers = { daysPerWeek: 6, ...balanced };
    const { draft } = guidedDraft(answers, library, mine());
    for (const muscle of MAIN_MUSCLES) expect(sets(draft, muscle), muscle).toBeGreaterThanOrEqual(weeklySetTarget(muscle, answers) - 0.5);
    for (const day of draft.days) expect(daySets(day)).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
    const designed = designProgram(answers);
    expect(guidedDraft(answers, library).draft.days.map((day) => day.exercises.map((exercise) => [exercise.exercise.name, exercise.target_sets])))
      .toEqual(designed.days.map((day) => day.exercises.map((exercise) => [exercise.name, exercise.sets])));
  });
});

describe('a template movement the library lacks', () => {
  const answers: ProgramDesignAnswers = { daysPerWeek: 4, focus: 'no_focus', equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' };
  const without = (names: string[]) => library.filter((exercise) => !names.includes(exercise.name));

  it('keeps its slot for a library movement of the same muscle, and only names what had none', () => {
    const { draft, notice } = guidedDraft(answers, without(['Flat Barbell Bench Press', 'Lateral Raise']));
    const names = draft.days.flatMap((day) => day.exercises.map((exercise) => exercise.exercise.name));
    expect(names).not.toContain('Flat Barbell Bench Press');
    expect(draft.days.flatMap((day) => day.exercises).some((exercise) => exercise.exercise.id.startsWith('stand-in:'))).toBe(false);
    expect(draft.days.find((day) => day.day_name === 'Upper A')!.exercises[0].exercise.muscle_group).toBe('chest');
    expect(notice).toBeNull();
    expect(thinMuscles(draft)).toEqual([]);
  });

  it('gives its slot to the current program’s movement for that muscle', () => {
    const mine = draftOf([['Push', [['Machine Chest Press', 3]]]]);
    const { draft } = guidedDraft(answers, without(['Flat Barbell Bench Press']), mine);
    expect(draft.days.find((day) => day.day_name === 'Upper A')!.exercises[0].exercise.name).toBe('Machine Chest Press');
  });
});
