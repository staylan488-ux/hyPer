/**
 * Evidence-based nutrition target calculator.
 *
 * BMR: Mifflin-St Jeor (consensus default for mixed populations).
 * Activity: Standard PAL multipliers.
 * Protein: 1.6–2.2 g/kg (bulk/maintain), 2.0–2.4 g/kg (cut).
 * Fat floor: ≥ 0.7 g/kg, ≥ 20% kcal.
 * Carbs: remainder after protein + fat.
 * Rounding: calories to nearest 25, macros to nearest 5 g.
 */

export type BiologicalSex = 'male' | 'female';

export type ActivityLevel =
  | 'sedentary'
  | 'lightly_active'
  | 'moderately_active'
  | 'very_active'
  | 'extra_active';

export type NutritionGoal = 'cut' | 'maintain' | 'lean_bulk' | 'bulk';

export type UnitSystem = 'metric' | 'imperial';

export interface NutritionWizardAnswers {
  sex: BiologicalSex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
  unitSystem: UnitSystem;
}

export interface MacroTargetResult {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  tdee: number;
  bmr: number;
}

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

const GOAL_CALORIE_ADJUSTMENTS: Record<NutritionGoal, number> = {
  cut: -0.18,
  maintain: 0,
  lean_bulk: 0.08,
  bulk: 0.15,
};

function roundTo(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

/**
 * Mifflin-St Jeor BMR (kcal/day)
 * Men:   10 × W(kg) + 6.25 × H(cm) − 5 × A(years) + 5
 * Women: 10 × W(kg) + 6.25 × H(cm) − 5 × A(years) − 161
 */
function calculateBMR(sex: BiologicalSex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/**
 * Protein target (g/day).
 * Bulk/maintain: 1.8 g/kg (midpoint of 1.6–2.2 range).
 * Cut: 2.2 g/kg (higher end to preserve lean mass in deficit).
 */
function calculateProtein(weightKg: number, goal: NutritionGoal): number {
  const gPerKg = goal === 'cut' ? 2.2 : 1.8;
  return roundTo(weightKg * gPerKg, 5);
}

/**
 * Fat target (g/day).
 * Floor: max(0.7 g/kg, 20% of target calories).
 * Default: ~25% of target calories for most goals.
 * Cut: closer to floor (~22%) to preserve carb budget.
 */
function calculateFat(weightKg: number, targetCalories: number, goal: NutritionGoal): number {
  const floorGrams = weightKg * 0.7;
  const percentageOfCals = goal === 'cut' ? 0.22 : 0.25;
  const fromCalories = (targetCalories * percentageOfCals) / 9;
  return roundTo(Math.max(floorGrams, fromCalories), 5);
}

/**
 * Carbs: remainder after protein and fat calories.
 */
function calculateCarbs(targetCalories: number, proteinG: number, fatG: number): number {
  const remaining = targetCalories - proteinG * 4 - fatG * 9;
  return roundTo(Math.max(remaining / 4, 0), 5);
}

export function calculateMacroTargets(answers: NutritionWizardAnswers): MacroTargetResult {
  const bmr = calculateBMR(answers.sex, answers.weightKg, answers.heightCm, answers.age);
  const tdee = bmr * ACTIVITY_MULTIPLIERS[answers.activity];
  const adjustment = GOAL_CALORIE_ADJUSTMENTS[answers.goal];
  const targetCalories = roundTo(tdee * (1 + adjustment), 25);

  const protein = calculateProtein(answers.weightKg, answers.goal);
  const fat = calculateFat(answers.weightKg, targetCalories, answers.goal);
  const carbs = calculateCarbs(targetCalories, protein, fat);

  return {
    calories: targetCalories,
    protein,
    carbs,
    fat,
    tdee: roundTo(tdee, 25),
    bmr: roundTo(bmr, 25),
  };
}

// ── Unit conversion helpers ──

export function lbsToKg(lbs: number): number {
  return lbs * 0.453592;
}

export function kgToLbs(kg: number): number {
  return kg / 0.453592;
}

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * 2.54;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = cm / 2.54;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches % 12);
  return { feet, inches };
}
