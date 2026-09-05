import { useMemo, useState } from 'react';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/shared';
import { springs } from '@/lib/animations';
import {
  GOAL_RATE_PRESETS,
  GOAL_RATE_RANGES,
  calculateMacroTargets,
  cmToFeetInches,
  feetInchesToCm,
  kgToLbs,
  lbsToKg,
  macroCaloriePercentages,
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
  profile: NutritionProfileInput;
  weightKg: number;
  computed: MacroTargetResult;
}

interface NutritionWizardProps {
  /** Saved profile, so the wizard resumes instead of resetting to defaults. */
  initialProfile?: NutritionProfile | null;
  /** Most recent weigh-in, so bodyweight is not re-typed. */
  initialWeightKg?: number | null;
  onApply: (outcome: NutritionWizardOutcome) => void;
  onCancel: () => void;
}

type WizardStep = 'units' | 'body' | 'composition' | 'activity' | 'goal' | 'review';

type Option<T extends string> = { value: T; label: string; hint: string };

const SEX_OPTIONS: Option<BiologicalSex>[] = [
  { value: 'male', label: 'Male', hint: 'Biological male metabolism' },
  { value: 'female', label: 'Female', hint: 'Biological female metabolism' },
];

const UNIT_OPTIONS: Option<UnitSystem>[] = [
  { value: 'imperial', label: 'Imperial', hint: 'lbs, feet & inches' },
  { value: 'metric', label: 'Metric', hint: 'kg, cm' },
];

const ACTIVITY_OPTIONS: Option<ActivityLevel>[] = [
  { value: 'sedentary', label: 'Sedentary', hint: 'Desk job, no training' },
  { value: 'lightly_active', label: 'Lightly Active', hint: 'Desk job, 1–3 sessions a week' },
  { value: 'moderately_active', label: 'Moderately Active', hint: 'On your feet some, 3–5 sessions' },
  { value: 'very_active', label: 'Very Active', hint: 'Active job or 6–7 hard sessions' },
  { value: 'extra_active', label: 'Extra Active', hint: 'Physical job plus daily training' },
];

const GOAL_OPTIONS: Option<NutritionGoal>[] = [
  { value: 'cut', label: 'Cut', hint: 'Lose fat, preserve muscle' },
  { value: 'maintain', label: 'Maintain', hint: 'Stay at current composition' },
  { value: 'lean_bulk', label: 'Lean Bulk', hint: 'Slow, controlled muscle gain' },
  { value: 'bulk', label: 'Bulk', hint: 'Maximise muscle growth' },
];

const STEPS: WizardStep[] = ['units', 'body', 'composition', 'activity', 'goal', 'review'];

const RATE_STEP = 0.05;
const WEEKS_PER_MONTH = 4.345;

function clampInput(value: string, min: number, max: number): number {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function roundRate(value: number): number {
  return Math.round(value / RATE_STEP) * RATE_STEP;
}

export function NutritionWizard({
  initialProfile,
  initialWeightKg,
  onApply,
  onCancel,
}: NutritionWizardProps) {
  const savedUnits = initialProfile?.unit_system ?? 'imperial';
  const savedWeightKg = initialWeightKg ?? 77;
  const savedHeightCm = initialProfile?.height_cm ?? 178;
  const savedHeight = cmToFeetInches(savedHeightCm);

  const [step, setStep] = useState<WizardStep>('units');
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(savedUnits);
  const [sex, setSex] = useState<BiologicalSex>(initialProfile?.sex ?? 'male');
  const [age, setAge] = useState(
    String(initialProfile ? ageFromBirthYear(initialProfile.birth_year) : 25)
  );
  const [weightInput, setWeightInput] = useState(
    String(savedUnits === 'imperial' ? Math.round(kgToLbs(savedWeightKg)) : Math.round(savedWeightKg))
  );
  const [heightFeet, setHeightFeet] = useState(String(savedHeight.feet));
  const [heightInches, setHeightInches] = useState(String(savedHeight.inches));
  const [heightCmInput, setHeightCmInput] = useState(String(Math.round(savedHeightCm)));
  const [bodyFatInput, setBodyFatInput] = useState(
    initialProfile?.body_fat_pct != null ? String(initialProfile.body_fat_pct) : ''
  );
  const [activity, setActivity] = useState<ActivityLevel>(
    initialProfile?.activity ?? 'moderately_active'
  );
  const [goal, setGoal] = useState<NutritionGoal>(initialProfile?.goal ?? 'lean_bulk');
  const [rate, setRate] = useState<number>(
    initialProfile?.rate_pct_per_week ?? GOAL_RATE_PRESETS[initialProfile?.goal ?? 'lean_bulk']
  );

  const stepIndex = STEPS.indexOf(step);

  const goBack = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
    else onCancel();
  };

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1]);
  };

  const selectGoal = (next: NutritionGoal) => {
    setGoal(next);
    setRate(GOAL_RATE_PRESETS[next]);
  };

  const weightKg = useMemo(
    () =>
      unitSystem === 'imperial'
        ? lbsToKg(clampInput(weightInput, 60, 700))
        : clampInput(weightInput, 30, 300),
    [unitSystem, weightInput]
  );

  const heightCm = useMemo(
    () =>
      unitSystem === 'imperial'
        ? feetInchesToCm(clampInput(heightFeet, 3, 8), clampInput(heightInches, 0, 11))
        : clampInput(heightCmInput, 100, 250),
    [unitSystem, heightFeet, heightInches, heightCmInput]
  );

  const bodyFatPct = useMemo(() => {
    const trimmed = bodyFatInput.trim();
    if (!trimmed) return null;
    const parsed = parseFloat(trimmed);
    return Number.isFinite(parsed) ? Math.max(3, Math.min(60, parsed)) : null;
  }, [bodyFatInput]);

  const input: MacroTargetInput = useMemo(
    () => ({
      sex,
      age: clampInput(age, 13, 100),
      heightCm,
      weightKg,
      bodyFatPct,
      activity,
      goal,
      ratePctPerWeek: rate,
      expenditureKcal: initialProfile?.adaptive_enabled ? initialProfile.expenditure_kcal : null,
    }),
    [sex, age, heightCm, weightKg, bodyFatPct, activity, goal, rate, initialProfile]
  );

  const result = useMemo(() => calculateMacroTargets(input), [input]);
  const percentages = useMemo(() => macroCaloriePercentages(result), [result]);

  const [rateMin, rateMax] = GOAL_RATE_RANGES[goal];
  const showsRateControl = goal !== 'maintain';
  const gainGoal = goal === 'lean_bulk' || goal === 'bulk';

  // Gains are legible per month, losses per week.
  const displayedRate = gainGoal ? rate * WEEKS_PER_MONTH : rate;
  const weeklyChangeInUnit = Math.abs(
    unitSystem === 'imperial' ? kgToLbs(result.projectedKgPerWeek) : result.projectedKgPerWeek
  );
  const weightUnitLabel = unitSystem === 'imperial' ? 'lb' : 'kg';

  const handleApply = () => {
    const profile: NutritionProfileInput = {
      sex,
      birth_year: birthYearFromAge(clampInput(age, 13, 100)),
      height_cm: Math.round(heightCm * 10) / 10,
      body_fat_pct: bodyFatPct,
      activity,
      goal,
      rate_pct_per_week: Math.round(rate * 100) / 100,
      unit_system: unitSystem,
      adaptive_enabled: initialProfile?.adaptive_enabled ?? true,
      phase_started_on: initialProfile?.phase_started_on ?? todayIsoDate(),
      expenditure_kcal: initialProfile?.expenditure_kcal ?? null,
      expenditure_confidence: initialProfile?.expenditure_confidence ?? null,
      expenditure_updated_at: initialProfile?.expenditure_updated_at ?? null,
    };

    onApply({
      targets: {
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
      },
      profile,
      weightKg,
      computed: result,
    });
  };

  const renderOptionRow = <T extends string>(
    options: Option<T>[],
    selected: T,
    onSelect: (value: T) => void
  ) => (
    <ul>
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <li key={option.value}>
            <button
              type="button"
              aria-pressed={active}
              className={`pressable w-full text-left flex items-center gap-4 py-4 border-t border-[var(--color-border)] transition-colors ${
                active ? 'material-surface px-4' : 'px-4'
              }`}
              onClick={() => onSelect(option.value)}
            >
              <span className="flex-1 min-w-0">
                <span className={`t-heading block normal-case tracking-normal ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                  {option.label}
                </span>
                <span className="t-caption">{option.hint}</span>
              </span>
              <span
                className={`shrink-0 w-1.5 h-1.5 ${active ? 'bg-[var(--color-accent)]' : 'bg-transparent border border-[var(--color-border-strong)]'}`}
                aria-hidden
              />
            </button>
          </li>
        );
      })}
    </ul>
  );

  const renderNumericInput = (
    label: string,
    value: string,
    onChange: (val: string) => void,
    suffix?: string,
    placeholder?: string
  ) => (
    <div>
      <label className="t-label-sm block mb-2">{label}</label>
      <div className="material-inset relative flex items-baseline gap-2 px-3 rounded-[var(--radius-control)]">
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
        />
        {suffix && <span className="t-label-sm shrink-0">{suffix}</span>}
      </div>
    </div>
  );

  const canProceedFromBody =
    parseFloat(age) >= 13 &&
    parseFloat(weightInput) > 0 &&
    (unitSystem === 'imperial'
      ? parseFloat(heightFeet) >= 3
      : parseFloat(heightCmInput) >= 100);

  return (
    <div className="space-y-7">
      {/* Step dateline */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-1.5 t-label-sm hover:text-[var(--color-text)] transition-colors"
          onClick={goBack}
        >
          <ChevronLeft className="w-3 h-3" strokeWidth={1.75} />
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </button>
        <span className="t-data-sm text-[var(--color-muted)]">
          {String(stepIndex + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </span>
      </div>

      {/* Step progress — hairline ticks */}
      <div className="flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={`h-px flex-1 ${i <= stepIndex ? 'bg-[var(--color-text)]' : 'bg-[var(--color-border)]'}`}
          />
        ))}
      </div>

      {/* Step: Units + Sex */}
      {step === 'units' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Nutrition calculator</p>
            <h4 className="t-title">Units &amp; biological sex</h4>
            <p className="t-caption mt-3 max-w-[34ch]">Sex affects basal metabolic rate estimation.</p>
          </div>

          <div>
            <p className="t-label mb-2">Unit system</p>
            {renderOptionRow(UNIT_OPTIONS, unitSystem, (v) => {
              setUnitSystem(v);
              if (v === 'metric') {
                const kg = Math.round(lbsToKg(parseFloat(weightInput) || 170));
                setWeightInput(String(kg));
                const cm = Math.round(
                  feetInchesToCm(parseFloat(heightFeet) || 5, parseFloat(heightInches) || 10)
                );
                setHeightCmInput(String(cm));
              } else {
                const lbs = Math.round(kgToLbs(parseFloat(weightInput) || 77));
                setWeightInput(String(lbs));
                const { feet, inches } = cmToFeetInches(parseFloat(heightCmInput) || 178);
                setHeightFeet(String(feet));
                setHeightInches(String(inches));
              }
            })}
          </div>

          <div>
            <p className="t-label mb-2">Biological sex</p>
            {renderOptionRow(SEX_OPTIONS, sex, setSex)}
          </div>

          <Button size="lg" className="w-full" onClick={goNext}>
            Continue
          </Button>
        </motion.div>
      )}

      {/* Step: Body measurements */}
      {step === 'body' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Body measurements</p>
            <h4 className="t-title">Your current stats</h4>
            <p className="t-caption mt-3 max-w-[34ch]">
              {initialWeightKg != null
                ? 'Weight is prefilled from your latest weigh-in.'
                : 'Used to estimate your resting metabolic rate.'}
            </p>
          </div>

          <div className="space-y-6">
            {renderNumericInput('Age', age, setAge, 'yrs')}

            {renderNumericInput(
              'Body weight',
              weightInput,
              setWeightInput,
              unitSystem === 'imperial' ? 'lbs' : 'kg'
            )}

            {unitSystem === 'imperial' ? (
              <div>
                <label className="t-label-sm block mb-2">Height</label>
                <div className="grid grid-cols-2 gap-6">
                  <div className="material-inset relative flex items-baseline gap-2 px-3 rounded-[var(--radius-control)]">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={heightFeet}
                      onChange={(e) => setHeightFeet(e.target.value)}
                      className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
                    />
                    <span className="t-label-sm shrink-0">ft</span>
                  </div>
                  <div className="material-inset relative flex items-baseline gap-2 px-3 rounded-[var(--radius-control)]">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={heightInches}
                      onChange={(e) => setHeightInches(e.target.value)}
                      className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
                    />
                    <span className="t-label-sm shrink-0">in</span>
                  </div>
                </div>
              </div>
            ) : (
              renderNumericInput('Height', heightCmInput, setHeightCmInput, 'cm')
            )}
          </div>

          <Button size="lg" className="w-full" onClick={goNext} disabled={!canProceedFromBody}>
            Continue
          </Button>
        </motion.div>
      )}

      {/* Step: Body composition — optional */}
      {step === 'composition' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Body composition</p>
            <h4 className="t-title">Body fat, if you know it</h4>
            <p className="t-caption mt-3 max-w-[38ch]">
              Optional. With it, calories come from lean mass rather than a population average, and
              protein scales off the tissue that actually needs it. A rough estimate still helps.
            </p>
          </div>

          {renderNumericInput('Body fat', bodyFatInput, setBodyFatInput, '%', 'Leave blank if unsure')}

          {bodyFatPct != null && (
            <dl className="border-t border-[var(--color-border)]">
              <div className="flex items-baseline justify-between gap-4 py-3">
                <dt className="t-label-sm">Fat-free mass</dt>
                <dd className="t-data-sm text-[var(--color-text)] tabular-nums">
                  {(unitSystem === 'imperial'
                    ? kgToLbs(weightKg * (1 - bodyFatPct / 100))
                    : weightKg * (1 - bodyFatPct / 100)
                  ).toFixed(1)}{' '}
                  {weightUnitLabel}
                </dd>
              </div>
            </dl>
          )}

          <div className="space-y-3">
            <Button size="lg" className="w-full" onClick={goNext}>
              Continue
            </Button>
            <button
              type="button"
              className="w-full t-label-sm hover:text-[var(--color-text)] transition-colors"
              onClick={() => {
                setBodyFatInput('');
                goNext();
              }}
            >
              I don&apos;t know — skip
            </button>
          </div>
        </motion.div>
      )}

      {/* Step: Activity level */}
      {step === 'activity' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Daily activity</p>
            <h4 className="t-title">How active are you?</h4>
            <p className="t-caption mt-3 max-w-[38ch]">
              Lifestyle and training combined. Pick the lower option when torn — this is only a
              starting estimate, and it gets corrected once there is enough logged data.
            </p>
          </div>

          {renderOptionRow(ACTIVITY_OPTIONS, activity, setActivity)}

          <Button size="lg" className="w-full" onClick={goNext}>
            Continue
          </Button>
        </motion.div>
      )}

      {/* Step: Goal + rate */}
      {step === 'goal' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Nutrition goal</p>
            <h4 className="t-title">What are you optimising for?</h4>
            <p className="t-caption mt-3 max-w-[34ch]">This sets how fast your weight should move.</p>
          </div>

          {renderOptionRow(GOAL_OPTIONS, goal, selectGoal)}

          {showsRateControl && (
            <div className="pt-8 border-t border-[var(--color-border)]">
              <p className="t-label mb-4">Rate of change</p>

              <div className="flex items-center justify-between gap-6">
                <button
                  type="button"
                  aria-label="Slower"
                  disabled={roundRate(rate) <= rateMin + 1e-9}
                  className="pressable studio-secondary-action shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-30 transition-opacity"
                  onClick={() => setRate(Math.max(rateMin, roundRate(rate - RATE_STEP)))}
                >
                  <Minus className="w-4 h-4" strokeWidth={1.75} />
                </button>

                <div className="text-center">
                  <span className="number-large text-[var(--color-text)] tabular-nums">
                    {displayedRate > 0 ? '+' : ''}
                    {displayedRate.toFixed(2)}
                  </span>
                  <span className="t-caption text-[var(--color-text-dim)] ml-1">
                    %
                  </span>
                  <p className="t-caption mt-1">
                    of bodyweight per {gainGoal ? 'month' : 'week'}
                  </p>
                </div>

                <button
                  type="button"
                  aria-label="Faster"
                  disabled={roundRate(rate) >= rateMax - 1e-9}
                  className="pressable studio-secondary-action shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-30 transition-opacity"
                  onClick={() => setRate(Math.min(rateMax, roundRate(rate + RATE_STEP)))}
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              <p className="t-caption mt-5 max-w-[38ch]">
                About {weeklyChangeInUnit.toFixed(2)} {weightUnitLabel} a week at your current
                bodyweight.
              </p>
            </div>
          )}

          <Button size="lg" className="w-full" onClick={goNext}>
            Review targets
          </Button>
        </motion.div>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-border)]">
            <p className="t-label mt-5 mb-3">Suggested daily targets</p>
            <h4 className="t-title">Based on your profile</h4>
          </div>

          {/* Calories hero — the data is the point */}
          <div>
            <p className="t-label-sm mb-1">Daily calories</p>
            <div className="flex items-baseline gap-2">
              <span className="number-hero text-[var(--color-text)]">{result.calories.toLocaleString()}</span>
              <span className="t-caption text-[var(--color-text-dim)]">kcal</span>
            </div>
            <p className="t-data-sm text-[var(--color-muted)] mt-2">
              {result.tdeeIsMeasured ? 'Measured' : 'Estimated'} burn {result.tdee.toLocaleString()} kcal
              {' · '}
              {GOAL_OPTIONS.find((o) => o.value === goal)?.label}
            </p>
          </div>

          {/* Macro breakdown */}
          <dl className="border-t border-[var(--color-border)]">
            {[
              { label: 'Protein', grams: result.protein, pct: percentages.protein },
              { label: 'Carbs', grams: result.carbs, pct: percentages.carbs },
              { label: 'Fat', grams: result.fat, pct: percentages.fat },
            ].map((macro) => (
              <div
                key={macro.label}
                className="flex items-baseline justify-between gap-4 py-4 border-b border-[var(--color-border)]"
              >
                <dt className="t-label-sm">{macro.label}</dt>
                <dd className="flex items-baseline gap-3">
                  <span className="t-data-sm text-[var(--color-muted)] tabular-nums">{macro.pct}%</span>
                  <span className="flex items-baseline gap-1">
                    <span className="number-large text-[var(--color-text)]">{macro.grams}</span>
                    <span className="t-data-sm text-[var(--color-muted)]">g</span>
                  </span>
                </dd>
              </div>
            ))}
          </dl>

          {/* Projected trajectory */}
          {goal !== 'maintain' && (
            <div>
              <p className="t-label-sm mb-1">Projected change</p>
              <p className="t-data-sm text-[var(--color-text)]">
                {result.projectedKgPerWeek > 0 ? '+' : '−'}
                {weeklyChangeInUnit.toFixed(2)} {weightUnitLabel} per week
              </p>
            </div>
          )}

          {/* Guard notes — the accent marks the one thing that changed */}
          {result.notes.length > 0 && (
            <ul className="space-y-3">
              {result.notes.map((note) => (
                <li
                  key={note.code}
                  className="t-caption max-w-[44ch]"
                >
                  {note.message}
                </li>
              ))}
            </ul>
          )}

          {/* Methodology note */}
          <p className="t-caption max-w-[44ch]">
            {result.bmrMethod === 'katch_mcardle'
              ? `Katch-McArdle resting rate (${result.bmr} kcal) from your lean mass, protein set per kg of fat-free mass.`
              : `Mifflin-St Jeor resting rate (${result.bmr} kcal), protein set per kg of bodyweight. Add body fat for a lean-mass-based estimate.`}
          </p>

          <div className="space-y-3">
            <Button size="lg" className="w-full" onClick={handleApply}>
              Apply these targets
            </Button>
            <p className="t-caption text-center">
              You can fine-tune values manually after applying.
            </p>
          </div>
        </motion.div>
      )}
    </div>
  );
}
