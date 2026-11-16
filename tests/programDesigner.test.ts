import { describe, expect, it } from 'vitest';

import { normalizeExerciseName } from '@/lib/customExercises';
import { MAIN_MUSCLES, addMovementSets, type MuscleSets } from '@/lib/muscleVolume';
import { PROGRAM_BLUEPRINTS } from '@/lib/programBlueprints';
import {
  SESSION_SET_CAPS,
  WEEKLY_SET_TARGETS,
  designProgram,
  designerMovementMuscles,
  designerMovementNames,
  programBlueprintFor,
  weeklySetTarget,
  type ProgramDesignAnswers,
} from '@/lib/programDesigner';
import { guidedDraft } from '@/lib/programQuestions';
import type { SplitTemplate } from '@/types';

import { seededLibrary } from './helpers/seededLibrary';

const base: ProgramDesignAnswers = {
  daysPerWeek: 4,
  focus: 'no_focus',
  equipment: 'full_gym',
  sessionLength: 'moderate',
  experience: 'intermediate',
};

const DAYS = [3, 4, 5, 6];
const FOCUSES = ['no_focus', 'upper_focus', 'lower_focus'] as const;
const EQUIPMENT = ['full_gym', 'dumbbell_only'] as const;
const LENGTHS = ['short', 'moderate', 'long'] as const;
const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;

/** Every set of answers the builder can give: 216. */
const ALL: ProgramDesignAnswers[] = DAYS.flatMap((daysPerWeek) => EQUIPMENT.flatMap((equipment) => FOCUSES.flatMap((focus) => (
  LEVELS.flatMap((experience) => LENGTHS.map((sessionLength) => ({ daysPerWeek, equipment, focus, experience, sessionLength })))
))));
const key = (a: ProgramDesignAnswers) => `${a.daysPerWeek}d ${a.equipment} ${a.focus} ${a.experience} ${a.sessionLength}`;

const library = seededLibrary();
const libraryByName = new Map(library.map((row) => [normalizeExerciseName(row.name), row]));
const LOWER = new Set(['quads', 'hamstrings', 'glutes']);
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function daySets(day: SplitTemplate['days'][number]): number {
  return day.exercises.reduce((sum, exercise) => sum + exercise.sets, 0);
}

/** Weekly sets for each muscle as the app counts them, and the days that train each with a set or more. */
function facts(plan: SplitTemplate) {
  const weekly: MuscleSets = new Map();
  const days = new Map<string, number>();
  for (const day of plan.days) {
    const today: MuscleSets = new Map();
    for (const exercise of day.exercises) addMovementSets(today, designerMovementMuscles(exercise.name), exercise.sets);
    for (const [muscle, sets] of today) {
      weekly.set(muscle, (weekly.get(muscle) ?? 0) + sets);
      if (sets >= 1) days.set(muscle, (days.get(muscle) ?? 0) + 1);
    }
  }
  const sets = (muscle: string) => weekly.get(muscle) ?? 0;
  return { sets, days: (muscle: string) => days.get(muscle) ?? 0, total: plan.days.reduce((sum, day) => sum + daySets(day), 0) };
}

const line = (plan: SplitTemplate) => plan.days.map((day) => (
  `${day.day_name}: ${day.exercises.map((exercise) => `${exercise.name} ${exercise.sets}x${exercise.reps_min}-${exercise.reps_max}`).join(', ')}`
));

describe('the built-in programs', () => {
  it('is one program for each day count the builder offers', () => {
    expect(PROGRAM_BLUEPRINTS.map((blueprint) => [blueprint.days.length, blueprint.name])).toEqual([
      [3, 'Full Body'],
      [4, 'Upper/Lower'],
      [5, 'Upper/Lower + Push/Pull/Legs'],
      [6, 'Push/Pull/Legs'],
    ]);
    expect(PROGRAM_BLUEPRINTS.map((blueprint) => blueprint.days.map((day) => day.name))).toEqual([
      ['Full Body A', 'Full Body B', 'Full Body C'],
      ['Upper A', 'Lower A', 'Upper B', 'Lower B'],
      ['Upper', 'Lower', 'Push', 'Pull', 'Legs'],
      ['Push A', 'Pull A', 'Legs A', 'Push B', 'Pull B', 'Legs B'],
    ]);
  });

  it('gives the day count asked for, and the nearest program for any other', () => {
    for (const daysPerWeek of DAYS) {
      for (const focus of FOCUSES) expect(designProgram({ ...base, daysPerWeek, focus }).days_per_week, `${daysPerWeek} ${focus}`).toBe(daysPerWeek);
    }
    expect(programBlueprintFor(2).name).toBe('Full Body');
    expect(programBlueprintFor(7).name).toBe('Push/Pull/Legs');
  });

  it('never repeats a movement in a day, and never leads two days of a program with the same one', () => {
    for (const blueprint of PROGRAM_BLUEPRINTS) {
      for (const day of blueprint.days) {
        const names = day.rows.map((row) => row.name);
        expect(new Set(names).size, `${blueprint.name} ${day.name}`).toBe(names.length);
      }
      const leads = blueprint.days.map((day) => day.rows[0].name);
      expect(new Set(leads).size, blueprint.name).toBe(leads.length);
    }
  });

  it('uses only movements the seeded library holds, with a dumbbell or bodyweight stand-in where one is named', () => {
    for (const name of designerMovementNames()) expect(libraryByName.has(normalizeExerciseName(name)), name).toBe(true);
    for (const blueprint of PROGRAM_BLUEPRINTS) {
      for (const day of blueprint.days) {
        for (const row of day.rows) {
          const stand = row.dumbbell === undefined ? row.name : row.dumbbell === null ? null : typeof row.dumbbell === 'string' ? row.dumbbell : row.dumbbell.name;
          if (!stand) continue;
          expect(['dumbbells', 'bodyweight'], `${row.name} -> ${stand}`).toContain(libraryByName.get(normalizeExerciseName(stand))?.equipment);
        }
      }
    }
  });
});

describe('a designed plan, for every set of answers', () => {
  const plans = ALL.map((answers) => ({ answers, plan: designProgram(answers) }));

  it('fits every session inside its length', () => {
    for (const { answers, plan } of plans) {
      for (const day of plan.days) expect(daySets(day), `${key(answers)} ${day.day_name}`).toBeLessThanOrEqual(SESSION_SET_CAPS[answers.sessionLength]);
    }
  });

  it('gives each movement 2 to 4 sets, each day 3 movements or more, and no movement twice in a day', () => {
    for (const { answers, plan } of plans) {
      for (const day of plan.days) {
        const names = day.exercises.map((exercise) => exercise.name);
        expect(names.length, `${key(answers)} ${day.day_name}`).toBeGreaterThanOrEqual(3);
        expect(new Set(names).size, `${key(answers)} ${day.day_name}`).toBe(names.length);
        for (const exercise of day.exercises) {
          expect(exercise.sets, `${key(answers)} ${exercise.name}`).toBeGreaterThanOrEqual(2);
          expect(exercise.sets, `${key(answers)} ${exercise.name}`).toBeLessThanOrEqual(4);
          expect(exercise.reps_min, exercise.name).toBeGreaterThanOrEqual(6);
          expect(exercise.reps_max, exercise.name).toBeLessThanOrEqual(20);
        }
      }
    }
  });

  it('trains every main muscle on two days or more, with 4 sets a week or more', () => {
    for (const { answers, plan } of plans) {
      const { sets, days } = facts(plan);
      for (const muscle of MAIN_MUSCLES) {
        expect(sets(muscle), `${key(answers)} ${muscle}`).toBeGreaterThanOrEqual(4);
        expect(days(muscle), `${key(answers)} ${muscle}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('holds a pulldown or pull-up and a row', () => {
    for (const { answers, plan } of plans) {
      const names = plan.days.flatMap((day) => day.exercises.map((exercise) => exercise.name));
      expect(names.some((name) => /pulldown|pull-up|chin-up/i.test(name)), key(answers)).toBe(true);
      expect(names.some((name) => /row/i.test(name)), key(answers)).toBe(true);
    }
  });

  it('keeps a balanced plan balanced', () => {
    for (const { answers, plan } of plans) {
      if (answers.focus !== 'no_focus') continue;
      const { sets } = facts(plan);
      // Muscles that share their days stay within half again of each other.
      const upper = MAIN_MUSCLES.filter((muscle) => !LOWER.has(muscle)).map(sets);
      expect(Math.max(...upper), key(answers)).toBeLessThanOrEqual(1.5 * Math.min(...upper));
      // Across the whole body the gap can be wider: on four short days the legs
      // have two days for three muscles and the upper body two days for five.
      const counts = MAIN_MUSCLES.map(sets);
      expect(Math.max(...counts), key(answers)).toBeLessThanOrEqual(2.2 * Math.min(...counts));
    }
  });

  it('never plans far past a muscle’s aim', () => {
    for (const { answers, plan } of plans) {
      const { sets } = facts(plan);
      // Glutes also get half a set from every squat, lunge and deadlift, so they can run past a low aim.
      for (const muscle of MAIN_MUSCLES.filter((name) => name !== 'glutes')) {
        expect(sets(muscle), `${key(answers)} ${muscle}`).toBeLessThanOrEqual(weeklySetTarget(muscle, answers) + 3);
      }
    }
  });

  it('uses only dumbbells and bodyweight when that is the equipment', () => {
    for (const { answers, plan } of plans) {
      for (const exercise of plan.days.flatMap((day) => day.exercises)) {
        const row = libraryByName.get(normalizeExerciseName(exercise.name));
        expect(row, `${key(answers)} ${exercise.name}`).toBeDefined();
        if (answers.equipment === 'dumbbell_only') expect(['dumbbells', 'bodyweight'], `${key(answers)} ${exercise.name}`).toContain(row?.equipment);
      }
    }
  });

  it('reaches the editor unchanged: nothing left out, nothing added, no muscle named as low', () => {
    for (const { answers, plan } of plans) {
      const { draft, notice } = guidedDraft(answers, library);
      expect(notice, key(answers)).toBeNull();
      expect(draft.description, key(answers)).toBe(plan.description);
      expect(draft.days.map((day) => day.exercises.map((exercise) => [exercise.exercise?.name, exercise.target_sets])), key(answers))
        .toEqual(plan.days.map((day) => day.exercises.map((exercise) => [exercise.name, exercise.sets])));
    }
  });
});

describe('what each answer changes', () => {
  it('experience sets how many sets a week each muscle is aimed at', () => {
    expect(WEEKLY_SET_TARGETS).toEqual({ beginner: 6, intermediate: 10, advanced: 14 });
    for (const daysPerWeek of DAYS) {
      for (const equipment of EQUIPMENT) {
        const totals = LEVELS.map((experience) => facts(designProgram({ ...base, daysPerWeek, equipment, experience, sessionLength: 'long' })).total);
        expect(totals[1], `${daysPerWeek} ${equipment}`).toBeGreaterThan(totals[0]);
        expect(totals[2], `${daysPerWeek} ${equipment}`).toBeGreaterThanOrEqual(totals[1]);
      }
    }
  });

  it('a beginner starts near 6 sets a muscle, whatever the days and the session length', () => {
    for (const answers of ALL.filter((each) => each.experience === 'beginner' && each.focus === 'no_focus')) {
      const counts = MAIN_MUSCLES.map(facts(designProgram(answers)).sets);
      expect(mean(counts), key(answers)).toBeLessThanOrEqual(6.5);
      expect(Math.max(...counts), key(answers)).toBeLessThanOrEqual(8);
    }
  });

  it('an intermediate with the room lands on about 10', () => {
    for (const daysPerWeek of [4, 5, 6]) {
      const counts = MAIN_MUSCLES.map(facts(designProgram({ ...base, daysPerWeek, sessionLength: 'long' })).sets);
      for (const count of counts) {
        expect(count, String(daysPerWeek)).toBeGreaterThanOrEqual(8);
        expect(count, String(daysPerWeek)).toBeLessThanOrEqual(11);
      }
    }
  });

  it('a longer session never holds less, and stops growing once every aim is met', () => {
    for (const answers of ALL.filter((each) => each.sessionLength === 'short')) {
      const [short, moderate, long] = LENGTHS.map((sessionLength) => facts(designProgram({ ...answers, sessionLength })).total);
      expect(moderate, key(answers)).toBeGreaterThanOrEqual(short);
      expect(long, key(answers)).toBeGreaterThanOrEqual(moderate);
    }
    // Six days at 60 minutes already hold an intermediate's week; 75 adds nothing.
    expect(line(designProgram({ ...base, daysPerWeek: 6, sessionLength: 'long' }))).toEqual(line(designProgram({ ...base, daysPerWeek: 6 })));
  });

  it('an emphasis moves sets to that half of the body and keeps the other half above the minimum', () => {
    for (const answers of ALL.filter((each) => each.focus === 'no_focus')) {
      const balanced = facts(designProgram(answers)).sets;
      const upper = facts(designProgram({ ...answers, focus: 'upper_focus' })).sets;
      const lower = facts(designProgram({ ...answers, focus: 'lower_focus' })).sets;
      const top = MAIN_MUSCLES.filter((muscle) => !LOWER.has(muscle));
      const legs = MAIN_MUSCLES.filter((muscle) => LOWER.has(muscle));
      expect(mean(top.map(upper)), key(answers)).toBeGreaterThan(mean(legs.map(upper)));
      expect(mean(legs.map(lower)), key(answers)).toBeGreaterThan(mean(top.map(lower)));
      expect(mean(top.map(upper)), key(answers)).toBeGreaterThanOrEqual(mean(top.map(balanced)));
      expect(mean(legs.map(lower)), key(answers)).toBeGreaterThanOrEqual(mean(legs.map(balanced)));
    }
  });

  it('an emphasis fills that half’s own days before it borrows the others', () => {
    // Six days at 60 minutes: the push and pull days have the room, so leg days stay leg days.
    const upper = designProgram({ ...base, daysPerWeek: 6, focus: 'upper_focus' });
    for (const day of upper.days.filter((each) => each.day_name.startsWith('Legs'))) {
      for (const exercise of day.exercises) expect(['chest', 'back', 'side_delts', 'biceps', 'triceps'], exercise.name).not.toContain(designerMovementMuscles(exercise.name)?.muscle_group);
    }
    // Four days at 45 minutes: the upper days are full, so the leg days take the rest.
    const tight = designProgram({ ...base, focus: 'upper_focus', sessionLength: 'short' });
    const borrowed = tight.days.filter((day) => day.day_name.startsWith('Lower')).flatMap((day) => day.exercises.map((exercise) => designerMovementMuscles(exercise.name)?.muscle_group));
    expect(borrowed).toContain('back');
  });

  it('the old equipment answers still mean dumbbells', () => {
    const dumbbells = line(designProgram({ ...base, equipment: 'dumbbell_only' }));
    expect(line(designProgram({ ...base, equipment: 'minimal' }))).toEqual(dumbbells);
    expect(line(designProgram({ ...base, equipment: 'limited_gym' }))).toEqual(dumbbells);
  });
});

describe('the plans as written', () => {
  it('four days, 60 minutes, intermediate, balanced, full gym', () => {
    const plan = designProgram(base);
    expect(plan.name).toBe('Upper/Lower');
    expect(line(plan)).toEqual([
      'Upper A: Flat Barbell Bench Press 3x6-10, Seated Cable Row 4x8-12, Cable Fly 2x10-15, Lateral Raise 4x12-20, Cable Overhead Tricep Extension 3x10-15, Preacher Curl 2x10-15',
      'Lower A: Barbell Back Squat 3x6-10, Seated Leg Curl 3x10-15, Leg Extension 2x10-15, 45° Back Extension 2x10-15, Standing Calf Raise 3x10-15, Cable Crunch 2x10-15, Machine Lateral Raise 2x12-20',
      'Upper B: Lat Pulldown 3x8-12, Incline Dumbbell Bench Press 3x8-12, One-Arm Dumbbell Row 2x8-12, Machine Chest Press 2x8-12, Cable Lateral Raise 4x12-20, Tricep Pushdown 2x10-15, Incline Dumbbell Curl 2x10-15',
      'Lower B: Romanian Deadlift 3x6-10, Leg Press 3x8-12, Hip Thrust 2x8-12, Lying Leg Curl 2x10-15, Leg Extension 2x10-15, Leg Press Calf Raise 3x10-15, Hanging Leg Raise 2x10-15',
    ]);
    expect(plan.description).toBe('Planned by sets per muscle: every main muscle at least twice a week, about 9 sets each. Sessions take 55 to 60 minutes.');
  });

  it('says what an emphasis did, in its own numbers', () => {
    expect(designProgram({ ...base, focus: 'upper_focus' }).description)
      .toBe('Planned by sets per muscle: every main muscle at least twice a week. Upper body leads at about 12 sets for each muscle, and legs hold at about 7. Sessions take about 60 minutes.');
    expect(designProgram({ ...base, daysPerWeek: 3, focus: 'lower_focus' }).description)
      .toBe('Planned by sets per muscle: every main muscle 3 times a week. Legs lead at about 10 sets for each muscle, and upper body holds at about 7. Sessions take about 60 minutes.');
  });

  it('three days is full body, five is upper, lower, push, pull, legs', () => {
    expect(designProgram({ ...base, daysPerWeek: 3 }).days.map((day) => day.exercises[0].name)).toEqual(['Barbell Back Squat', 'Romanian Deadlift', 'Seated Cable Row']);
    const five = designProgram({ ...base, daysPerWeek: 5 });
    expect(five.name).toBe('Upper/Lower + Push/Pull/Legs');
    expect(five.days.map((day) => day.exercises[0].name)).toEqual([
      'Flat Barbell Bench Press', 'Barbell Back Squat', 'Incline Barbell Bench Press', 'Seated Cable Row', 'Romanian Deadlift',
    ]);
  });
});
