import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { movementProfile } from '@/lib/movementProfiles';
import { SWAP_MATCH_LIMIT, SWAP_NOTES, suggestSwaps, swapNoteLine } from '@/lib/swapSuggestions';
import type { Exercise, MuscleGroup } from '@/types';

const root = join(__dirname, '..');
const ROW = /^\s*\('((?:[^']|'')+)', '(\w+)', (NULL|'\w+'), '([^']+)', (true|false)(?:, '(\w+)')?\)/gm;

/** The shared library a fresh database holds: the schema's seed and the two library migrations. */
function seededLibrary(): Exercise[] {
  const byName = new Map<string, Exercise>();
  for (const file of [
    'supabase/schema.sql',
    'supabase/migrations/20261012120000_add_exercise_category_and_gym_staples.sql',
    'supabase/migrations/20261111110000_curate_exercise_library.sql',
  ]) {
    for (const [, rawName, muscle, secondary, equipment, compound, category] of readFileSync(join(root, file), 'utf8').matchAll(ROW)) {
      const name = rawName.replace(/''/g, "'");
      if (byName.has(name.toLowerCase())) continue;
      byName.set(name.toLowerCase(), {
        id: `seed-${name.toLowerCase()}`,
        name,
        muscle_group: muscle as MuscleGroup,
        muscle_group_secondary: secondary === 'NULL' ? null : (secondary.slice(1, -1) as MuscleGroup),
        equipment,
        is_compound: compound === 'true',
        category: (category as Exercise['category']) ?? 'gym',
      });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const library = seededLibrary();
const named = (name: string): Exercise => {
  const found = library.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`${name} is not in the seeded library`);
  return found;
};
const custom = (name: string, equipment: string | null = null): Exercise => ({
  id: `custom-${name}`, name, muscle_group: 'chest', muscle_group_secondary: null, equipment, is_compound: false,
});
const swaps = (name: string) => suggestSwaps(named(name), library);
const names = (name: string) => swaps(name).matches.map((match) => match.exercise.name);
const lineFor = (from: string, to: string) => swaps(from).matches.find((match) => match.exercise.name === to)?.line;

describe('movementProfile', () => {
  it('places every gym movement of the seeded library', () => {
    expect(library.length).toBeGreaterThan(90);
    const unplaced = library.filter((exercise) => exercise.category !== 'calisthenics' && !movementProfile(exercise));
    expect(unplaced.map((exercise) => exercise.name)).toEqual([]);
  });

  it.each([
    ['Pallof Press', 'rotation'],
    ['Leg Press Calf Raise', 'calf_raise'],
    ['Seated Calf Raise', 'calf_raise_seated'],
    ['Reverse Pec Deck', 'rear_fly'],
    ['Pec Deck / Machine Fly', 'fly'],
    ['Low-to-High Cable Fly', 'fly_incline'],
    ['Romanian Deadlift', 'hinge'],
    ['Trap Bar Deadlift', 'deadlift'],
    ['Bulgarian Split Squat', 'lunge'],
    ['Hack Squat', 'squat'],
    ['Leg Extension', 'knee_extension'],
    ['45° Back Extension', 'back_extension'],
    ['Weighted Hyperextension', 'back_extension'],
    ['Cable Glute Kickback', 'glute_kickback'],
    ['Tricep Kickback', 'triceps_pushdown'],
    ['Cable Overhead Tricep Extension', 'triceps_overhead'],
    ['Skull Crushers', 'triceps_lying'],
    ['Close-Grip Bench Press', 'press_close_grip'],
    ['Close-Grip Lat Pulldown', 'pull_vertical'],
    ['Straight-Arm Pulldown', 'straight_arm_pulldown'],
    ['Upright Row', 'upright_row'],
    ['Chest-Supported Row', 'row'],
    ['T-Bar Row', 'row'],
    ['Incline Dumbbell Curl', 'curl'],
    ['Rope Hammer Curl', 'curl_hammer'],
    ['Hip Adduction Machine', 'hip_adduction'],
    ['Hip Abduction Machine', 'hip_abduction'],
    ['Arnold Press', 'press_overhead'],
    ['Incline Smith Machine Bench Press', 'press_incline'],
    ['Push-Up', 'press_flat'],
    ['Hanging Leg Raise', 'leg_raise'],
  ] as const)('%s is a %s', (name, pattern) => {
    expect(movementProfile({ name, equipment: null })?.pattern).toBe(pattern);
  });

  it('has no profile for a name it cannot place', () => {
    for (const name of ['Sled Push', "Farmer's Walk", 'Wrist Curl', 'My Thing']) {
      expect(movementProfile({ name, equipment: null })).toBeNull();
    }
  });

  it('reads the equipment from the library, then from the name', () => {
    expect(movementProfile(named('Smith Machine Squat'))?.equipment).toBe('smith');
    expect(movementProfile(named('Goblet Squat'))?.equipment).toBe('dumbbell');
    expect(movementProfile({ name: 'Machine Row', equipment: null })?.equipment).toBe('machine');
    expect(movementProfile({ name: 'Lat Pulldown', equipment: null })?.equipment).toBe('cable');
    expect(movementProfile({ name: 'Dips', equipment: 'bodyweight' })?.equipment).toBe('bodyweight');
  });

  it('knows where the muscle is long: seated curl, overhead extension, standing calf raise', () => {
    expect(movementProfile(named('Seated Leg Curl'))?.length).toBe(1);
    expect(movementProfile(named('Lying Leg Curl'))?.length).toBe(0);
    expect(movementProfile(named('Overhead Tricep Extension'))?.length).toBe(1);
    expect(movementProfile(named('Tricep Pushdown'))?.length).toBe(0);
    expect(movementProfile(named('Incline Dumbbell Curl'))?.length).toBe(1);
    expect(movementProfile(named('Dumbbell Curl'))?.length).toBe(0.5);
  });

  it('marks what loads the lower back, and what is hard to load', () => {
    expect(movementProfile(named('Barbell Back Squat'))?.loadsLowerBack).toBe(true);
    expect(movementProfile(named('Hack Squat'))?.loadsLowerBack).toBe(false);
    expect(movementProfile(named('Leg Press'))?.loadsLowerBack).toBe(false);
    expect(movementProfile(named('Barbell Row'))?.loadsLowerBack).toBe(true);
    expect(movementProfile(named('Seated Cable Row'))?.loadsLowerBack).toBe(false);
    expect(movementProfile(named('Goblet Squat'))?.hardToLoad).toBe(true);
    expect(movementProfile(named('Push-Up'))?.hardToLoad).toBe(true);
    expect(movementProfile(named('Pull-Up'))?.hardToLoad).toBe(false);
    expect(movementProfile(named('Dips'))?.hardToLoad).toBe(false);
  });
});

describe('suggestSwaps', () => {
  it('leads a barbell back squat with the squats and presses that train the same muscles', () => {
    expect(names('Barbell Back Squat')).toEqual(['Hack Squat', 'Smith Machine Squat', 'Front Squat', 'Leg Press', 'Bulgarian Split Squat']);
    expect(lineFor('Barbell Back Squat', 'Hack Squat')).toBe('Same movement · machine, easier on the lower back');
    expect(lineFor('Barbell Back Squat', 'Smith Machine Squat')).toBe('Same movement · Smith machine');
    expect(lineFor('Barbell Back Squat', 'Front Squat')).toBe('Same movement');
    expect(lineFor('Barbell Back Squat', 'Leg Press')).toBe('Same muscles · machine, easier on the lower back');
    expect(lineFor('Barbell Back Squat', 'Bulgarian Split Squat')).toBe('Same muscles · dumbbells, one side at a time');
    expect(swaps('Barbell Back Squat').note).toBe(SWAP_NOTES.machines);
  });

  it('never calls a leg extension or a hip thrust a match for a squat', () => {
    const all = suggestSwaps(named('Barbell Back Squat'), library, 50).matches.map((match) => match.exercise.name);
    expect(all).not.toContain('Leg Extension');
    expect(all).not.toContain('Hip Thrust');
    expect(all).not.toContain('Trap Bar Deadlift');
    expect(all).toContain('Pendulum Squat');
    expect(all).toContain('Goblet Squat');
  });

  it('says what a goblet squat and a push-up cost', () => {
    const squat = suggestSwaps(named('Barbell Back Squat'), library, 50).matches.find((match) => match.exercise.name === 'Goblet Squat');
    expect(squat?.line).toBe('Same movement · dumbbells, hard to load heavy');
    expect(lineFor('Flat Barbell Bench Press', 'Push-Up')).toBe('Same movement · bodyweight, hard to load heavy');
  });

  it('names the nearest few for a leg extension, and what they miss', () => {
    const { matches, note } = swaps('Leg Extension');
    expect(matches.map((match) => match.exercise.name)).toEqual(['Hack Squat', 'Smith Machine Squat', 'Barbell Back Squat']);
    expect(matches.every((match) => match.line.startsWith('No rectus femoris'))).toBe(true);
    expect(note).toBe(SWAP_NOTES.kneeExtension);
  });

  it('keeps the hamstrings long: the seated curl leads for a lying curl', () => {
    expect(names('Lying Leg Curl')[0]).toBe('Seated Leg Curl');
    expect(lineFor('Lying Leg Curl', 'Seated Leg Curl')).toBe('Same movement · more stretch');
    expect(lineFor('Seated Leg Curl', 'Lying Leg Curl')).toBe('Same movement · less stretch');
    expect(lineFor('Seated Leg Curl', 'Romanian Deadlift')).toBe('Adds glutes · barbell');
    expect(swaps('Seated Leg Curl').note).toBe(SWAP_NOTES.legCurl);
  });

  it('puts overhead extensions ahead of other triceps work for a pushdown', () => {
    const picked = names('Tricep Pushdown');
    expect(picked.slice(0, 3).sort()).toEqual(['Cable Overhead Tricep Extension', 'Overhead Tricep Extension', 'Rope Pushdown']);
    expect(picked.indexOf('Overhead Tricep Extension')).toBeLessThan(picked.indexOf('Skull Crushers'));
    expect(lineFor('Tricep Pushdown', 'Overhead Tricep Extension')).toBe('Same muscles · dumbbells, more stretch');
    expect(swaps('Tricep Pushdown').note).toBe(SWAP_NOTES.triceps);
  });

  it('matches presses to presses, and says when the upper chest is lost', () => {
    expect(names('Flat Barbell Bench Press').slice(0, 3)).toEqual(['Machine Chest Press', 'Smith Machine Bench Press', 'Flat Dumbbell Bench Press']);
    expect(names('Incline Barbell Bench Press').slice(0, 3)).toEqual(['Incline Machine Chest Press', 'Incline Smith Machine Bench Press', 'Incline Dumbbell Bench Press']);
    expect(lineFor('Incline Barbell Bench Press', 'Flat Barbell Bench Press')).toBe('Less upper chest');
    expect(swaps('Incline Barbell Bench Press').note).toBe(SWAP_NOTES.incline);
  });

  it('matches pulls, rows, hinges and raises to their own kind first', () => {
    expect(names('Lat Pulldown').slice(0, 4).sort()).toEqual(['Chin-Up', 'Close-Grip Lat Pulldown', 'One-Arm Lat Pulldown', 'Pull-Up']);
    expect(lineFor('Lat Pulldown', 'Barbell Row')).toBe('Less lats · barbell');
    expect(names('Barbell Row').slice(0, 2).sort()).toEqual(['Pendlay Row', 'Seated Cable Row']);
    expect(lineFor('Barbell Row', 'Seated Cable Row')).toBe('Same movement · cable, easier on the lower back');
    expect(names('Romanian Deadlift').slice(0, 3)).toEqual(['Stiff-Leg Deadlift', 'Dumbbell Romanian Deadlift', '45° Back Extension']);
    expect(names('Lateral Raise').slice(0, 2)).toEqual(['Machine Lateral Raise', 'Cable Lateral Raise']);
    expect(swaps('Lateral Raise').note).toBe(SWAP_NOTES.lateralRaise);
    expect(names('Dumbbell Curl')).toEqual(expect.arrayContaining(['Incline Dumbbell Curl', 'Machine Preacher Curl', 'Barbell Curl', 'Cable Curl']));
  });

  it('keeps the free-weight and machine finding to the big lifts it was tested on', () => {
    expect(swaps('Barbell Row').note).toBe(SWAP_NOTES.machines);
    expect(swaps('Machine Chest Press').note).toBe(SWAP_NOTES.machines);
    expect(swaps('Barbell Curl').note).toBeNull();
    expect(swaps('Hip Thrust').note).toBeNull();
    // Cable to bodyweight crosses nothing the finding covers.
    expect(swaps('Lat Pulldown').note).toBeNull();
  });

  it('offers nothing it has no ground for', () => {
    expect(suggestSwaps(custom('My Thing'), library)).toEqual({ matches: [], note: null });
    expect(swaps('Hip Abduction Machine').matches).toEqual([]);
    // A custom movement with a telling name is placed like any other.
    expect(suggestSwaps(custom('Reverse-Grip Smith Bench Press'), library).matches[0]?.exercise.name).toBe('Machine Chest Press');
  });

  it('never offers the movement itself, a retired row, a swing, or a movement twice', () => {
    for (const exercise of library) {
      const { matches } = suggestSwaps(exercise, [...library, ...library]);
      const picked = matches.map((match) => match.exercise.name);
      expect(picked).not.toContain(exercise.name);
      expect(picked).not.toContain('Kettlebell Swing');
      expect(new Set(picked).size).toBe(picked.length);
      expect(picked.length).toBeLessThanOrEqual(SWAP_MATCH_LIMIT);
    }
    const retired = library.map((exercise) => (exercise.name === 'Hack Squat' ? { ...exercise, retired_at: '2026-11-11T00:00:00Z' } : exercise));
    expect(suggestSwaps(named('Barbell Back Squat'), retired).matches.map((match) => match.exercise.name)).not.toContain('Hack Squat');
  });

  it('keeps bodyweight skills out of a gym movement’s matches, and offers them to each other', () => {
    const skills: Exercise[] = [
      { ...custom('Pistol Squat', 'bodyweight'), category: 'calisthenics' },
      { ...custom('Shrimp Squat', 'bodyweight'), category: 'calisthenics' },
    ];
    const pool = [...library, ...skills];
    expect(suggestSwaps(named('Barbell Back Squat'), pool, 50).matches.map((match) => match.exercise.name)).not.toContain('Pistol Squat');
    expect(suggestSwaps(skills[0], pool, 50).matches.map((match) => match.exercise.name)).toContain('Shrimp Squat');
  });

  it('spreads the matches over equipment, best first', () => {
    for (const exercise of library) {
      const { matches } = suggestSwaps(exercise, library);
      const scores = matches.map((match) => match.score);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    const kinds = swaps('Barbell Back Squat').matches.map((match) => movementProfile(match.exercise)?.equipment);
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(4);
  });

  it('writes lines that fit a row, and notes that name their study', () => {
    for (const exercise of library) {
      for (const match of suggestSwaps(exercise, library).matches) {
        expect(match.line.length).toBeLessThanOrEqual(52);
        expect(match.line).toMatch(/^(Same movement|Same muscles|No |Less |Adds |More )/);
      }
    }
    for (const note of Object.values(SWAP_NOTES)) {
      expect(note.text).not.toMatch(/\.$/);
      expect(note.source).toMatch(/^[A-Z][A-Za-z-]+ 20\d\d$/);
    }
    expect(swapNoteLine(SWAP_NOTES.machines)).toBe('Machines and free weights build muscle equally well (Haugen 2023).');
  });
});
