import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_MULTIPLIERS,
  GOAL_RATE_PRESETS,
  GOAL_RATE_RANGES,
  calculateMacroTargets,
  cmToFeetInches,
  feetInchesToCm,
  isUsableBodyFatPct,
  kgToLbs,
  macroCaloriePercentages,
  lbsToKg,
  referenceWeightKg,
  resolveRatePctPerWeek,
  type MacroTargetInput,
} from '../src/lib/nutritionCalculator';

/**
 * Golden fixtures. Every expected number below was computed by hand from the
 * documented formulas rather than lifted from a previous run — they are the
 * regression net, so a silent formula change has to fail here.
 */

const LEAN_MALE_CUT: MacroTargetInput = {
  sex: 'male',
  age: 30,
  heightCm: 180,
  weightKg: 82,
  activity: 'moderately_active',
  goal: 'cut',
};

const LEAN_MALE_CUT_WITH_BODY_FAT: MacroTargetInput = { ...LEAN_MALE_CUT, bodyFatPct: 22 };

const FEMALE_MAINTAIN: MacroTargetInput = {
  sex: 'female',
  age: 35,
  heightCm: 165,
  weightKg: 62,
  activity: 'lightly_active',
  goal: 'maintain',
};

const LEAN_BULK_WITH_BODY_FAT: MacroTargetInput = {
  sex: 'male',
  age: 25,
  heightCm: 178,
  weightKg: 75,
  bodyFatPct: 14,
  activity: 'very_active',
  goal: 'lean_bulk',
};

const HEAVY_MALE_CUT: MacroTargetInput = {
  sex: 'male',
  age: 40,
  heightCm: 175,
  weightKg: 120,
  activity: 'sedentary',
  goal: 'cut',
};

const ALL_FIXTURES: Array<[string, MacroTargetInput]> = [
  ['lean male cut', LEAN_MALE_CUT],
  ['lean male cut with body fat', LEAN_MALE_CUT_WITH_BODY_FAT],
  ['female maintain', FEMALE_MAINTAIN],
  ['lean bulk with body fat', LEAN_BULK_WITH_BODY_FAT],
  ['heavy male cut', HEAVY_MALE_CUT],
];

describe('golden values', () => {
  it('lean male cutting, no body fat supplied — Mifflin path', () => {
    // BMR  = 10(82) + 6.25(180) - 5(30) + 5 = 1800
    // TDEE = 1800 x 1.50 = 2700
    // -0.7 %/wk of 82 kg = -0.574 kg/wk -> -631 kcal/day, inside the 675 cap
    // Protein 2.2 x 82 = 180.4 -> 180 g; fat 22% of 2069 = 50.6 -> 50 g
    const r = calculateMacroTargets(LEAN_MALE_CUT);

    expect(r.bmr).toBe(1800);
    expect(r.tdee).toBe(2700);
    expect(r.bmrMethod).toBe('mifflin_st_jeor');
    expect(r.tdeeIsMeasured).toBe(false);
    expect(r.protein).toBe(180);
    expect(r.carbs).toBe(225);
    expect(r.fat).toBe(50);
    expect(r.calories).toBe(2070);
    expect(r.notes).toEqual([]);
    expect(r.projectedKgPerWeek).toBeCloseTo(-0.573, 3);
    expect(r.effectiveRatePctPerWeek).toBeCloseTo(-0.7, 2);
  });

  it('the same lifter at 22% body fat — Katch-McArdle path, fat-mass cap binds', () => {
    // FFM  = 82 x 0.78 = 63.96, fat mass = 18.04
    // BMR  = 370 + 21.6(63.96) = 1751.5; TDEE = 2627.3
    // Requested 631 kcal deficit exceeds 31 x 18.04 = 559.2, so it is eased
    // Protein 2.4 x 63.96 = 153.5 -> 155 g
    const r = calculateMacroTargets(LEAN_MALE_CUT_WITH_BODY_FAT);

    expect(r.bmr).toBe(1752);
    expect(r.tdee).toBe(2627);
    expect(r.bmrMethod).toBe('katch_mcardle');
    expect(r.protein).toBe(155);
    expect(r.carbs).toBe(250);
    expect(r.fat).toBe(50);
    expect(r.calories).toBe(2070);
    expect(r.notes.map((n) => n.code)).toEqual(['deficit_capped_fat_mass']);
    expect(r.requestedRatePctPerWeek).toBe(-0.7);
    // The guard slowed the cut relative to what was asked for.
    expect(r.effectiveRatePctPerWeek).toBeGreaterThan(-0.7);
  });

  it('female maintaining', () => {
    // BMR  = 10(62) + 6.25(165) - 5(35) - 161 = 1315.25
    // TDEE = 1315.25 x 1.375 = 1808.5, no delta
    // Protein 1.8 x 62 = 111.6 -> 110 g; fat 25% of 1808.5 = 50.2 -> 50 g
    const r = calculateMacroTargets(FEMALE_MAINTAIN);

    expect(r.bmr).toBe(1315);
    expect(r.tdee).toBe(1808);
    expect(r.protein).toBe(110);
    expect(r.carbs).toBe(230);
    expect(r.fat).toBe(50);
    expect(r.calories).toBe(1810);
    expect(r.notes).toEqual([]);
    expect(r.projectedKgPerWeek).toBeCloseTo(0, 2);
  });

  it('lean bulk with body fat supplied', () => {
    // FFM  = 75 x 0.86 = 64.5; BMR = 370 + 21.6(64.5) = 1763.2
    // TDEE = 1763.2 x 1.65 = 2909.3
    // +0.10 %/wk of 75 kg = 0.075 kg/wk -> +64 kcal/day, well inside the cap
    // Protein 2.0 x 64.5 = 129 -> 130 g; fat 25% of 2973.6 = 82.6 -> 85 g
    const r = calculateMacroTargets(LEAN_BULK_WITH_BODY_FAT);

    expect(r.bmr).toBe(1763);
    expect(r.tdee).toBe(2909);
    expect(r.protein).toBe(130);
    expect(r.carbs).toBe(420);
    expect(r.fat).toBe(85);
    expect(r.calories).toBe(2965);
    expect(r.notes).toEqual([]);
    expect(r.projectedKgPerWeek).toBeGreaterThan(0);
  });

  it('heavy sedentary male cutting — both the deficit cap and the RMR floor bind', () => {
    // BMR  = 10(120) + 6.25(175) - 5(40) + 5 = 2098.75; TDEE = 2623.4
    // The requested -924 kcal/day exceeds the 25% cap of 655.9, so it is
    // eased, and the resulting 1967.6 then falls under the 2098.75 RMR floor.
    // Protein basis is capped at the BMI-27.5 weight of 84.2 kg, not 120 kg.
    const r = calculateMacroTargets(HEAVY_MALE_CUT);

    expect(r.bmr).toBe(2099);
    expect(r.tdee).toBe(2623);
    expect(r.notes.map((n) => n.code)).toEqual(['deficit_capped_percent', 'calorie_floor']);
    expect(r.protein).toBe(185); // 2.2 x 84.2 = 185.3, NOT 2.2 x 120 = 264
    expect(r.carbs).toBe(225);
    expect(r.fat).toBe(50);
    expect(r.calories).toBe(2090);
  });
});

describe('macro / calorie consistency', () => {
  it.each(ALL_FIXTURES)('%s: 4P + 4C + 9F equals calories exactly', (_label, input) => {
    const r = calculateMacroTargets(input);
    expect(r.protein * 4 + r.carbs * 4 + r.fat * 9).toBe(r.calories);
  });

  it.each(ALL_FIXTURES)('%s: macros are whole multiples of 5 g', (_label, input) => {
    const r = calculateMacroTargets(input);
    expect(r.protein % 5).toBe(0);
    expect(r.carbs % 5).toBe(0);
    expect(r.fat % 5).toBe(0);
  });

  it.each(ALL_FIXTURES)('%s: displayed macro percentages sum to exactly 100', (_label, input) => {
    const pct = macroCaloriePercentages(calculateMacroTargets(input));
    expect(pct.protein + pct.carbs + pct.fat).toBe(100);
  });

  it.each(ALL_FIXTURES)('%s: each displayed percentage is within a point of its true share', (_label, input) => {
    const r = calculateMacroTargets(input);
    const pct = macroCaloriePercentages(r);
    const exact = (kcal: number) => (kcal / r.calories) * 100;
    expect(Math.abs(pct.protein - exact(r.protein * 4))).toBeLessThan(1);
    expect(Math.abs(pct.carbs - exact(r.carbs * 4))).toBeLessThan(1);
    expect(Math.abs(pct.fat - exact(r.fat * 9))).toBeLessThan(1);
  });

  it('handles an empty target without dividing by zero', () => {
    expect(macroCaloriePercentages({ protein: 0, carbs: 0, fat: 0, calories: 0 })).toEqual({
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe('safety guards', () => {
  it('caps the deficit at 25% of expenditure when body fat is unknown', () => {
    const r = calculateMacroTargets({ ...HEAVY_MALE_CUT, ratePctPerWeek: -1 });
    expect(r.notes.map((n) => n.code)).toContain('deficit_capped_percent');
    expect(r.calories).toBeGreaterThanOrEqual(r.tdee * 0.75 - 15);
  });

  it('caps the deficit by fat mass when body fat is known', () => {
    // 8% body fat on 70 kg is 5.6 kg of fat mass -> a 174 kcal/day ceiling.
    const r = calculateMacroTargets({
      sex: 'male',
      age: 28,
      heightCm: 175,
      weightKg: 70,
      bodyFatPct: 8,
      activity: 'moderately_active',
      goal: 'cut',
      ratePctPerWeek: -1,
    });
    expect(r.notes.map((n) => n.code)).toContain('deficit_capped_fat_mass');
    expect(r.tdee - r.calories).toBeLessThanOrEqual(70 * 0.08 * 31 + 15);
  });

  it('never prescribes below resting metabolic rate', () => {
    const r = calculateMacroTargets({
      sex: 'female',
      age: 45,
      heightCm: 155,
      weightKg: 95,
      activity: 'sedentary',
      goal: 'cut',
      ratePctPerWeek: -1,
    });
    expect(r.notes.map((n) => n.code)).toContain('calorie_floor');
    expect(r.calories).toBeGreaterThanOrEqual(r.bmr - 15);
  });

  it('caps the surplus at 20% of expenditure', () => {
    // A backstop rather than a everyday guard: at the preset rate ranges the
    // implied surplus only outruns 20% of expenditure when the adaptive layer
    // reports a measured expenditure close to the user's own resting rate.
    const r = calculateMacroTargets({
      sex: 'female',
      age: 70,
      heightCm: 150,
      weightKg: 250,
      activity: 'sedentary',
      goal: 'bulk',
      ratePctPerWeek: 0.3,
      expenditureKcal: 3000,
    });
    expect(r.notes.map((n) => n.code)).toContain('surplus_capped_percent');
    expect(r.calories - r.tdee).toBeLessThanOrEqual(r.tdee * 0.2 + 15);
  });

  it('caps protein at 40% of calories', () => {
    // Very tall, at the BMI-27.5 protein basis, on a cut floored at RMR:
    // 2.2 x 110 = 242 g would be 44% of the 2205 kcal target.
    const r = calculateMacroTargets({
      sex: 'male',
      age: 30,
      heightCm: 200,
      weightKg: 110,
      activity: 'sedentary',
      goal: 'cut',
      ratePctPerWeek: -1,
    });
    expect(r.notes.map((n) => n.code)).toContain('protein_capped_percent');
    expect(r.protein * 4).toBeLessThanOrEqual(r.calories * 0.4 + 20);
  });

  it('holds fat at or above 20% of calories on a hard cut', () => {
    const r = calculateMacroTargets({
      sex: 'male',
      age: 50,
      heightCm: 160,
      weightKg: 90,
      bodyFatPct: 30,
      activity: 'sedentary',
      goal: 'cut',
      ratePctPerWeek: -1,
    });
    expect(r.fat * 9).toBeGreaterThanOrEqual(r.calories * 0.2 - 20);
  });

  it('never returns negative carbs', () => {
    const r = calculateMacroTargets({
      sex: 'female',
      age: 60,
      heightCm: 145,
      weightKg: 45,
      activity: 'sedentary',
      goal: 'cut',
      ratePctPerWeek: -1,
    });
    expect(r.carbs).toBeGreaterThanOrEqual(0);
  });
});

describe('measured expenditure from the adaptive layer', () => {
  it('replaces the predicted TDEE when supplied', () => {
    const predicted = calculateMacroTargets(LEAN_MALE_CUT);
    const measured = calculateMacroTargets({ ...LEAN_MALE_CUT, expenditureKcal: 3100 });

    expect(predicted.tdeeIsMeasured).toBe(false);
    expect(measured.tdeeIsMeasured).toBe(true);
    expect(measured.tdee).toBe(3100);
    expect(measured.calories).toBeGreaterThan(predicted.calories);
    // BMR stays predicted — it is the floor, not the expenditure.
    expect(measured.bmr).toBe(predicted.bmr);
  });

  it('ignores a zero or nonsense expenditure', () => {
    const base = calculateMacroTargets(LEAN_MALE_CUT);
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, expenditureKcal: 0 }).tdee).toBe(base.tdee);
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, expenditureKcal: null }).tdee).toBe(base.tdee);
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, expenditureKcal: NaN }).tdee).toBe(base.tdee);
  });
});

describe('rate resolution', () => {
  it('falls back to the goal preset when no rate is given', () => {
    expect(resolveRatePctPerWeek('cut', null)).toBe(GOAL_RATE_PRESETS.cut);
    expect(resolveRatePctPerWeek('lean_bulk', undefined)).toBe(GOAL_RATE_PRESETS.lean_bulk);
    expect(resolveRatePctPerWeek('maintain', 5)).toBe(0);
  });

  it('clamps a requested rate into the goal range', () => {
    expect(resolveRatePctPerWeek('cut', -3)).toBe(GOAL_RATE_RANGES.cut[0]);
    expect(resolveRatePctPerWeek('cut', 0.5)).toBe(GOAL_RATE_RANGES.cut[1]);
    expect(resolveRatePctPerWeek('bulk', 99)).toBe(GOAL_RATE_RANGES.bulk[1]);
  });

  it('every preset sits inside its own range', () => {
    (Object.keys(GOAL_RATE_PRESETS) as Array<keyof typeof GOAL_RATE_PRESETS>).forEach((goal) => {
      const [min, max] = GOAL_RATE_RANGES[goal];
      expect(GOAL_RATE_PRESETS[goal]).toBeGreaterThanOrEqual(min);
      expect(GOAL_RATE_PRESETS[goal]).toBeLessThanOrEqual(max);
    });
  });
});

describe('directional sanity', () => {
  it('orders calories cut < maintain < lean bulk < bulk', () => {
    const at = (goal: MacroTargetInput['goal']) =>
      calculateMacroTargets({ ...LEAN_MALE_CUT, goal }).calories;

    expect(at('cut')).toBeLessThan(at('maintain'));
    expect(at('maintain')).toBeLessThan(at('lean_bulk'));
    expect(at('lean_bulk')).toBeLessThan(at('bulk'));
  });

  it('maintain lands within rounding distance of expenditure', () => {
    const r = calculateMacroTargets({ ...LEAN_MALE_CUT, goal: 'maintain' });
    expect(Math.abs(r.calories - r.tdee)).toBeLessThanOrEqual(15);
  });

  it('TDEE rises monotonically with activity level', () => {
    const levels = Object.keys(ACTIVITY_MULTIPLIERS) as Array<keyof typeof ACTIVITY_MULTIPLIERS>;
    const tdees = levels.map((activity) => calculateMacroTargets({ ...LEAN_MALE_CUT, activity }).tdee);
    for (let i = 1; i < tdees.length; i += 1) {
      expect(tdees[i]).toBeGreaterThan(tdees[i - 1]);
    }
  });

  it('a cut asks for more protein than maintenance at the same bodyweight', () => {
    const cut = calculateMacroTargets({ ...LEAN_MALE_CUT, goal: 'cut' });
    const maintain = calculateMacroTargets({ ...LEAN_MALE_CUT, goal: 'maintain' });
    expect(cut.protein).toBeGreaterThan(maintain.protein);
  });

  it('males have a higher BMR than females at identical measurements', () => {
    const male = calculateMacroTargets({ ...LEAN_MALE_CUT, sex: 'male' });
    const female = calculateMacroTargets({ ...LEAN_MALE_CUT, sex: 'female' });
    expect(male.bmr).toBeGreaterThan(female.bmr);
  });

  it('BMR falls with age and rises with weight and height', () => {
    const base = calculateMacroTargets(LEAN_MALE_CUT).bmr;
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, age: 50 }).bmr).toBeLessThan(base);
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, weightKg: 95 }).bmr).toBeGreaterThan(base);
    expect(calculateMacroTargets({ ...LEAN_MALE_CUT, heightCm: 190 }).bmr).toBeGreaterThan(base);
  });

  it('Katch-McArdle and Mifflin agree closely at an average composition', () => {
    const mifflin = calculateMacroTargets(LEAN_MALE_CUT);
    const katch = calculateMacroTargets({ ...LEAN_MALE_CUT, bodyFatPct: 18 });
    expect(Math.abs(katch.bmr - mifflin.bmr)).toBeLessThan(150);
  });
});

describe('body fat and reference weight helpers', () => {
  it('accepts only physiologically plausible body fat', () => {
    expect(isUsableBodyFatPct(18)).toBe(true);
    expect(isUsableBodyFatPct(3)).toBe(true);
    expect(isUsableBodyFatPct(60)).toBe(true);
    expect(isUsableBodyFatPct(2)).toBe(false);
    expect(isUsableBodyFatPct(61)).toBe(false);
    expect(isUsableBodyFatPct(null)).toBe(false);
    expect(isUsableBodyFatPct(undefined)).toBe(false);
    expect(isUsableBodyFatPct(NaN)).toBe(false);
  });

  it('ignores an implausible body fat value rather than throwing', () => {
    const r = calculateMacroTargets({ ...LEAN_MALE_CUT, bodyFatPct: 99 });
    expect(r.bmrMethod).toBe('mifflin_st_jeor');
  });

  it('caps the reference weight at BMI 27.5 but leaves lighter users alone', () => {
    expect(referenceWeightKg(120, 175)).toBeCloseTo(27.5 * 1.75 * 1.75, 3);
    expect(referenceWeightKg(70, 175)).toBe(70);
  });
});

describe('unit conversions', () => {
  it('round-trips pounds and kilograms', () => {
    expect(kgToLbs(lbsToKg(185))).toBeCloseTo(185, 6);
    expect(lbsToKg(100)).toBeCloseTo(45.3592, 4);
  });

  it('round-trips feet/inches and centimetres', () => {
    expect(feetInchesToCm(5, 10)).toBeCloseTo(177.8, 1);
    expect(cmToFeetInches(177.8)).toEqual({ feet: 5, inches: 10 });
    expect(cmToFeetInches(182.88)).toEqual({ feet: 6, inches: 0 });
  });
});
