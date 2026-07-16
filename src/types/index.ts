export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'side_delts'
  | 'rear_delts'
  | 'front_delts'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'traps';

export interface Exercise {
  id: string;
  name: string;
  muscle_group: MuscleGroup;
  muscle_group_secondary: MuscleGroup | null;
  equipment: string | null;
  is_compound: boolean;
}

export interface Split {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  days_per_week: number;
  is_active: boolean;
  days: SplitDay[];
}

export interface SplitDay {
  id: string;
  split_id: string;
  day_name: string;
  day_order: number;
  exercises: SplitExercise[];
}

export interface SplitExercise {
  id: string;
  split_day_id: string;
  exercise_id: string;
  exercise: Exercise;
  target_sets: number;
  target_sets_min?: number;
  target_sets_max?: number;
  target_reps_min: number;
  target_reps_max: number;
  exercise_order: number;
  notes: string | null;
  superset_group_id?: string | null;
}

export type WorkoutMode = 'split' | 'flexible';

export interface Workout {
  id: string;
  user_id: string;
  split_day_id: string | null;
  date: string;
  notes: string | null;
  completed: boolean;
  completed_at?: string | null;
  created_at?: string;
  sets: WorkoutSet[];
}

export interface FlexiblePlanItem {
  exercise_id: string;
  exercise_name?: string | null;
  order: number;
  target_sets?: number | null;
  target_reps_min?: number | null;
  target_reps_max?: number | null;
  notes?: string | null;
  hidden?: boolean;
  superset_group_id?: string | null;
}

export interface WorkoutDayPlan {
  id: string;
  workout_id: string;
  day_label: string;
  items: FlexiblePlanItem[];
}

export interface FlexDayTemplate {
  id: string;
  user_id: string;
  label: string;
  items: FlexiblePlanItem[];
}

export interface WorkoutSet {
  id: string;
  workout_id: string;
  exercise_id: string;
  exercise?: Exercise;
  set_number: number;
  weight: number | null;
  reps: number | null;
  rpe: number | null;
  completed: boolean;
  completed_at: string | null;
}

export const ACTIVITY_TYPES = [
  'bike_ride',
  'climbing',
  'swimming',
  'run',
  'interval_run',
  'sprint_session',
  'tennis',
  'pickleball',
  'squash',
  'golf',
  'other',
] as const;

export type ActivityType = typeof ACTIVITY_TYPES[number];

export type ActivitySource = 'manual' | 'whoop' | 'strava' | 'gps';

export interface ActivitySession {
  id: string;
  user_id: string;
  activity_type: ActivityType;
  title: string | null;
  date: string;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  source: ActivitySource;
  notes: string | null;
  // aggregates rolled up from segments; null for plain manual entries
  strain: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  energy_kcal: number | null;
  distance_m: number | null;
  // import bookkeeping: created by grouping engine / edited by user / soft-deleted
  auto_grouped: boolean;
  user_edited: boolean;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ActivitySessionInput = {
  activity_type: ActivityType;
  title?: string | null;
  date: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  source?: ActivitySource;
  notes?: string | null;
  strain?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  energy_kcal?: number | null;
  distance_m?: number | null;
  auto_grouped?: boolean;
  user_edited?: boolean;
  dismissed_at?: string | null;
};

// raw imported/recorded child record of an activity session (one WHOOP workout
// record or one GPS lap/sprint rep); (user_id, source, external_id) is unique
export interface ActivitySegment {
  id: string;
  user_id: string;
  session_id: string | null;
  source: ActivitySource;
  external_id: string;
  sport: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds: number | null;
  strain: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  energy_kcal: number | null;
  distance_m: number | null;
  raw: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// safe WHOOP connection metadata (whoop_connections row) — tokens live in a
// separate service-role-only table and are never typed client-side
export interface WhoopConnection {
  user_id: string;
  whoop_user_id: string | null;
  scopes: string | null;
  connected_at: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  updated_at: string;
}

// safe Strava connection metadata (strava_connections row) — tokens live in a
// separate service-role-only table, mirroring the WHOOP pattern
export interface StravaConnection {
  user_id: string;
  strava_athlete_id: string | null;
  scopes: string | null;
  connected_at: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  updated_at: string;
}

export type ActivitySegmentInput = {
  session_id?: string | null;
  source: ActivitySource;
  external_id: string;
  sport?: string | null;
  started_at: string;
  ended_at: string;
  duration_seconds?: number | null;
  strain?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  energy_kcal?: number | null;
  distance_m?: number | null;
  raw?: Record<string, unknown> | null;
};

export interface Food {
  id: string;
  user_id: string | null;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  serving_size: number;
  serving_unit: string;
  source: 'custom' | 'usda';
  fdc_id: string | null;
  serving_label?: string; // display-only, e.g. "1 large"; never written to the DB
}

export interface NutritionLog {
  id: string;
  user_id: string;
  date: string;
  logged_at: string | null;
  food_id: string;
  food?: Food;
  servings: number;
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null;
}

export interface MacroTarget {
  id: string;
  user_id: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface VolumeLandmark {
  id: string;
  user_id: string;
  muscle_group: MuscleGroup;
  mv: number;
  mev: number;
  mav_low: number;
  mav_high: number;
  mrv: number;
}

export interface MuscleVolume {
  muscle_group: MuscleGroup;
  weekly_sets: number;
  landmark?: VolumeLandmark;
  status: 'below_mev' | 'mev_mav' | 'mav' | 'approaching_mrv' | 'above_mrv';
}

export interface SplitTemplate {
  name: string;
  description: string;
  days_per_week: number;
  evidence?: {
    label: string;
    confidence: 'solid' | 'emerging' | 'speculative';
    public_note: string;
  };
  days: {
    day_name: string;
    muscle_groups: MuscleGroup[];
    exercises: {
      name: string;
      sets: number;
      reps_min: number;
      reps_max: number;
    }[];
  }[];
}

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders (General)',
  side_delts: 'Side Delts',
  rear_delts: 'Rear Delts',
  front_delts: 'Front Delts',
  biceps: 'Biceps',
  triceps: 'Triceps',
  quads: 'Quadriceps',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  core: 'Core/Abs',
  traps: 'Traps',
};

export const MEAL_TYPE_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
} as const;

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  bike_ride: 'Bike ride',
  climbing: 'Climbing',
  swimming: 'Swimming',
  run: 'Run',
  interval_run: 'Interval run',
  sprint_session: 'Sprint session',
  tennis: 'Tennis',
  pickleball: 'Pickleball',
  squash: 'Squash',
  golf: 'Golf',
  other: 'Other',
};
