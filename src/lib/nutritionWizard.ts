// The target calculator's draft: what the person typed, the limits it is held
// to, and the profile and targets it produces. The web wizard (one step at a
// time) and the native form (one page) both run on these rules.
import {
  GOAL_RATE_PRESETS,
  GOAL_RATE_RANGES,
  calculateMacroTargets,
  resolveRatePctPerWeek,
  cmToFeetInches,
  feetInchesToCm,
  kgToLbs,
  lbsToKg,
  type ActivityLevel,
  type BiologicalSex,
  type MacroTargetInput,
  type MacroTargetResult,
  type NutritionGoal,
  type UnitSystem,
} from '@/lib/nutritionCalculator';
import {
  ageFromBirthYear,
  birthYearFromAge,
  todayIsoDate,
  type NutritionProfile,
  type NutritionProfileInput,
} from '@/lib/nutritionProfile';

export interface NutritionWizardOutcome {
  targets: { calories: number; protein: number; carbs: number; fat: number };
  /** How the targets are kept once saved (see wizardTargetSource). */
  source: 'calculated' | 'manual';
  profile: NutritionProfileInput;
  weightKg: number;
  computed: MacroTargetResult;
}

export type WizardOption<T extends string> = { value: T; label: string; hint: string };

export const SEX_OPTIONS: WizardOption<BiologicalSex>[] = [
  { value: 'male', label: 'Male', hint: 'Biological male metabolism' },
  { value: 'female', label: 'Female', hint: 'Biological female metabolism' },
];

export const UNIT_OPTIONS: WizardOption<UnitSystem>[] = [
  { value: 'imperial', label: 'Imperial', hint: 'lbs, feet & inches' },
  { value: 'metric', label: 'Metric', hint: 'kg, cm' },
];

export const ACTIVITY_OPTIONS: WizardOption<ActivityLevel>[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Desk job, no training' },
  { value: 'lightly_active', label: 'Lightly Active', hint: 'Desk job, 1–3 sessions a week' },
  { value: 'moderately_active', label: 'Moderately Active', hint: 'On your feet some, 3–5 sessions' },
  { value: 'very_active', label: 'Very Active', hint: 'Active job or 6–7 hard sessions' },
  { value: 'extra_active', label: 'Extra Active', hint: 'Physical job plus daily training' },
];

export const GOAL_OPTIONS: WizardOption<NutritionGoal>[] = [
  { value: 'cut', label: 'Cut', hint: 'Lose fat, preserve muscle' },
  { value: 'maintain', label: 'Maintain', hint: 'Stay at current composition' },
  { value: 'lean_bulk', label: 'Lean Bulk', hint: 'Slow, controlled muscle gain' },
  { value: 'bulk', label: 'Bulk', hint: 'Maximise muscle growth' },
];

export const RATE_STEP = 0.05;
const WEEKS_PER_MONTH = 4.345;

/** A learned burn the calculator can use: adaptive on and past the profile-only estimate. */
export function learnedBurn(profile: NutritionProfile | null | undefined): number | null {
  if (!profile?.adaptive_enabled) return null;
  const kcal = profile.expenditure_kcal;
  if (typeof kcal !== 'number' || !Number.isFinite(kcal) || kcal <= 0) return null;
  return profile.expenditure_confidence === 'predicted' ? null : Math.round(kcal);
}

/** Everything the calculator holds as typed text, so a half-typed field stays as typed. */
export interface WizardDraft {
  unitSystem: UnitSystem;
  sex: BiologicalSex;
  age: string;
  weight: string;
  heightFeet: string;
  heightInches: string;
  heightCm: string;
  bodyFat: string;
  activity: ActivityLevel;
  goal: NutritionGoal;
  rate: number;
  /**
   * The daily burn to build on: what the app learned from the person's logs
   * and weigh-ins, or the activity formula. Learned only when there is one.
   */
  burn: 'learned' | 'formula';
}

/**
 * A weight as the calculator shows it: one decimal, none when whole. Whole
 * numbers used to be shown, so saving the calculator recorded a rounded,
 * made-up weigh-in (172.8 lb became 173) even when the weight was untouched.
 */
function weightText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function clampInput(value: string, min: number, max: number): number {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function roundRate(value: number): number {
  return Math.round(value / RATE_STEP) * RATE_STEP;
}

/** Starts from the saved profile and the latest weigh-in, else the defaults. */
export function initialWizardDraft(
  profile: NutritionProfile | null | undefined,
  weightKg: number | null | undefined,
  now: Date = new Date(),
): WizardDraft {
  const units = profile?.unit_system ?? 'imperial';
  const savedWeightKg = weightKg ?? 77;
  const savedHeightCm = profile?.height_cm ?? 178;
  const height = cmToFeetInches(savedHeightCm);
  const goal = profile?.goal ?? 'lean_bulk';
  return {
    unitSystem: units,
    sex: profile?.sex ?? 'male',
    age: String(profile ? ageFromBirthYear(profile.birth_year, now) : 25),
    weight: weightText(units === 'imperial' ? kgToLbs(savedWeightKg) : savedWeightKg),
    heightFeet: String(height.feet),
    heightInches: String(height.inches),
    heightCm: String(Math.round(savedHeightCm)),
    bodyFat: profile?.body_fat_pct != null ? String(profile.body_fat_pct) : '',
    activity: profile?.activity ?? 'moderately_active',
    goal,
    // A saved rate outside today's range starts at its nearest edge.
    rate: resolveRatePctPerWeek(goal, profile?.rate_pct_per_week),
    burn: learnedBurn(profile) === null ? 'formula' : 'learned',
  };
}

/** Switching units carries the typed weight and height across, rounded. */
export function switchWizardUnits(draft: WizardDraft, next: UnitSystem): WizardDraft {
  if (next === draft.unitSystem) return draft;
  if (next === 'metric') {
    return {
      ...draft,
      unitSystem: next,
      weight: weightText(lbsToKg(parseFloat(draft.weight) || 170)),
      heightCm: String(
        Math.round(feetInchesToCm(parseFloat(draft.heightFeet) || 5, parseFloat(draft.heightInches) || 10)),
      ),
    };
  }
  const { feet, inches } = cmToFeetInches(parseFloat(draft.heightCm) || 178);
  return {
    ...draft,
    unitSystem: next,
    weight: weightText(kgToLbs(parseFloat(draft.weight) || 77)),
    heightFeet: String(feet),
    heightInches: String(inches),
  };
}

/** A new goal starts at that goal's usual rate. */
export function selectWizardGoal(draft: WizardDraft, goal: NutritionGoal): WizardDraft {
  return { ...draft, goal, rate: GOAL_RATE_PRESETS[goal] };
}

/** One step slower (-1) or faster (+1), inside the goal's range. */
export function stepWizardRate(draft: WizardDraft, direction: -1 | 1): WizardDraft {
  const [min, max] = GOAL_RATE_RANGES[draft.goal];
  const next = direction < 0
    ? Math.max(min, roundRate(draft.rate - RATE_STEP))
    : Math.min(max, roundRate(draft.rate + RATE_STEP));
  return { ...draft, rate: next };
}

export function wizardRateBounds(draft: WizardDraft): { slower: boolean; faster: boolean } {
  const [min, max] = GOAL_RATE_RANGES[draft.goal];
  return {
    slower: roundRate(draft.rate) > min + 1e-9,
    faster: roundRate(draft.rate) < max - 1e-9,
  };
}

export function wizardWeightKg(draft: WizardDraft): number {
  return draft.unitSystem === 'imperial'
    ? lbsToKg(clampInput(draft.weight, 60, 700))
    : clampInput(draft.weight, 30, 300);
}

export function wizardHeightCm(draft: WizardDraft): number {
  return draft.unitSystem === 'imperial'
    ? feetInchesToCm(clampInput(draft.heightFeet, 3, 8), clampInput(draft.heightInches, 0, 11))
    : clampInput(draft.heightCm, 100, 250);
}

/** Optional: blank or unreadable means none; otherwise held to 3–60%. */
export function wizardBodyFatPct(draft: WizardDraft): number | null {
  const trimmed = draft.bodyFat.trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed);
  return Number.isFinite(parsed) ? Math.max(3, Math.min(60, parsed)) : null;
}

/** Age, weight and height are filled in well enough to go on. */
export function wizardBodyReady(draft: WizardDraft): boolean {
  return (
    parseFloat(draft.age) >= 13 &&
    parseFloat(draft.weight) > 0 &&
    (draft.unitSystem === 'imperial' ? parseFloat(draft.heightFeet) >= 3 : parseFloat(draft.heightCm) >= 100)
  );
}

export function wizardInput(draft: WizardDraft, profile: NutritionProfile | null | undefined): MacroTargetInput {
  return {
    sex: draft.sex,
    age: clampInput(draft.age, 13, 100),
    heightCm: wizardHeightCm(draft),
    weightKg: wizardWeightKg(draft),
    bodyFatPct: wizardBodyFatPct(draft),
    activity: draft.activity,
    goal: draft.goal,
    ratePctPerWeek: draft.rate,
    expenditureKcal: draft.burn === 'learned' ? learnedBurn(profile) : null,
  };
}

/** Both daily burns, so the person can see what each one gives and choose. */
export function wizardBurns(draft: WizardDraft, profile: NutritionProfile | null | undefined): {
  learned: number | null;
  formula: number;
} {
  const formula = calculateMacroTargets({ ...wizardInput(draft, profile), expenditureKcal: null }).tdee;
  return { learned: learnedBurn(profile), formula: Math.round(formula) };
}

export function wizardResult(draft: WizardDraft, profile: NutritionProfile | null | undefined): MacroTargetResult {
  return calculateMacroTargets(wizardInput(draft, profile));
}

/**
 * The rate as people read it: % of bodyweight a week, and roughly how much
 * weight that is a week and a month in the chosen unit.
 */
export function wizardRateDisplay(draft: WizardDraft, result: MacroTargetResult): {
  value: number;
  weeklyChange: number;
  monthlyChange: number;
  unit: 'lb' | 'kg';
} {
  const imperial = draft.unitSystem === 'imperial';
  const weekly = Math.abs(imperial ? kgToLbs(result.projectedKgPerWeek) : result.projectedKgPerWeek);
  return {
    value: draft.rate,
    weeklyChange: weekly,
    monthlyChange: weekly * WEEKS_PER_MONTH,
    unit: imperial ? 'lb' : 'kg',
  };
}

/** One line on how the resting rate and protein were worked out. */
export function wizardMethodNote(result: MacroTargetResult): string {
  return result.bmrMethod === 'katch_mcardle'
    ? `Katch-McArdle resting rate (${result.bmr} kcal) from your lean mass, protein set per kg of fat-free mass.`
    : `Mifflin-St Jeor resting rate (${result.bmr} kcal), protein set per kg of bodyweight. Add body fat for a lean-mass-based estimate.`;
}

/**
 * How the targets should be kept: from the learned burn they can keep
 * adapting; from the formula they are set by hand, or the weekly adaptive
 * update would pull them straight back to the learned burn.
 */
export function wizardTargetSource(draft: WizardDraft, profile: NutritionProfile | null | undefined): 'calculated' | 'manual' {
  return draft.burn === 'formula' && learnedBurn(profile) !== null ? 'manual' : 'calculated';
}

/** The profile to save and the targets to review, from the finished draft. */
export function wizardOutcome(
  draft: WizardDraft,
  profile: NutritionProfile | null | undefined,
  now: Date = new Date(),
): NutritionWizardOutcome {
  const result = wizardResult(draft, profile);
  const heightCm = wizardHeightCm(draft);
  return {
    targets: { calories: result.calories, protein: result.protein, carbs: result.carbs, fat: result.fat },
    source: wizardTargetSource(draft, profile),
    profile: {
      sex: draft.sex,
      birth_year: birthYearFromAge(clampInput(draft.age, 13, 100), now),
      height_cm: Math.round(heightCm * 10) / 10,
      body_fat_pct: wizardBodyFatPct(draft),
      activity: draft.activity,
      goal: draft.goal,
      rate_pct_per_week: Math.round(draft.rate * 100) / 100,
      unit_system: draft.unitSystem,
      adaptive_enabled: profile?.adaptive_enabled ?? true,
      phase_started_on: profile?.phase_started_on ?? todayIsoDate(now),
      expenditure_kcal: profile?.expenditure_kcal ?? null,
      expenditure_confidence: profile?.expenditure_confidence ?? null,
      expenditure_updated_at: profile?.expenditure_updated_at ?? null,
    },
    weightKg: wizardWeightKg(draft),
    computed: result,
  };
}

/** Whether a recorded weight differs enough from the calculator's to log a new weigh-in. */
export function wizardWeightChanged(latestKg: number | null, weightKg: number): boolean {
  return latestKg == null || Math.abs(latestKg - weightKg) > 0.05;
}
