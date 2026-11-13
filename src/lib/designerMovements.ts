/**
 * What each movement in the built-in programs trains, as the seeded exercise
 * library files it (supabase/schema.sql and the migrations):
 * [main muscle, second muscle, compound, equipment].
 * tests/programFill.test.ts checks every row against the seed, and
 * tests/programDesigner.test.ts that every program movement is in the library.
 *
 * The designer shares out sets by these muscles. The builder also uses a row
 * for a name the account's library lacks, so that slot can still take the
 * person's own movement, or a library movement for the same muscle, instead
 * of leaving the day short.
 */
/** Muscle values as the library stores them, some outside the app's own list (brachialis). */
type Row = readonly [string, string | null, boolean, string];

export const DESIGNER_MOVEMENTS: Readonly<Record<string, Row>> = {
  '45° Back Extension': ['glutes', 'hamstrings', true, 'machine'],
  'Barbell Back Squat': ['quads', 'glutes', true, 'barbell'],
  'Bulgarian Split Squat': ['quads', 'glutes', true, 'dumbbells'],
  'Cable Crunch': ['core', null, false, 'cable'],
  'Cable Curl': ['biceps', null, false, 'cable'],
  'Cable Fly': ['chest', null, false, 'cable'],
  'Cable Lateral Raise': ['side_delts', null, false, 'cable'],
  'Cable Overhead Tricep Extension': ['triceps', null, false, 'cable'],
  'Chin-Up': ['back', 'biceps', true, 'bodyweight'],
  'Close-Grip Lat Pulldown': ['back', 'biceps', true, 'cable'],
  'Concentration Curl': ['biceps', null, false, 'dumbbells'],
  'Crunch': ['core', null, false, 'bodyweight'],
  'Dumbbell Curl': ['biceps', null, false, 'dumbbells'],
  'Dumbbell Fly': ['chest', null, false, 'dumbbells'],
  'Dumbbell Romanian Deadlift': ['hamstrings', 'glutes', true, 'dumbbells'],
  'Face Pull': ['rear_delts', 'traps', false, 'cable'],
  'Flat Barbell Bench Press': ['chest', 'triceps', true, 'barbell'],
  'Flat Dumbbell Bench Press': ['chest', 'triceps', true, 'dumbbells'],
  'Goblet Squat': ['quads', 'glutes', true, 'dumbbells'],
  'Hammer Curl': ['biceps', 'brachialis', false, 'dumbbells'],
  'Hanging Leg Raise': ['core', null, false, 'bodyweight'],
  'Hip Thrust': ['glutes', 'hamstrings', true, 'barbell'],
  'Incline Barbell Bench Press': ['chest', 'triceps', true, 'barbell'],
  'Incline Dumbbell Bench Press': ['chest', 'triceps', true, 'dumbbells'],
  'Incline Dumbbell Curl': ['biceps', null, false, 'dumbbells'],
  'Lat Pulldown': ['back', 'biceps', true, 'cable'],
  'Lateral Raise': ['side_delts', null, false, 'dumbbells'],
  'Leg Extension': ['quads', null, false, 'machine'],
  'Leg Press': ['quads', 'glutes', true, 'machine'],
  'Leg Press Calf Raise': ['calves', null, false, 'machine'],
  'Lying Leg Curl': ['hamstrings', null, false, 'machine'],
  'Machine Chest Press': ['chest', 'triceps', true, 'machine'],
  'Machine Lateral Raise': ['side_delts', null, false, 'machine'],
  'Machine Shoulder Press': ['shoulders', 'triceps', true, 'machine'],
  'One-Arm Dumbbell Row': ['back', 'biceps', true, 'dumbbells'],
  'Overhead Dumbbell Press': ['shoulders', 'triceps', true, 'dumbbells'],
  'Overhead Tricep Extension': ['triceps', null, false, 'dumbbells'],
  'Pec Deck / Machine Fly': ['chest', null, false, 'machine'],
  'Preacher Curl': ['biceps', null, false, 'barbell'],
  'Pull-Up': ['back', 'biceps', true, 'bodyweight'],
  'Push-Up': ['chest', 'triceps', true, 'bodyweight'],
  'Rear Delt Fly': ['rear_delts', null, false, 'dumbbells'],
  'Reverse Pec Deck': ['rear_delts', null, false, 'machine'],
  'Romanian Deadlift': ['hamstrings', 'glutes', true, 'barbell'],
  'Rope Pushdown': ['triceps', null, false, 'cable'],
  'Seated Cable Row': ['back', 'biceps', true, 'cable'],
  'Seated Leg Curl': ['hamstrings', null, false, 'machine'],
  'Skull Crushers': ['triceps', null, false, 'barbell'],
  'Standing Calf Raise': ['calves', null, false, 'dumbbells'],
  'Step-Up': ['quads', 'glutes', true, 'dumbbells'],
  'Tricep Kickback': ['triceps', null, false, 'dumbbells'],
  'Tricep Pushdown': ['triceps', null, false, 'cable'],
  'Walking Lunge': ['quads', 'glutes', true, 'dumbbells'],
};
