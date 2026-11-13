import { describe, expect, it } from 'vitest';

import { MAIN_MUSCLES, programVolume, volumeBand } from '@/lib/muscleVolume';
import { newDraftDay, newDraftExercise, type DraftSplit } from '@/lib/splitDraft';
import { templateSplitDraft } from '@/lib/splitDraftSeed';
import { splitTemplates } from '@/lib/splitTemplates';
import {
  MAX_SUGGESTED_SETS,
  SUGGESTED_MOVEMENTS,
  applyAllVolumeSuggestions,
  applyVolumeSuggestion,
  volumeSuggestions,
} from '@/lib/volumeSuggestions';
import type { Exercise } from '@/types';

import { seededLibrary } from './helpers/seededLibrary';

const library = seededLibrary();
const byName = (name: string): Exercise => {
  const found = library.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`${name} is not in the seeded library`);
  return found;
};

function draft(days: Array<{ name: string; moves: Array<[string, number, string?]> }>): DraftSplit {
  return {
    id: 'draft',
    name: 'Test',
    description: null,
    days_per_week: days.length,
    days: days.map((entry, dayIndex) => newDraftDay(entry.name, dayIndex, entry.moves.map(([name, sets, superset], order) => (
      newDraftExercise(byName(name), order, { target_sets: sets, target_sets_min: sets, target_sets_max: sets, superset_group_id: superset ?? null })
    )))),
  };
}

function lowMain(program: DraftSplit): string[] {
  const sets = programVolume(program);
  return MAIN_MUSCLES.filter((muscle) => volumeBand(sets.get(muscle) ?? 0) === 'low');
}

const PUSH_PULL = draft([
  { name: 'Push A', moves: [['Incline Dumbbell Bench Press', 4], ['Cable Lateral Raise', 2], ['Tricep Pushdown', 3]] },
  { name: 'Pull A', moves: [['Lat Pulldown', 3], ['Seated Cable Row', 3], ['Dumbbell Curl', 3]] },
  { name: 'Legs A', moves: [['Leg Press', 4], ['Lying Leg Curl', 4], ['Hip Thrust', 4]] },
]);

describe('the seeded library', () => {
  it('holds every movement a suggestion can name, none retired', () => {
    const names = new Set(library.map((exercise) => exercise.name));
    for (const [muscle, movements] of Object.entries(SUGGESTED_MOVEMENTS)) {
      for (const name of movements) {
        expect(names.has(name), `${name} (${muscle})`).toBe(true);
        expect(byName(name).category, name).not.toBe('calisthenics');
      }
    }
  });

  it("lists each muscle's own movements", () => {
    for (const [muscle, movements] of Object.entries(SUGGESTED_MOVEMENTS)) {
      for (const name of movements) expect(byName(name).muscle_group, name).toBe(muscle);
    }
  });
});

describe('suggestions', () => {
  it('raises a movement the program already has for the low muscle, past the floor: as far as one movement goes', () => {
    const [first, ...rest] = volumeSuggestions(PUSH_PULL, library);
    expect(rest).toEqual([]);
    expect(first).toMatchObject({
      kind: 'raise', muscle: 'side_delts', dayName: 'Push A', exerciseName: 'Cable Lateral Raise',
      fromSets: 2, toSets: 5, setsBefore: 2, setsAfter: 5, title: 'Add 3 sets to Cable Lateral Raise on Push A',
    });
  });

  it('speaks up only under the floor: a muscle at 4 or more gets nothing unless asked', () => {
    const program = draft([{ name: 'Upper', moves: [['Lateral Raise', 4]] }]);
    expect(volumeSuggestions(program, library).some((entry) => entry.muscle === 'side_delts')).toBe(false);
    // The builder asks, to fill toward the aim.
    const asked = volumeSuggestions(program, library, { under: 10 }).find((entry) => entry.muscle === 'side_delts');
    expect(asked).toMatchObject({ kind: 'raise', fromSets: 4, toSets: 5 });
  });

  it('stops at the aim it is given', () => {
    const [first] = volumeSuggestions(PUSH_PULL, library, { aim: 4 });
    expect(first).toMatchObject({ fromSets: 2, toSets: 4, title: 'Add 2 sets to Cable Lateral Raise on Push A' });
  });

  it('past the floor, a new movement joins only a day that already trains that half of the body', () => {
    const program = draft([{ name: 'Legs', moves: [['Leg Press', 4], ['Lying Leg Curl', 4], ['Hip Thrust', 4]] }]);
    expect(volumeSuggestions(program, library).some((entry) => entry.muscle === 'chest')).toBe(true);
    expect(volumeSuggestions(program, library, { under: 10, ownRegionOnly: true }).some((entry) => entry.muscle === 'chest')).toBe(false);
  });

  it('says "a set" for one', () => {
    const program = draft([{ name: 'Upper', moves: [['Lateral Raise', 3]] }]);
    const raise = volumeSuggestions(program, library, { aim: 4 }).find((entry) => entry.muscle === 'side_delts');
    expect(raise?.title).toBe('Add a set to Lateral Raise on Upper');
  });

  it('never raises a movement past 5 sets, and adds one from the library instead', () => {
    const program = draft([
      { name: 'Upper A', moves: [['Barbell Curl', 3], ['Seated Cable Row', 4]] },
      { name: 'Upper B', moves: [['Lat Pulldown', 2]] },
    ]);
    // Side delts: none, so a movement is added, on cables like the rest of the program.
    const side = volumeSuggestions(program, library).find((entry) => entry.muscle === 'side_delts');
    expect(side).toMatchObject({ kind: 'add', sets: 3, dayName: 'Upper B', title: 'Add 3 sets of Cable Lateral Raise to Upper B' });

    const capped = draft([{ name: 'Arms', moves: [['Tricep Pushdown', MAX_SUGGESTED_SETS], ['Leg Press', 4]] }]);
    capped.days[0].exercises[0].target_sets = 3;
    const raise = volumeSuggestions(capped, library).find((entry) => entry.muscle === 'triceps');
    expect(raise?.kind).toBe('raise');
    const full = draft([{ name: 'Arms', moves: [['Tricep Pushdown', 3]] }]);
    full.days[0].exercises[0].target_sets = MAX_SUGGESTED_SETS;
    expect(volumeSuggestions(full, library).some((entry) => entry.muscle === 'triceps')).toBe(false);
  });

  it('adds to the lightest day that already trains that part of the body', () => {
    const program = draft([
      { name: 'Upper A', moves: [['Incline Dumbbell Bench Press', 4], ['Seated Cable Row', 4]] },
      { name: 'Lower A', moves: [['Leg Press', 2]] },
      { name: 'Upper B', moves: [['Lat Pulldown', 3]] },
    ]);
    const biceps = volumeSuggestions(program, library).find((entry) => entry.muscle === 'side_delts');
    expect(biceps).toMatchObject({ kind: 'add', dayName: 'Upper B' });
    const hamstrings = volumeSuggestions(program, library).find((entry) => entry.muscle === 'hamstrings');
    expect(hamstrings).toMatchObject({ kind: 'add', dayName: 'Lower A', title: 'Add 3 sets of Lying Leg Curl to Lower A' });
  });

  it('prefers equipment the program already uses', () => {
    const dumbbells = draft([{ name: 'Day 1', moves: [['Incline Dumbbell Bench Press', 4], ['One-Arm Dumbbell Row', 4], ['Goblet Squat', 4]] }]);
    const triceps = volumeSuggestions(dumbbells, library).find((entry) => entry.muscle === 'triceps');
    expect(triceps).toMatchObject({ kind: 'add' });
    expect(triceps?.kind === 'add' && triceps.exercise.equipment).toBe('dumbbells');
  });

  it('puts the most needed first', () => {
    const program = draft([{ name: 'Upper', moves: [['Incline Dumbbell Bench Press', 4], ['Seated Cable Row', 4], ['Lateral Raise', 3]] }]);
    const order = volumeSuggestions(program, library).map((entry) => entry.muscle);
    expect(order.slice(0, 3)).toEqual(['quads', 'hamstrings', 'glutes']);
    expect(order.at(-1)).toBe('side_delts');
  });

  it('suggests nothing for a muscle that is not a main one', () => {
    const program = draft([{ name: 'Day', moves: [['Calf Raise', 1], ['Face Pull', 1], ['Plank', 1]] }]);
    const muscles = volumeSuggestions(program, library).map((entry) => entry.muscle);
    for (const muscle of muscles) expect(MAIN_MUSCLES as readonly string[]).toContain(muscle);
  });

  it('a movement whose muscle the app does not know is counted and never suggested', () => {
    const odd: Exercise = { ...byName('Dumbbell Curl'), id: 'odd', name: 'Wrist Roller', muscle_group: 'forearms' as Exercise['muscle_group'] };
    const program = draft([{ name: 'Arms', moves: [['Dumbbell Curl', 4]] }]);
    program.days[0].exercises.push(newDraftExercise(odd, 1, { target_sets: 2 }));
    expect(programVolume(program).get('forearms')).toBe(2);
    expect(volumeSuggestions(program, library).some((entry) => (entry.muscle as string) === 'forearms')).toBe(false);
  });

  it('counts supersets by each member and raises within one', () => {
    const program = draft([
      { name: 'Upper', moves: [['Dumbbell Curl', 2, 'g'], ['Tricep Pushdown', 2, 'g'], ['Incline Dumbbell Bench Press', 4], ['Straight-Arm Pulldown', 4], ['Lateral Raise', 4]] },
    ]);
    const after = applyVolumeSuggestion(program, volumeSuggestions(program, library).find((entry) => entry.muscle === 'biceps')!);
    const curl = after.days[0].exercises.find((entry) => entry.exercise.name === 'Dumbbell Curl');
    expect(curl).toMatchObject({ superset_group_id: 'g', target_sets: 5, target_sets_max: 5 });
  });

  it('nothing to suggest for a program with no days or no library', () => {
    expect(volumeSuggestions({ ...PUSH_PULL, days: [] }, library)).toEqual([]);
    const program = draft([{ name: 'Upper', moves: [['Incline Dumbbell Bench Press', 4]] }]);
    expect(volumeSuggestions(program, []).every((entry) => entry.kind === 'raise')).toBe(true);
  });
});

describe('applying suggestions', () => {
  it('is pure: the draft passed in is untouched', () => {
    const before = JSON.stringify(PUSH_PULL);
    const [first] = volumeSuggestions(PUSH_PULL, library);
    const after = applyVolumeSuggestion(PUSH_PULL, first);
    expect(JSON.stringify(PUSH_PULL)).toBe(before);
    expect(after).not.toBe(PUSH_PULL);
    expect(after.days[0].exercises[1]).toMatchObject({ target_sets: 5, target_sets_min: 2, target_sets_max: 5 });
    expect(after.days[1]).toBe(PUSH_PULL.days[1]);
    expect(volumeSuggestions(after, library)).toEqual([]);
  });

  it('adds a new movement at the end of its day', () => {
    const program = draft([{ name: 'Upper', moves: [['Incline Dumbbell Bench Press', 4], ['Seated Cable Row', 4]] }]);
    const add = volumeSuggestions(program, library).find((entry) => entry.muscle === 'side_delts')!;
    const after = applyVolumeSuggestion(program, add);
    const added = after.days[0].exercises.at(-1)!;
    expect(added).toMatchObject({ exercise_order: 2, target_sets: 3, _isNew: true });
    expect(added.exercise.name).toBe('Lateral Raise');
  });

  it('a stale suggestion changes nothing', () => {
    const [first] = volumeSuggestions(PUSH_PULL, library);
    const applied = applyVolumeSuggestion(PUSH_PULL, first);
    expect(applyVolumeSuggestion(applied, first)).toBe(applied);
    expect(applyVolumeSuggestion({ ...PUSH_PULL, days: [] }, first).days).toEqual([]);
  });

  it('a one-day program ends with every main muscle solid', () => {
    const one = draft([{ name: 'Full body', moves: [['Goblet Squat', 3]] }]);
    const filled = applyAllVolumeSuggestions(one, library);
    expect(lowMain(filled)).toEqual([]);
    expect(volumeSuggestions(filled, library)).toEqual([]);
    for (const exercise of filled.days[0].exercises) expect(exercise.target_sets).toBeLessThanOrEqual(MAX_SUGGESTED_SETS);
  });

  it('empty days fill up, and a program with no days is left alone', () => {
    const blank: DraftSplit = { ...PUSH_PULL, days: [newDraftDay('Day 1', 0), newDraftDay('Day 2', 1)] };
    expect(lowMain(applyAllVolumeSuggestions(blank, library))).toEqual([]);
    const none: DraftSplit = { ...PUSH_PULL, days: [] };
    expect(applyAllVolumeSuggestions(none, library)).toBe(none);
  });

  it("every built-in program ends with every main muscle solid", () => {
    expect(splitTemplates).toHaveLength(7);
    const before: Record<string, string[]> = {};
    for (const template of splitTemplates) {
      const { draft: program, missing } = templateSplitDraft(template, library);
      expect(missing, template.name).toEqual([]);
      before[template.name] = lowMain(program);
      const filled = applyAllVolumeSuggestions(program, library);
      expect(lowMain(filled), template.name).toEqual([]);
      expect(volumeSuggestions(filled, library), template.name).toEqual([]);
    }
    // The templates as written leave some main muscles low; the builder piece fixes that.
    expect(Object.values(before).flat().length).toBeGreaterThan(0);
  });
});
