import { describe, expect, it } from 'vitest';

import {
  calculateMacroTargets,
  lbsToKg,
  kgToLbs,
  feetInchesToCm,
  cmToFeetInches,
  type NutritionWizardAnswers,
} from '../src/lib/nutritionCalculator';

// ── Helpers ──

/** All results should be multiples of these rounding targets */
function isRoundedTo(value: number, nearest: number): boolean {
  return value % nearest === 0;
}

const maleBase: NutritionWizardAnswers = {
  sex: 'male',
  age: 30,
  heightCm: 178,
  weightKg: 80,
  activity: 'moderately_active',
  goal: 'maintain',
  unitSystem: 'metric',
};

const femaleBase: NutritionWizardAnswers = {
  sex: 'female',
  age: 28,
  heightCm: 165,
  weightKg: 62,
  activity: 'lightly_active',
  goal: 'maintain',
  unitSystem: 'metric',
};

// ── BMR ──

describe('nutritionCalculator – BMR', () => {
  it('calculates higher BMR for males vs females of similar size', () => {
    const male = calculateMacroTargets({ ...maleBase, heightCm: 170, weightKg: 70, age: 30 });
    const female = calculateMacroTargets({ ...femaleBase, heightCm: 170, weightKg: 70, age: 30, activity: 'moderately_active' });
    expect(male.bmr).toBeGreaterThan(female.bmr);
  });

  it('BMR decreases with age', () => {
    const young = calculateMacroTargets({ ...maleBase, age: 25 });
    const older = calculateMacroTargets({ ...maleBase, age: 45 });
    expect(young.bmr).toBeGreaterThan(older.bmr);
  });

  it('BMR increases with weight', () => {
    const lighter = calculateMacroTargets({ ...maleBase, weightKg: 65 });
    const heavier = calculateMacroTargets({ ...maleBase, weightKg: 95 });
    expect(heavier.bmr).toBeGreaterThan(lighter.bmr);
  });

  it('BMR increases with height', () => {
    const shorter = calculateMacroTargets({ ...maleBase, heightCm: 160 });
    const taller = calculateMacroTargets({ ...maleBase, heightCm: 190 });
    expect(taller.bmr).toBeGreaterThan(shorter.bmr);
  });
});

// ── TDEE / Activity ──

describe('nutritionCalculator – TDEE & activity', () => {
  it('TDEE increases with activity level', () => {
    const sedentary = calculateMacroTargets({ ...maleBase, activity: 'sedentary' });
    const moderate = calculateMacroTargets({ ...maleBase, activity: 'moderately_active' });
    const extra = calculateMacroTargets({ ...maleBase, activity: 'extra_active' });
    expect(sedentary.tdee).toBeLessThan(moderate.tdee);
    expect(moderate.tdee).toBeLessThan(extra.tdee);
  });

  it('TDEE is always greater than BMR', () => {
    const result = calculateMacroTargets(maleBase);
    expect(result.tdee).toBeGreaterThan(result.bmr);
  });
});

// ── Goal calorie adjustments ──

describe('nutritionCalculator – goal adjustments', () => {
  it('cut produces fewer calories than maintain', () => {
    const cut = calculateMacroTargets({ ...maleBase, goal: 'cut' });
    const maintain = calculateMacroTargets({ ...maleBase, goal: 'maintain' });
    expect(cut.calories).toBeLessThan(maintain.calories);
  });

  it('maintain produces fewer calories than lean_bulk', () => {
    const maintain = calculateMacroTargets({ ...maleBase, goal: 'maintain' });
    const leanBulk = calculateMacroTargets({ ...maleBase, goal: 'lean_bulk' });
    expect(maintain.calories).toBeLessThan(leanBulk.calories);
  });

  it('lean_bulk produces fewer calories than bulk', () => {
    const leanBulk = calculateMacroTargets({ ...maleBase, goal: 'lean_bulk' });
    const bulk = calculateMacroTargets({ ...maleBase, goal: 'bulk' });
    expect(leanBulk.calories).toBeLessThan(bulk.calories);
  });

  it('maintain calories equal TDEE (rounded)', () => {
    const result = calculateMacroTargets({ ...maleBase, goal: 'maintain' });
    expect(result.calories).toBe(result.tdee);
  });
});

// ── Protein ──

describe('nutritionCalculator – protein', () => {
  it('cut uses higher protein per kg than maintain', () => {
    const cut = calculateMacroTargets({ ...maleBase, goal: 'cut' });
    const maintain = calculateMacroTargets({ ...maleBase, goal: 'maintain' });
    expect(cut.protein).toBeGreaterThan(maintain.protein);
  });

  it('protein scales with body weight', () => {
    const light = calculateMacroTargets({ ...maleBase, weightKg: 60 });
    const heavy = calculateMacroTargets({ ...maleBase, weightKg: 100 });
    expect(heavy.protein).toBeGreaterThan(light.protein);
  });

  it('bulk and maintain use same protein rate', () => {
    const maintain = calculateMacroTargets({ ...maleBase, goal: 'maintain', weightKg: 80 });
    const bulk = calculateMacroTargets({ ...maleBase, goal: 'bulk', weightKg: 80 });
    expect(maintain.protein).toBe(bulk.protein);
  });
});

// ── Fat floor ──

describe('nutritionCalculator – fat floor', () => {
  it('fat never drops below 0.7 g/kg', () => {
    // Very low calorie scenario: light person on a cut
    const result = calculateMacroTargets({
      ...femaleBase,
      weightKg: 50,
      goal: 'cut',
      activity: 'sedentary',
    });
    // 0.7 * 50 = 35g minimum, rounded to nearest 5 = 35
    expect(result.fat).toBeGreaterThanOrEqual(35);
  });

  it('fat increases with body weight (via floor and calorie scaling)', () => {
    const light = calculateMacroTargets({ ...maleBase, weightKg: 60 });
    const heavy = calculateMacroTargets({ ...maleBase, weightKg: 100 });
    expect(heavy.fat).toBeGreaterThan(light.fat);
  });
});

// ── Carbs (remainder) ──

describe('nutritionCalculator – carbs', () => {
  it('carbs are never negative', () => {
    const result = calculateMacroTargets({
      ...femaleBase,
      weightKg: 50,
      goal: 'cut',
      activity: 'sedentary',
    });
    expect(result.carbs).toBeGreaterThanOrEqual(0);
  });

  it('macro calories approximately sum to target calories', () => {
    const result = calculateMacroTargets(maleBase);
    const macroCalories = result.protein * 4 + result.carbs * 4 + result.fat * 9;
    // Allow rounding tolerance: each macro rounded to 5g, so up to ~60 kcal off
    expect(Math.abs(macroCalories - result.calories)).toBeLessThanOrEqual(75);
  });
});

// ── Rounding ──

describe('nutritionCalculator – rounding', () => {
  it('calories are rounded to nearest 25', () => {
    const result = calculateMacroTargets(maleBase);
    expect(isRoundedTo(result.calories, 25)).toBe(true);
  });

  it('TDEE is rounded to nearest 25', () => {
    const result = calculateMacroTargets(maleBase);
    expect(isRoundedTo(result.tdee, 25)).toBe(true);
  });

  it('BMR is rounded to nearest 25', () => {
    const result = calculateMacroTargets(maleBase);
    expect(isRoundedTo(result.bmr, 25)).toBe(true);
  });

  it('all macros are rounded to nearest 5', () => {
    const result = calculateMacroTargets(maleBase);
    expect(isRoundedTo(result.protein, 5)).toBe(true);
    expect(isRoundedTo(result.carbs, 5)).toBe(true);
    expect(isRoundedTo(result.fat, 5)).toBe(true);
  });

  it('rounding holds across varied inputs', () => {
    const scenarios: NutritionWizardAnswers[] = [
      { ...maleBase, weightKg: 57, age: 19, activity: 'extra_active', goal: 'bulk' },
      { ...femaleBase, weightKg: 95, age: 55, activity: 'sedentary', goal: 'cut' },
      { ...maleBase, weightKg: 120, heightCm: 195, age: 40, activity: 'very_active', goal: 'lean_bulk' },
    ];
    for (const s of scenarios) {
      const r = calculateMacroTargets(s);
      expect(isRoundedTo(r.calories, 25)).toBe(true);
      expect(isRoundedTo(r.protein, 5)).toBe(true);
      expect(isRoundedTo(r.carbs, 5)).toBe(true);
      expect(isRoundedTo(r.fat, 5)).toBe(true);
    }
  });
});

// ── Unit conversion ──

describe('nutritionCalculator – unit conversions', () => {
  it('lbs ↔ kg round-trips', () => {
    const kg = 80;
    const lbs = kgToLbs(kg);
    expect(Math.abs(lbsToKg(lbs) - kg)).toBeLessThan(0.01);
  });

  it('converts known lbs → kg', () => {
    // 176.37 lbs ≈ 80 kg
    expect(lbsToKg(176.37)).toBeCloseTo(80, 0);
  });

  it('converts known kg → lbs', () => {
    expect(kgToLbs(80)).toBeCloseTo(176.37, 0);
  });

  it('feet/inches → cm for known height', () => {
    // 5'10" = 177.8 cm
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 1);
  });

  it('cm → feet/inches for known height', () => {
    const { feet, inches } = cmToFeetInches(177.8);
    expect(feet).toBe(5);
    expect(inches).toBe(10);
  });

  it('cm ↔ feet/inches round-trips', () => {
    const original = 183;
    const { feet, inches } = cmToFeetInches(original);
    const backToCm = feetInchesToCm(feet, inches);
    // Within 1 cm due to inch rounding
    expect(Math.abs(backToCm - original)).toBeLessThanOrEqual(1.5);
  });
});
