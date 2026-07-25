import { describe, expect, it } from 'vitest';

import {
  WINDOW_DAYS,
  estimateExpenditure,
  shouldRefreshExpenditure,
  type DailyIntake,
  type ExpenditureInput,
} from '@/lib/adaptiveExpenditure';
import { calculateMacroTargets } from '@/lib/nutritionCalculator';
import type { WeightSampleLike } from '@/lib/weightTrend';

const TODAY = new Date(2026, 6, 25, 12, 0, 0); // 25 Jul 2026, local noon

function isoDay(offsetFromToday: number): string {
  const d = new Date(2026, 6, 25 + offsetFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Weigh-ins at 08:00 local for the last `days` days, following a linear rate. */
function weighIns(startKg: number, kgPerDay: number, days: number): WeightSampleLike[] {
  return Array.from({ length: days }, (_, i) => {
    const offset = -(days - 1) + i;
    const at = new Date(2026, 6, 25 + offset, 8, 0, 0);
    return { measured_at: at.toISOString(), kilograms: startKg + kgPerDay * i };
  });
}

function intake(caloriesPerDay: number, days: number): DailyIntake[] {
  return Array.from({ length: days }, (_, i) => ({
    date: isoDay(-(days - 1) + i),
    calories: caloriesPerDay,
  }));
}

function inputWith(overrides: Partial<ExpenditureInput> = {}): ExpenditureInput {
  return {
    predictedTdee: 2700,
    bmr: 1800,
    weightSamples: weighIns(82, 0, 21),
    dailyIntake: intake(2700, 21),
    through: TODAY,
    ...overrides,
  };
}

describe('energy balance', () => {
  it('reads a flat weight at a steady intake as maintenance', () => {
    const result = estimateExpenditure(inputWith());

    expect(result.measuredKcal).toBeCloseTo(2700, 6);
    expect(result.kgPerWeek).toBeCloseTo(0, 6);
    expect(result.meanIntakeKcal).toBe(2700);
    expect(result.confidence).toBe('measured');
    expect(result.expenditureKcal).toBe(2700);
  });

  it('recovers a seeded expenditure from a known deficit and loss rate', () => {
    // Someone whose true burn is 2,900: eating 2,400 leaves a 500 kcal/day
    // deficit, which at 7,700 kcal/kg is 0.06494 kg/day of loss.
    const trueTdee = 2900;
    const intakeKcal = 2400;
    const kgPerDay = -(trueTdee - intakeKcal) / 7700;

    const result = estimateExpenditure(
      inputWith({
        predictedTdee: 2700, // the prediction is wrong; the measurement should win
        weightSamples: weighIns(90, kgPerDay, 21),
        dailyIntake: intake(intakeKcal, 21),
      })
    );

    expect(result.measuredKcal).toBeCloseTo(trueTdee, 4);
    expect(result.kgPerWeek).toBeCloseTo(kgPerDay * 7, 6);
    // Fully covered window, so the estimate is essentially the measurement.
    expect(result.expenditureKcal).toBeCloseTo(trueTdee, -2);
  });

  it('uses the lower energy density when gaining', () => {
    // Gained tissue is not pure fat, so a surplus of the same size produces
    // more weight than an equal deficit removes.
    const gaining = estimateExpenditure(
      inputWith({ weightSamples: weighIns(80, 0.02, 21), dailyIntake: intake(2700, 21) })
    );
    const losing = estimateExpenditure(
      inputWith({ weightSamples: weighIns(80, -0.02, 21), dailyIntake: intake(2700, 21) })
    );

    expect(2700 - (gaining.measuredKcal as number)).toBeCloseTo(0.02 * 6000, 4);
    expect((losing.measuredKcal as number) - 2700).toBeCloseTo(0.02 * 7700, 4);
  });
});

describe('data quality gates', () => {
  it('falls back to the prediction with no data at all', () => {
    const result = estimateExpenditure(inputWith({ weightSamples: [], dailyIntake: [] }));

    expect(result.confidence).toBe('predicted');
    expect(result.expenditureKcal).toBe(2700);
    expect(result.measuredKcal).toBeNull();
    expect(result.blendWeight).toBe(0);
    expect(result.reasons.join(' ')).toContain('logged days');
    expect(result.reasons.join(' ')).toContain('weigh-ins');
  });

  it('will not measure on too few logged days', () => {
    const result = estimateExpenditure(inputWith({ dailyIntake: intake(2700, 10) }));

    expect(result.confidence).toBe('predicted');
    expect(result.loggedDayCount).toBe(10);
    expect(result.reasons.some((r) => r.includes('logged days'))).toBe(true);
  });

  it('will not measure on too few weigh-ins', () => {
    const result = estimateExpenditure(inputWith({ weightSamples: weighIns(82, 0, 6) }));

    expect(result.confidence).toBe('predicted');
    expect(result.weighInDayCount).toBe(6);
    expect(result.reasons.some((r) => r.includes('weigh-ins'))).toBe(true);
  });

  it('treats an un-logged day as missing rather than as zero calories', () => {
    // Five forgotten days. Counting them as 0 would fabricate a huge deficit
    // and crater the estimate; they must simply not count.
    const withGaps: DailyIntake[] = intake(2700, 21).map((day, i) =>
      i % 4 === 0 ? { ...day, calories: 0 } : day
    );

    const result = estimateExpenditure(inputWith({ dailyIntake: withGaps }));

    expect(result.loggedDayCount).toBe(15);
    expect(result.meanIntakeKcal).toBe(2700); // not dragged down by the zeros
    expect(result.measuredKcal).toBeCloseTo(2700, 6);
  });

  it('also discards implausibly small logged days', () => {
    // 600 kcal is below half of the 1,800 BMR — a snack logged, not a day.
    const partial: DailyIntake[] = intake(2700, 21).map((day, i) =>
      i % 3 === 0 ? { ...day, calories: 600 } : day
    );

    const result = estimateExpenditure(inputWith({ dailyIntake: partial }));

    expect(result.loggedDayCount).toBe(14);
    expect(result.meanIntakeKcal).toBe(2700);
  });

  it('ignores intake and weigh-ins from outside the window', () => {
    const result = estimateExpenditure(
      inputWith({
        dailyIntake: [...intake(2700, 21), { date: isoDay(-60), calories: 9000 }],
        weightSamples: [
          ...weighIns(82, 0, 21),
          { measured_at: new Date(2026, 4, 1, 8, 0, 0).toISOString(), kilograms: 120 },
        ],
      })
    );

    expect(result.meanIntakeKcal).toBe(2700);
    expect(result.measuredKcal).toBeCloseTo(2700, 6);
  });
});

describe('under-logging protection', () => {
  it('clamps a measurement that sits implausibly far below the prediction', () => {
    // Chronic under-reporting: logs 1,400 while holding weight, which would
    // imply a 1,400 kcal burn against a 2,700 prediction.
    const result = estimateExpenditure(
      inputWith({ dailyIntake: intake(1400, 21), weightSamples: weighIns(82, 0, 21) })
    );

    expect(result.measuredKcal).toBeCloseTo(1400, 6);
    // Never below 70% of the prediction.
    expect(result.expenditureKcal).toBeGreaterThanOrEqual(2700 * 0.7 - 1);
    expect(result.reasons.some((r) => r.includes('unlogged'))).toBe(true);
  });

  it('clamps an implausibly high measurement too', () => {
    const result = estimateExpenditure(
      inputWith({ dailyIntake: intake(5000, 21), weightSamples: weighIns(82, 0, 21) })
    );

    expect(result.expenditureKcal).toBeLessThanOrEqual(2700 * 1.4 + 1);
    expect(result.reasons.some((r) => r.includes('caution'))).toBe(true);
  });
});

describe('blending and damping', () => {
  it('weights the measurement more as coverage improves', () => {
    const atGate = estimateExpenditure(
      inputWith({ dailyIntake: intake(2400, 14), weightSamples: weighIns(82, -0.05, 10) })
    );
    const full = estimateExpenditure(
      inputWith({ dailyIntake: intake(2400, 21), weightSamples: weighIns(82, -0.05, 21) })
    );

    expect(atGate.blendWeight).toBeLessThan(full.blendWeight);
    expect(atGate.confidence).toBe('learning');
    expect(full.confidence).toBe('measured');
    expect(full.blendWeight).toBeCloseTo(1, 6);
  });

  it('moves the stored figure by at most 5% in one update', () => {
    const result = estimateExpenditure(
      inputWith({
        dailyIntake: intake(2400, 21),
        weightSamples: weighIns(82, -0.05, 21),
        previousExpenditureKcal: 2000,
        previousConfidence: 'measured',
      })
    );

    expect(result.expenditureKcal).toBeLessThanOrEqual(2100);
    expect(result.expenditureKcal).toBeGreaterThanOrEqual(1900);
  });

  it('does not let a stored PREDICTED value anchor the first measurement', () => {
    // The store persists the prediction while waiting for data. If that counted
    // as prior knowledge, damping would pin the first real measurement to
    // within 5% of a guess and it would take months to escape.
    const fixture = { dailyIntake: intake(2400, 21), weightSamples: weighIns(88, -0.15, 21) };

    const afterPrediction = estimateExpenditure(
      inputWith({ ...fixture, previousExpenditureKcal: 2700, previousConfidence: 'predicted' })
    );
    const fresh = estimateExpenditure(inputWith(fixture));

    expect(afterPrediction.expenditureKcal).toBe(fresh.expenditureKcal);
    expect(afterPrediction.expenditureKcal).toBeGreaterThan(3400);
  });

  it('does not damp the very first measurement', () => {
    // 2,400 eaten while losing 0.15 kg/day implies a ~3,555 burn.
    const fixture = { dailyIntake: intake(2400, 21), weightSamples: weighIns(88, -0.15, 21) };

    const first = estimateExpenditure(inputWith(fixture));
    const damped = estimateExpenditure(
      inputWith({ ...fixture, previousExpenditureKcal: 2700, previousConfidence: 'measured' })
    );

    // With nothing stored yet it jumps straight to the measurement...
    expect(first.expenditureKcal).toBeGreaterThan(3400);
    // ...but once there is a stored value, the same data moves it only 5%.
    expect(damped.expenditureKcal).toBe(2835);
  });
});

describe('freezing when coverage lapses', () => {
  it('holds the last learned value rather than decaying to the prediction', () => {
    const result = estimateExpenditure(
      inputWith({
        dailyIntake: [],
        weightSamples: [],
        previousExpenditureKcal: 3050,
        previousConfidence: 'measured',
      })
    );

    expect(result.expenditureKcal).toBe(3050);
    expect(result.confidence).toBe('measured');
  });

  it('falls back to the prediction when nothing was ever learned', () => {
    const result = estimateExpenditure(inputWith({ dailyIntake: [], weightSamples: [] }));

    expect(result.expenditureKcal).toBe(2700);
    expect(result.confidence).toBe('predicted');
  });
});

describe('phase transient', () => {
  it('skips the first week after a goal change', () => {
    // The phase started 10 days ago, so only the last 3 days are usable —
    // not enough to measure, even though 21 days of data exist.
    const result = estimateExpenditure(inputWith({ phaseStartedOn: isoDay(-10) }));

    expect(result.windowStart).toBe(isoDay(-3));
    expect(result.confidence).toBe('predicted');
  });

  it('uses the full window once the transient is behind it', () => {
    const result = estimateExpenditure(inputWith({ phaseStartedOn: isoDay(-40) }));

    expect(result.windowStart).toBe(isoDay(-(WINDOW_DAYS - 1)));
    expect(result.confidence).toBe('measured');
  });

  it('explains itself right after a goal change', () => {
    const result = estimateExpenditure(inputWith({ phaseStartedOn: isoDay(-1) }));

    expect(result.confidence).toBe('predicted');
    expect(result.reasons.some((r) => r.includes('changed your goal'))).toBe(true);
  });
});

describe('convergence — the whole loop, week by week', () => {
  /**
   * Simulates a real user: the prediction is wrong, they eat exactly the target
   * the app gives them, their weight responds by energy balance, and the app
   * re-estimates every week. This is the property the whole feature exists for
   * — an initially wrong number must find the truth.
   */
  function runSimulation(trueTdee: number, predictedTdee: number, weeks: number) {
    const bmr = 1800;
    const weightSamples: WeightSampleLike[] = [];
    const dailyIntake: DailyIntake[] = [];
    let weightKg = 90;
    let expenditureKcal: number | null = null;
    let confidence: 'predicted' | 'learning' | 'measured' | null = null;
    const history: number[] = [];

    for (let day = 0; day < weeks * 7; day += 1) {
      const date = new Date(2026, 0, 1 + day);
      const isoDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

      // What the app tells them to eat today, given what it currently believes.
      const target = calculateMacroTargets({
        sex: 'male',
        age: 30,
        heightCm: 180,
        weightKg,
        activity: 'moderately_active',
        goal: 'cut',
        ratePctPerWeek: -0.5,
        expenditureKcal,
      }).calories;

      dailyIntake.push({ date: isoDate, calories: target });

      // The body responds to the real balance, not the believed one.
      const balance = target - trueTdee;
      weightKg += balance / (balance < 0 ? 7700 : 6000);
      weightSamples.push({
        measured_at: new Date(2026, 0, 1 + day, 8, 0, 0).toISOString(),
        kilograms: weightKg,
      });

      if (day % 7 === 6) {
        const estimate = estimateExpenditure({
          predictedTdee,
          bmr,
          weightSamples,
          dailyIntake,
          previousExpenditureKcal: expenditureKcal,
          previousConfidence: confidence,
          through: date,
        });
        expenditureKcal = estimate.expenditureKcal;
        confidence = estimate.confidence;
        history.push(estimate.expenditureKcal);
      }
    }

    return { expenditureKcal, confidence, history, weightKg };
  }

  it('finds a burn the prediction underestimated by 300 kcal', () => {
    const { expenditureKcal, confidence } = runSimulation(2900, 2600, 12);

    expect(confidence).toBe('measured');
    expect(expenditureKcal as number).toBeGreaterThan(2850);
    expect(expenditureKcal as number).toBeLessThan(2950);
  });

  it('finds a burn the prediction overestimated by 400 kcal', () => {
    const { expenditureKcal, confidence } = runSimulation(2300, 2700, 12);

    expect(confidence).toBe('measured');
    expect(expenditureKcal as number).toBeGreaterThan(2250);
    expect(expenditureKcal as number).toBeLessThan(2350);
  });

  it('closes the gap fast, then stays closed', () => {
    const { history } = runSimulation(2900, 2600, 12);
    const errors = history.map((value) => Math.abs(value - 2900));

    // Week 1 is still the raw prediction, 300 kcal out.
    expect(errors[0]).toBe(300);
    // Each of the first four weekly updates strictly improves on the last.
    for (let i = 1; i < 4; i += 1) {
      expect(errors[i]).toBeLessThan(errors[i - 1]);
    }
    // From week 4 on it stays locked on, with no drift back out.
    errors.slice(3).forEach((error) => expect(error).toBeLessThan(25));
  });

  it('holds steady once the prediction was already right', () => {
    const { expenditureKcal, history } = runSimulation(2700, 2700, 10);

    expect(expenditureKcal as number).toBeGreaterThan(2650);
    expect(expenditureKcal as number).toBeLessThan(2750);
    // No thrashing around a correct answer.
    const settled = history.slice(-4);
    expect(Math.max(...settled) - Math.min(...settled)).toBeLessThan(60);
  });
});

describe('refresh cadence', () => {
  it('refreshes when nothing has been computed yet', () => {
    expect(shouldRefreshExpenditure(null, TODAY)).toBe(true);
    expect(shouldRefreshExpenditure(undefined, TODAY)).toBe(true);
    expect(shouldRefreshExpenditure('not-a-date', TODAY)).toBe(true);
  });

  it('waits a week between updates', () => {
    const sixDaysAgo = new Date(TODAY.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    const eightDaysAgo = new Date(TODAY.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();

    expect(shouldRefreshExpenditure(sixDaysAgo, TODAY)).toBe(false);
    expect(shouldRefreshExpenditure(eightDaysAgo, TODAY)).toBe(true);
  });
});
