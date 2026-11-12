import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { normalizeExerciseName } from '@/lib/customExercises';
import { MAIN_MUSCLES, plannedMovementSets, programVolume, volumeBand, type MainMuscle } from '@/lib/muscleVolume';
import { designerMovementNames, recommendProgramTemplate, type ProgramDesignAnswers } from '@/lib/programDesigner';
import {
  BEGINNER_MUSCLE_CEILING,
  SESSION_SET_CAPS,
  fillByMuscle,
  fitToLibrary,
  keepCurrentMovements,
  keptExerciseCount,
  thinLine,
  thinMuscles,
} from '@/lib/programFill';
import { guidedDraft } from '@/lib/programQuestions';
import { newDraftDay, newDraftExercise, type DraftDay, type DraftSplit } from '@/lib/splitDraft';
import { templateSplitDraft } from '@/lib/splitDraftSeed';
import { splitTemplates } from '@/lib/splitTemplates';
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

  it('builds the day count asked for whenever a template has it', () => {
    const wrong = plans
      .filter(({ answers }) => answers.daysPerWeek !== 5)
      .filter(({ answers, draft }) => draft.days.length !== answers.daysPerWeek)
      .map(({ answers, draft }) => `${key(answers)}: ${draft.days.length}`);
    expect(wrong).toEqual([]);
    // No template has 5 days: the 4-day one stays, and the chooser says "4 days a week".
    expect(plans.filter(({ answers }) => answers.daysPerWeek === 5).every(({ draft }) => draft.days.length === 4)).toBe(true);
  });

  it("keeps a beginner's main muscles at the low edge of solid", () => {
    const beginner = plans.filter(({ answers }) => answers.experience === 'beginner');
    const counts = beginner.flatMap(({ draft }) => MAIN_MUSCLES.map((muscle) => sets(draft, muscle)));
    // A muscle can sit a little past the edge when its sets also carry another
    // muscle's (a squat's glutes), or a new movement brings 2 or 3 sets at once.
    for (const { answers, draft } of beginner) {
      for (const muscle of MAIN_MUSCLES) expect(sets(draft, muscle), `${key(answers)} ${muscle}`).toBeLessThanOrEqual(BEGINNER_MUSCLE_CEILING + 2);
    }
    expect(counts.reduce((sum, count) => sum + count, 0) / counts.length).toBeLessThanOrEqual(BEGINNER_MUSCLE_CEILING);
    const total = (experience: ProgramDesignAnswers['experience']) => plans
      .filter(({ answers }) => answers.experience === experience)
      .reduce((sum, { draft }) => sum + MAIN_MUSCLES.reduce((inner, muscle) => inner + sets(draft, muscle), 0), 0);
    expect(total('beginner')).toBeLessThan(total('intermediate'));
  });
});

describe('the seven templates', () => {
  it('reach solid on every main muscle once filled, with sessions inside 60 minutes', () => {
    const before: string[] = [];
    for (const template of splitTemplates) {
      const { draft, missing } = templateSplitDraft(template, library);
      expect(missing).toEqual([]);
      before.push(...thinMuscles(draft).map((muscle) => `${template.name} ${muscle}`));
      const focus = /Upper Focus/.test(template.name) ? 'upper_focus' : /Lower Focus/.test(template.name) ? 'lower_focus' : 'no_focus';
      const filled = fillByMuscle(draft, library, { focus, equipment: 'full_gym', sessionLength: 'moderate', experience: 'intermediate' });
      expect(thinMuscles(filled), template.name).toEqual([]);
      expect(Math.max(...filled.days.map(daySets)), template.name).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
      // A template already solid everywhere and inside the cap is left as it is.
      if (!thinMuscles(draft).length && Math.max(...draft.days.map(daySets)) <= SESSION_SET_CAPS.moderate) expect(filled).toBe(draft);
    }
    // As compiled, 4 of the 7 leave a main muscle low.
    expect(before.length).toBeGreaterThan(0);
  });
});

describe('names the builder can emit', () => {
  it('are all in the seeded library and none is retired', () => {
    const names = new Set(library.map((exercise) => normalizeExerciseName(exercise.name)));
    const missing = designerMovementNames(splitTemplates).filter((name) => !names.has(normalizeExerciseName(name)));
    expect(missing).toEqual([]);
  });

  it('never match a retired row', () => {
    const retired = { ...lib('Lunge'), id: 'retired-lunge', retired_at: '2026-11-11T00:00:00Z' };
    const { draft, missing } = templateSplitDraft(
      { name: 'T', description: '', days_per_week: 1, days: [{ day_name: 'Legs', muscle_groups: ['quads'], exercises: [{ name: 'Lunge', sets: 3, reps_min: 8, reps_max: 12 }] }] },
      [retired],
    );
    expect(draft.days[0].exercises).toEqual([]);
    expect(missing).toEqual(['Lunge']);
  });
});

describe('the fill', () => {
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
    expect(main.filter((id) => !used.has(id)).map((id) => exercises.get(id)?.name)).toEqual([]);
    expect([...mine].filter((id) => used.has(id)).length).toBeGreaterThanOrEqual(daysPerWeek === 6 ? 19 : 15);
    for (const muscle of MAIN_MUSCLES) expect(volumeBand(sets(draft, muscle)), muscle).not.toBe('low');
    expect(Math.max(...draft.days.map(daySets))).toBeLessThanOrEqual(SESSION_SET_CAPS.moderate);
  });
});

describe('template choice', () => {
  it('gives the day count asked for over a template with the right focus', () => {
    for (const focus of FOCUSES) {
      for (const days of [3, 6]) {
        const answers: ProgramDesignAnswers = { daysPerWeek: days, focus, equipment: 'full_gym', sessionLength: 'short', experience: 'beginner' };
        expect(recommendProgramTemplate(splitTemplates, answers).days_per_week, `${days} ${focus}`).toBe(days);
      }
    }
  });

});
