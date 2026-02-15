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
  target_reps_min: number;
  target_reps_max: number;
  exercise_order: number;
  notes: string | null;
}

export interface Workout {
  id: string;
  user_id: string;
  split_day_id: string | null;
  date: string;
  notes: string | null;
  completed: boolean;
  sets: WorkoutSet[];
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
