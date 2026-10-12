import { describe, expect, it } from 'vitest';

import { exerciseCategory, searchExercises } from '@/lib/exerciseSearch';
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
});
