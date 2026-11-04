import { describe, expect, it } from 'vitest';

import { exerciseCategory, exerciseSearchScore, searchExercises } from '@/lib/exerciseSearch';
import type { Exercise, MuscleGroup } from '@/types';

function exercise(name: string, muscle: MuscleGroup = 'chest', equipment: string | null = null): Exercise {
  return { id: name, name, muscle_group: muscle, muscle_group_secondary: null, equipment, is_compound: false };
}

describe('exerciseCategory', () => {
  // Kept in step with the backfill in the 20261012120000 migration.
  it.each([
    ['Front Lever Row', 'bodyweight', 'calisthenics'],
    ['Tuck Front Lever', 'bodyweight', 'calisthenics'],
    ['Shrimp Squat', 'bodyweight', 'calisthenics'],
    ['Ring Dip', 'rings', 'calisthenics'],
    ['One-Arm Dip', 'bodyweight', 'calisthenics'],
    ['Archer Push-Up', 'bodyweight', 'calisthenics'],
    ['Pistol Squat', null, 'calisthenics'],
    ['L-Sit', 'bodyweight', 'calisthenics'],
    ['Bar Muscle Up', 'bodyweight', 'calisthenics'],
    ['Pseudo Planche Push-Up', 'bodyweight', 'calisthenics'],
    ['Push-Up', 'bodyweight', 'gym'],
    ['Pull-Up', 'bodyweight', 'gym'],
    ['Weighted Pull-Up', 'bodyweight', 'gym'],
    ['Dips', 'bodyweight', 'gym'],
    ['Hanging Leg Raise', 'bodyweight', 'gym'],
    ['One-Arm Dumbbell Row', 'dumbbells', 'gym'],
    ['One-Arm Chest-Supported Machine Row', 'machine', 'gym'],
    ['Weighted Hyperextension', 'machine', 'gym'],
    ['Spring Lunge', 'dumbbells', 'gym'],
  ] as const)('%s (%s) is %s', (name, equipment, expected) => {
    expect(exerciseCategory(exercise(name, 'back', equipment))).toBe(expected);
  });

  it('lets a stored category win over the name rules', () => {
    expect(exerciseCategory({ ...exercise('Shrimp Squat'), category: 'gym' })).toBe('gym');
    expect(exerciseCategory({ ...exercise('Nordic Curl'), category: 'calisthenics' })).toBe('calisthenics');
  });
});

describe('searchExercises', () => {
  const library = [
    exercise('Incline Barbell Bench Press', 'chest', 'barbell'),
    exercise('Incline Dumbbell Bench Press', 'chest', 'dumbbells'),
    exercise('Incline Dumbbell Curl', 'biceps', 'dumbbells'),
    exercise('Machine Chest Press', 'chest', 'machine'),
    exercise('Overhead Dumbbell Press', 'shoulders', 'dumbbells'),
    exercise('Pull-Up', 'back', 'bodyweight'),
    exercise('Romanian Deadlift', 'hamstrings', 'barbell'),
    exercise('Tricep Pushdown', 'triceps', 'cable'),
    exercise('Weighted Hyperextension', 'hamstrings', 'machine'),
    exercise('45° Back Extension', 'glutes', 'machine'),
  ];
  const names = (query: string) => searchExercises(library, query).map((entry) => entry.name);

  it('matches every word in any order', () => {
    expect(names('incline press')).toEqual(['Incline Barbell Bench Press', 'Incline Dumbbell Bench Press']);
    expect(names('press incline dumbbell')).toEqual(['Incline Dumbbell Bench Press']);
  });

  it('matches partial words', () => {
    expect(names('inc db pr')).toEqual(['Incline Dumbbell Bench Press']);
    expect(names('pulldo')).toEqual([]);
    expect(names('pushd')).toEqual(['Tricep Pushdown']);
  });

  it('ranks name matches above muscle or equipment matches', () => {
    expect(names('chest press')[0]).toBe('Machine Chest Press');
  });

  it('ignores punctuation, plurals and spacing', () => {
    expect(names('pullup')).toEqual(['Pull-Up']);
    expect(names('pull ups')).toEqual(['Pull-Up']);
    expect(names('triceps pushdowns')).toEqual(['Tricep Pushdown']);
    expect(names('45 back')[0]).toBe('45° Back Extension');
  });

  it('understands common shorthand and alternative names', () => {
    expect(names('rdl')).toEqual(['Romanian Deadlift']);
    expect(names('ohp')).toEqual(['Overhead Dumbbell Press']);
    expect(names('back extension')).toEqual(['45° Back Extension', 'Weighted Hyperextension']);
    expect(names('hyperextension')).toEqual(['Weighted Hyperextension', '45° Back Extension']);
  });

  it('returns the list unchanged for an empty query', () => {
    expect(searchExercises(library, '  ')).toBe(library);
  });

  // The picker searches the same rows on every keystroke, so each row's
  // fields are kept; a repeat search must rank exactly as a fresh one.
  it('ranks the same on a repeat search as on fresh rows', () => {
    const queries = ['incline press', 'inc db pr', 'chest press', 'pull ups', 'back extension', 'hyperextension', 'press', 'db', 'x'];
    for (const query of queries) {
      const first = searchExercises(library, query);
      expect(searchExercises(library, query)).toEqual(first);
      first.forEach((entry) => expect(library).toContain(entry));
      const fresh = searchExercises(library.map((entry) => ({ ...entry })), query);
      expect(fresh.map((entry) => entry.name)).toEqual(first.map((entry) => entry.name));
    }
  });

  it('keeps ties in the order given', () => {
    const rows = [exercise('Cable Row B', 'back', 'cable'), exercise('Cable Row A', 'back', 'cable')];
    expect(searchExercises(rows, 'cable row').map((entry) => entry.name)).toEqual(['Cable Row B', 'Cable Row A']);
  });

  it('reads each row object for itself, not by id', () => {
    const cable = { ...exercise('Row', 'back', 'cable'), id: 'row' };
    const bare = { ...exercise('Row', 'back', null), id: 'row' };
    expect(searchExercises([cable, bare], 'cable')).toEqual([cable]);
    expect(searchExercises([bare, cable], 'cable')).toEqual([cable]);
  });
});

describe('exerciseSearchScore', () => {
  it.each([
    ['Machine Chest Press', 'chest', 'machine', 'chest press', 11],
    ['Incline Dumbbell Bench Press', 'chest', 'dumbbells', 'chest press', 4],
    ['Incline Dumbbell Bench Press', 'chest', 'dumbbells', 'Incline Dumbbell Bench-Press', 32],
    ['Incline Dumbbell Bench Press', 'chest', 'dumbbells', 'Incline', 13],
    ['Tricep Pushdown', 'triceps', 'cable', 'pushd', 8],
    ['Overhead Dumbbell Press', 'shoulders', 'dumbbells', 'ohp', 1],
    ['Pull-Up', 'back', 'bodyweight', 'pull ups', 6],
    ['Pull-Up', 'back', 'bodyweight', 'squat', 0],
    ['Pull-Up', 'back', 'bodyweight', '  ', 1],
  ] as const)('%s (%s, %s) scores %j as %i', (name, muscle, equipment, query, expected) => {
    const row = exercise(name, muscle, equipment);
    expect(exerciseSearchScore(row, query)).toBe(expected);
    // Again, from the kept fields.
    expect(exerciseSearchScore(row, query)).toBe(expected);
  });
});
