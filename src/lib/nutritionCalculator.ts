/**
 * Evidence-based nutrition target calculator (rebuilt 2026-10-27 after the
 * owner, a lean 130 lb lifter, found bulk targets below his maintenance).
 *
 * Energy:
 *   RMR    — Cunningham (500 + 22 x fat-free mass) when body fat is known: in
 *            lean, trained people the fat-free-mass equations that do best
 *            against calorimetry are Cunningham's, while Katch-McArdle reads
 *            about 150 kcal low (Tinsley et al. 2019; ten Haaf & Weijs 2014).
 *            Mifflin-St Jeor otherwise, the best-validated equation for the
 *            general population.
 *   TDEE   — the adaptive layer's learned expenditure when the person picks
 *            it, else RMR x a physical activity level (PAL) inside the
 *            doubly-labelled-water ranges of FAO/WHO/UNU 2004.
 *   Target — TDEE plus the energy for the chosen rate of change, using about
 *            7,700 kcal per kg either way: overfeeding studies measure about
 *            8,000 kcal per kg gained once the cost of building tissue is
 *            counted (Forbes et al. 1986). Bulk surpluses stay within 20% of
 *            maintenance (Iraki et al. 2019: 10–20%).
 *
 * Macros:
 *   Protein — g/kg of fat-free mass when body fat is known, else g/kg of a
 *             BMI-capped reference weight. Capped at 40% of calories.
 *   Fat     — % of calories, floored at 0.6 g/kg reference weight AND 20% of
 *             calories, ceilinged at 35% of calories.
 *   Carbs   — the remainder.
 *
 * Rounding is self-consistent: protein and fat round to 5 g, carbs take the
 * rounded remainder, and calories are then re-derived from the macros, so
 * 4P + 4C + 9F always equals the reported calorie figure exactly.
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

export type BmrMethod = 'mifflin_st_jeor' | 'cunningham';

export type TargetNoteCode =
  | 'deficit_capped_percent'
  | 'deficit_capped_fat_mass'
  | 'calorie_floor'
  | 'surplus_capped_percent'
  | 'protein_capped_percent'
  | 'fat_floor'
  | 'low_carb';

export interface TargetNote {
  code: TargetNoteCode;
  message: string;
}

export interface MacroTargetInput {
  sex: BiologicalSex;
  age: number;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  goal: NutritionGoal;
  /** Optional. Enables the Cunningham resting rate and fat-free-mass protein scaling. */
  bodyFatPct?: number | null;
  /** Signed % of bodyweight per week. Defaults to the preset for `goal`. */
  ratePctPerWeek?: number | null;
  /** Learned expenditure from the adaptive layer. Replaces the predicted TDEE. */
  expenditureKcal?: number | null;
}

export interface MacroTargetResult {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  bmr: number;
  tdee: number;
  bmrMethod: BmrMethod;
  /** True when `tdee` came from the adaptive layer rather than a multiplier. */
  tdeeIsMeasured: boolean;
  /** The rate the user asked for, after clamping to the goal's allowed range. */
  requestedRatePctPerWeek: number;
  /** The rate actually achievable after the safety guards ran. */
  effectiveRatePctPerWeek: number;
  projectedKgPerWeek: number;
  notes: TargetNote[];
}

// ── Constants ──

/**
 * Physical activity levels (total burn / resting rate). Doubly-labelled-water
 * studies put sedentary and lightly active adults at 1.40–1.69, active at
 * 1.70–1.99 and vigorous at 2.00–2.40 (FAO/WHO/UNU 2004); the old textbook
 * 1.2–1.5 for desk workers who train undercounted real burn by several
 * hundred kcal. Each level sits at or below the middle of its range, since
 * people tend to pick a level above their own.
 */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.4,
  lightly_active: 1.55,
  moderately_active: 1.7,
  very_active: 1.85,
  extra_active: 2,
};

/**
 * Signed % of bodyweight per week. Negative loses, positive gains. Gains were
 * raised on 2026-10-27 at the owner's request: a light lifter bulking needs
 * about 0.5% a week (2–3 lb a month at 130 lb), and the old ceiling of 0.3%
 * left no way to ask for that without typing targets by hand.
 */
export const GOAL_RATE_PRESETS: Record<NutritionGoal, number> = {
  cut: -0.7,
  maintain: 0,
  lean_bulk: 0.25,
  bulk: 0.5,
};

/** Inclusive [min, max] on `ratePctPerWeek`, per goal. */
export const GOAL_RATE_RANGES: Record<NutritionGoal, [number, number]> = {
  cut: [-1, -0.25],
  maintain: [0, 0],
  lean_bulk: [0.15, 0.35],
  bulk: [0.35, 0.75],
};

/**
 * Energy per kg of bodyweight change. Loss is fat-dominant (~7,700 kcal/kg).
 * Gain stores less energy per kg (lean tissue is mostly water) but building
 * it costs energy too: overfeeding studies measure about 8,000 kcal per kg
 * gained (Forbes et al. 1986), so 6,000 understated what a bulk needs.
 */
export const KCAL_PER_KG_LOST = 7700;
export const KCAL_PER_KG_GAINED = 7700;

const MAX_DEFICIT_FRACTION = 0.25;
const MAX_SURPLUS_FRACTION = 0.2;
/** Alpert: sustainable ceiling on energy drawn from the fat store, per day. */
const MAX_DEFICIT_KCAL_PER_KG_FAT = 31;
const ABSOLUTE_CALORIE_FLOOR: Record<BiologicalSex, number> = { female: 1200, male: 1500 };

/** Protein basis is capped at the weight this BMI implies, so higher body fat
 *  does not inflate the target. */
const PROTEIN_BASIS_MAX_BMI = 27.5;
const PROTEIN_G_PER_KG_FFM: Record<'cut' | 'other', number> = { cut: 2.4, other: 2 };
const PROTEIN_G_PER_KG_REFERENCE: Record<'cut' | 'other', number> = { cut: 2.2, other: 1.8 };
const MAX_PROTEIN_CALORIE_FRACTION = 0.4;

const FAT_CALORIE_FRACTION: Record<'cut' | 'other', number> = { cut: 0.22, other: 0.25 };
const MIN_FAT_G_PER_KG_REFERENCE = 0.6;
const MIN_FAT_CALORIE_FRACTION = 0.2;
const MAX_FAT_CALORIE_FRACTION = 0.35;

const LOW_CARB_WARNING_GRAMS = 100;

// ── Helpers ──

function roundTo(value: number, nearest: number): number {
  return Math.round(value / nearest) * nearest;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Mifflin-St Jeor BMR (kcal/day)
 * Men:   10 x W(kg) + 6.25 x H(cm) - 5 x A(years) + 5
 * Women: 10 x W(kg) + 6.25 x H(cm) - 5 x A(years) - 161
 */
function mifflinStJeor(sex: BiologicalSex, weightKg: number, heightCm: number, age: number): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'male' ? base + 5 : base - 161;
}

/** Cunningham RMR (kcal/day): 500 + 22 x fat-free mass (kg). */
function cunningham(fatFreeMassKg: number): number {
  return 500 + 22 * fatFreeMassKg;
}

/** Body fat is only usable as a basis when it is physiologically plausible. */
export function isUsableBodyFatPct(bodyFatPct: number | null | undefined): bodyFatPct is number {
  return typeof bodyFatPct === 'number' && Number.isFinite(bodyFatPct) && bodyFatPct >= 3 && bodyFatPct <= 60;
}

/**
 * The weight protein and fat minimums scale off. Capped at the weight implied
 * by BMI 27.5 so that a very heavy user is not handed an unreachable protein
 * target: fat mass has no protein requirement.
 */
export function referenceWeightKg(weightKg: number, heightCm: number): number {
  const heightM = heightCm / 100;
  return Math.min(weightKg, PROTEIN_BASIS_MAX_BMI * heightM * heightM);
}

export function resolveRatePctPerWeek(goal: NutritionGoal, requested?: number | null): number {
  const [min, max] = GOAL_RATE_RANGES[goal];
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return GOAL_RATE_PRESETS[goal];
  }
  return clamp(requested, min, max);
}

function energyDensityForDirection(ratePctPerWeek: number): number {
  return ratePctPerWeek < 0 ? KCAL_PER_KG_LOST : KCAL_PER_KG_GAINED;
}

// ── Calculation ──

export function calculateMacroTargets(input: MacroTargetInput): MacroTargetResult {
  const { sex, age, heightCm, weightKg, activity, goal } = input;
  const notes: TargetNote[] = [];

  // 1. Basal rate.
  const bodyFatPct = isUsableBodyFatPct(input.bodyFatPct) ? input.bodyFatPct : null;
  const fatFreeMassKg = bodyFatPct != null ? weightKg * (1 - bodyFatPct / 100) : null;
  const fatMassKg = fatFreeMassKg != null ? weightKg - fatFreeMassKg : null;
  const bmr = fatFreeMassKg != null
    ? cunningham(fatFreeMassKg)
    : mifflinStJeor(sex, weightKg, heightCm, age);
  const bmrMethod: BmrMethod = fatFreeMassKg != null ? 'cunningham' : 'mifflin_st_jeor';

  // 2. Expenditure. A learned value from the adaptive layer beats a multiplier.
  const measured = input.expenditureKcal;
  const tdeeIsMeasured = typeof measured === 'number' && Number.isFinite(measured) && measured > 0;
  const tdee = tdeeIsMeasured ? measured : bmr * ACTIVITY_MULTIPLIERS[activity];

  // 3. Requested rate of change -> daily energy delta.
  const requestedRatePctPerWeek = resolveRatePctPerWeek(goal, input.ratePctPerWeek);
  const requestedKgPerWeek = (weightKg * requestedRatePctPerWeek) / 100;
  let dailyDelta = (requestedKgPerWeek * energyDensityForDirection(requestedRatePctPerWeek)) / 7;

  // 4. Guards on the delta.
  if (dailyDelta < 0) {
    let maxDeficit = tdee * MAX_DEFICIT_FRACTION;
    let cappedByFatMass = false;

    if (fatMassKg != null) {
      const fatMassLimit = fatMassKg * MAX_DEFICIT_KCAL_PER_KG_FAT;
      if (fatMassLimit < maxDeficit) {
        maxDeficit = fatMassLimit;
        cappedByFatMass = true;
      }
    }

    if (-dailyDelta > maxDeficit) {
      dailyDelta = -maxDeficit;
      notes.push(
        cappedByFatMass
          ? {
              code: 'deficit_capped_fat_mass',
              message:
                'Eased the deficit — at your body fat there is not enough fat mass to fuel a loss that fast without giving up muscle.',
            }
          : {
              code: 'deficit_capped_percent',
              message: 'Eased the deficit — a cut steeper than 25% below maintenance is not sustainable.',
            }
      );
    }
  } else if (dailyDelta > 0) {
    const maxSurplus = tdee * MAX_SURPLUS_FRACTION;
    if (dailyDelta > maxSurplus) {
      dailyDelta = maxSurplus;
      notes.push({
        code: 'surplus_capped_percent',
        message: 'Trimmed the surplus — past 20% above maintenance the extra weight is mostly fat.',
      });
    }
  }

  // 5. Calorie floor. Never prescribe below resting metabolic rate.
  let targetCalories = tdee + dailyDelta;
  const calorieFloor = Math.max(bmr, ABSOLUTE_CALORIE_FLOOR[sex]);
  if (targetCalories < calorieFloor) {
    targetCalories = calorieFloor;
    notes.push({
      code: 'calorie_floor',
      message: 'Raised to your resting metabolic rate — eating below it is where muscle loss starts.',
    });
  }

  // 6. Protein.
  const referenceKg = referenceWeightKg(weightKg, heightCm);
  const proteinKey = goal === 'cut' ? 'cut' : 'other';
  const proteinBasisKg = fatFreeMassKg ?? referenceKg;
  const proteinRate = fatFreeMassKg != null
    ? PROTEIN_G_PER_KG_FFM[proteinKey]
    : PROTEIN_G_PER_KG_REFERENCE[proteinKey];

  let proteinGrams = proteinBasisKg * proteinRate;
  const proteinCeiling = (targetCalories * MAX_PROTEIN_CALORIE_FRACTION) / 4;
  if (proteinGrams > proteinCeiling) {
    proteinGrams = proteinCeiling;
    notes.push({
      code: 'protein_capped_percent',
      message: 'Capped protein at 40% of calories so there is room left for carbs and fat.',
    });
  }

  // 7. Fat. The floor is a health minimum and wins over the percentage ceiling.
  const fatFloorGrams = Math.max(
    MIN_FAT_G_PER_KG_REFERENCE * referenceKg,
    (targetCalories * MIN_FAT_CALORIE_FRACTION) / 9
  );
  const fatCeilingGrams = (targetCalories * MAX_FAT_CALORIE_FRACTION) / 9;
  const fatFromPercentage = (targetCalories * FAT_CALORIE_FRACTION[proteinKey]) / 9;
  const fatGrams = Math.max(fatFloorGrams, Math.min(fatFromPercentage, fatCeilingGrams));
  if (fatGrams > fatFromPercentage + 0.5) {
    notes.push({
      code: 'fat_floor',
      message: 'Held fat at the minimum for hormone health rather than cutting it further.',
    });
  }

  // 8. Round protein and fat, take carbs as the remainder, then re-derive
  //    calories so the macros reconstruct the calorie figure exactly.
  const protein = roundTo(proteinGrams, 5);
  const fat = roundTo(fatGrams, 5);
  const carbs = Math.max(0, roundTo((targetCalories - protein * 4 - fat * 9) / 4, 5));
  const calories = protein * 4 + carbs * 4 + fat * 9;

  if (carbs < LOW_CARB_WARNING_GRAMS) {
    notes.push({
      code: 'low_carb',
      message: 'Carbs are low. Ease the rate or accept that training will feel flat.',
    });
  }

  // 9. Report the rate actually achievable after the guards ran.
  const appliedDelta = calories - tdee;
  const appliedKgPerWeek = (appliedDelta * 7) / energyDensityForDirection(appliedDelta);
  const effectiveRatePctPerWeek = (appliedKgPerWeek / weightKg) * 100;

  return {
    calories,
    protein,
    carbs,
    fat,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    bmrMethod,
    tdeeIsMeasured,
    requestedRatePctPerWeek,
    effectiveRatePctPerWeek: Math.round(effectiveRatePctPerWeek * 100) / 100,
    projectedKgPerWeek: Math.round(appliedKgPerWeek * 1000) / 1000,
    notes,
  };
}

/**
 * Share of calories from each macro, as whole percentages that sum to exactly
 * 100. Rounding each independently loses or gains a point roughly half the
 * time, so the leftovers go to the largest fractional parts.
 */
export function macroCaloriePercentages(
  target: Pick<MacroTargetResult, 'protein' | 'carbs' | 'fat' | 'calories'>
): { protein: number; carbs: number; fat: number } {
  if (target.calories <= 0) return { protein: 0, carbs: 0, fat: 0 };

  const shares = [
    { key: 'protein' as const, kcal: target.protein * 4 },
    { key: 'carbs' as const, kcal: target.carbs * 4 },
    { key: 'fat' as const, kcal: target.fat * 9 },
  ].map((share) => {
    const exact = (share.kcal / target.calories) * 100;
    return { ...share, whole: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });

  let leftover = 100 - shares.reduce((sum, share) => sum + share.whole, 0);
  const byRemainder = [...shares].sort((a, b) => b.remainder - a.remainder);
  for (let i = 0; leftover > 0 && i < byRemainder.length; i += 1, leftover -= 1) {
    byRemainder[i].whole += 1;
  }

  return {
    protein: shares[0].whole,
    carbs: shares[1].whole,
    fat: shares[2].whole,
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
