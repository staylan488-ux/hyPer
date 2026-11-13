/**
 * What each movement the program designer can emit trains, as the seeded
 * exercise library files it (supabase/schema.sql and the migrations):
 * [main muscle, second muscle, compound, equipment].
 * tests/programFill.test.ts checks every row against the seed and that every
 * designer name has one.
 *
 * The builder uses it for a template name the account's library lacks, so
 * that slot can still take the person's own movement, or a library movement
 * for the same muscle, instead of leaving the day short.
 */
/** Muscle values as the library stores them, some outside the app's own list (brachialis). */
type Row = readonly [string, string | null, boolean, string];

export const DESIGNER_MOVEMENTS: Readonly<Record<string, Row>> = {
  'Arnold Press': ['shoulders', 'triceps', true, 'dumbbells'],
  'Barbell Back Squat': ['quads', 'glutes', true, 'barbell'],
  'Barbell Curl': ['biceps', null, false, 'barbell'],
  'Barbell Row': ['back', 'biceps', true, 'barbell'],
  'Bulgarian Split Squat': ['quads', 'glutes', true, 'dumbbells'],
  'Cable Fly': ['chest', null, false, 'cable'],
  'Cable Lateral Raise': ['side_delts', null, false, 'cable'],
  'Calf Raise': ['calves', null, false, 'machine'],
  'Chin-Up': ['back', 'biceps', true, 'bodyweight'],
  'Close-Grip Bench Press': ['triceps', 'chest', true, 'barbell'],
  'Dips': ['triceps', 'chest', true, 'bodyweight'],
  'Dumbbell Curl': ['biceps', null, false, 'dumbbells'],
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
  'Leg Curl': ['hamstrings', null, false, 'machine'],
  'Leg Extension': ['quads', null, false, 'machine'],
  'Leg Press': ['quads', 'glutes', true, 'machine'],
  'Lunge': ['quads', 'glutes', true, 'dumbbells'],
  'Lying Leg Curl': ['hamstrings', null, false, 'machine'],
  'Machine Chest Press': ['chest', 'triceps', true, 'machine'],
  'Machine Shoulder Press': ['shoulders', 'triceps', true, 'machine'],
  'One-Arm Cable Row': ['back', 'biceps', true, 'cable'],
  'One-Arm Dumbbell Row': ['back', 'biceps', true, 'dumbbells'],
  'Overhead Barbell Press': ['shoulders', 'triceps', true, 'barbell'],
  'Overhead Dumbbell Press': ['shoulders', 'triceps', true, 'dumbbells'],
  'Overhead Tricep Extension': ['triceps', null, false, 'dumbbells'],
  'Pec Deck / Machine Fly': ['chest', null, false, 'machine'],
  'Plank': ['core', null, false, 'bodyweight'],
  'Preacher Curl': ['biceps', null, false, 'barbell'],
  'Pull-Up': ['back', 'biceps', true, 'bodyweight'],
  'Push-Up': ['chest', 'triceps', true, 'bodyweight'],
  'Rear Delt Fly': ['rear_delts', null, false, 'dumbbells'],
  'Romanian Deadlift': ['hamstrings', 'glutes', true, 'barbell'],
  'Russian Twist': ['core', null, false, 'bodyweight'],
  'Seated Cable Row': ['back', 'biceps', true, 'cable'],
  'Seated Leg Curl': ['hamstrings', null, false, 'machine'],
  'Skull Crushers': ['triceps', null, false, 'barbell'],
  'Standing Calf Raise': ['calves', null, false, 'dumbbells'],
  'Tricep Pushdown': ['triceps', null, false, 'cable'],
};
