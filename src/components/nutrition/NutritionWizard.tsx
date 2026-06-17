import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/shared';
import { springs } from '@/lib/animations';
import {
  calculateMacroTargets,
  cmToFeetInches,
  feetInchesToCm,
  kgToLbs,
  lbsToKg,
  type ActivityLevel,
  type BiologicalSex,
  type MacroTargetResult,
  type NutritionGoal,
  type NutritionWizardAnswers,
  type UnitSystem,
} from '@/lib/nutritionCalculator';

interface NutritionWizardProps {
  onApply: (targets: { calories: number; protein: number; carbs: number; fat: number }) => void;
  onCancel: () => void;
}

type WizardStep = 'units' | 'body' | 'activity' | 'goal' | 'review';

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
  { value: 'sedentary', label: 'Sedentary', hint: 'Desk job, little daily movement' },
  { value: 'lightly_active', label: 'Lightly Active', hint: '1–3 training days/week' },
  { value: 'moderately_active', label: 'Moderately Active', hint: '3–5 training days/week' },
  { value: 'very_active', label: 'Very Active', hint: '6–7 hard training days/week' },
  { value: 'extra_active', label: 'Extra Active', hint: 'Physical job + daily training' },
];

const GOAL_OPTIONS: Option<NutritionGoal>[] = [
  { value: 'cut', label: 'Cut', hint: 'Lose fat, preserve muscle' },
  { value: 'maintain', label: 'Maintain', hint: 'Stay at current composition' },
  { value: 'lean_bulk', label: 'Lean Bulk', hint: 'Slow, controlled muscle gain' },
  { value: 'bulk', label: 'Bulk', hint: 'Maximize muscle growth' },
];

const STEPS: WizardStep[] = ['units', 'body', 'activity', 'goal', 'review'];

function clampInput(value: string, min: number, max: number): number {
  const parsed = parseFloat(value);
  if (Number.isNaN(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

export function NutritionWizard({ onApply, onCancel }: NutritionWizardProps) {
  const [step, setStep] = useState<WizardStep>('units');
  const [unitSystem, setUnitSystem] = useState<UnitSystem>('imperial');
  const [sex, setSex] = useState<BiologicalSex>('male');
  const [age, setAge] = useState('25');
  const [weightInput, setWeightInput] = useState('170');
  const [heightFeet, setHeightFeet] = useState('5');
  const [heightInches, setHeightInches] = useState('10');
  const [heightCmInput, setHeightCmInput] = useState('178');
  const [activity, setActivity] = useState<ActivityLevel>('moderately_active');
  const [goal, setGoal] = useState<NutritionGoal>('lean_bulk');

  const stepIndex = STEPS.indexOf(step);

  const goBack = () => {
    if (stepIndex > 0) {
      setStep(STEPS[stepIndex - 1]);
    } else {
      onCancel();
    }
  };

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) {
      setStep(STEPS[stepIndex + 1]);
    }
  };

  const answers: NutritionWizardAnswers = useMemo(() => {
    const weightKg = unitSystem === 'imperial'
      ? lbsToKg(clampInput(weightInput, 60, 700))
      : clampInput(weightInput, 30, 300);

    const heightCm = unitSystem === 'imperial'
      ? feetInchesToCm(clampInput(heightFeet, 3, 8), clampInput(heightInches, 0, 11))
      : clampInput(heightCmInput, 100, 250);

    return {
      sex,
      age: clampInput(age, 13, 100),
      heightCm,
      weightKg,
      activity,
      goal,
      unitSystem,
    };
  }, [sex, age, weightInput, heightFeet, heightInches, heightCmInput, activity, goal, unitSystem]);

  const result: MacroTargetResult = useMemo(() => calculateMacroTargets(answers), [answers]);

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
                active ? 'border-l-2 border-l-[var(--color-accent)] pl-4' : 'pl-[calc(1rem+2px)]'
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
    suffix?: string
  ) => (
    <div>
      <label className="t-label-sm block mb-2">{label}</label>
      <div className="relative flex items-baseline gap-2 border-b border-[var(--color-border-strong)] focus-within:border-[var(--color-text)] transition-colors">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
        />
        {suffix && (
          <span className="t-label-sm shrink-0">{suffix}</span>
        )}
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
          <div className="pt-1 border-t border-[var(--color-text)]">
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
          <div className="pt-1 border-t border-[var(--color-text)]">
            <p className="t-label mt-5 mb-3">Body measurements</p>
            <h4 className="t-title">Your current stats</h4>
            <p className="t-caption mt-3 max-w-[34ch]">Used to estimate your basal metabolic rate.</p>
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
                  <div className="relative flex items-baseline gap-2 border-b border-[var(--color-border-strong)] focus-within:border-[var(--color-text)] transition-colors">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={heightFeet}
                      onChange={(e) => setHeightFeet(e.target.value)}
                      className="flex-1 min-w-0 px-0 py-2 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)] focus:outline-none"
                    />
                    <span className="t-label-sm shrink-0">ft</span>
                  </div>
                  <div className="relative flex items-baseline gap-2 border-b border-[var(--color-border-strong)] focus-within:border-[var(--color-text)] transition-colors">
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

      {/* Step: Activity level */}
      {step === 'activity' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-text)]">
            <p className="t-label mt-5 mb-3">Daily activity</p>
            <h4 className="t-title">How active are you?</h4>
            <p className="t-caption mt-3 max-w-[34ch]">Includes training, daily movement, and job activity.</p>
          </div>

          {renderOptionRow(ACTIVITY_OPTIONS, activity, setActivity)}

          <Button size="lg" className="w-full" onClick={goNext}>
            Continue
          </Button>
        </motion.div>
      )}

      {/* Step: Goal */}
      {step === 'goal' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.smooth}
        >
          <div className="pt-1 border-t border-[var(--color-text)]">
            <p className="t-label mt-5 mb-3">Nutrition goal</p>
            <h4 className="t-title">What are you optimizing for?</h4>
            <p className="t-caption mt-3 max-w-[34ch]">This sets your calorie surplus or deficit.</p>
          </div>

          {renderOptionRow(GOAL_OPTIONS, goal, setGoal)}

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
          <div className="pt-1 border-t border-[var(--color-text)]">
            <p className="t-label mt-5 mb-3">Suggested daily targets</p>
            <h4 className="t-title">Based on your profile</h4>
          </div>

          {/* Calories hero — the data is the point */}
          <div>
            <p className="t-label-sm mb-1">Daily calories</p>
            <div className="flex items-baseline gap-2">
              <span className="number-hero text-[var(--color-text)]">{result.calories.toLocaleString()}</span>
              <span className="[font-family:var(--font-display)] italic text-lg text-[var(--color-text-dim)]">kcal</span>
            </div>
            <p className="t-data-sm text-[var(--color-muted)] mt-2">
              TDEE {result.tdee.toLocaleString()} kcal · {GOAL_OPTIONS.find((o) => o.value === goal)?.label}
            </p>
          </div>

          {/* Macro breakdown — serif numerals on hairline rows */}
          <dl className="border-t border-[var(--color-text)]">
            {[
              { label: 'Protein', grams: result.protein, pct: Math.round((result.protein * 4 / result.calories) * 100) },
              { label: 'Carbs', grams: result.carbs, pct: Math.round((result.carbs * 4 / result.calories) * 100) },
              { label: 'Fat', grams: result.fat, pct: Math.round((result.fat * 9 / result.calories) * 100) },
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

          {/* Methodology note */}
          <p className="t-caption max-w-[44ch]">
            Calculated using Mifflin-St Jeor BMR ({result.bmr} kcal) ×{' '}
            {ACTIVITY_OPTIONS.find((o) => o.value === activity)?.label.toLowerCase()} activity multiplier.
            Protein set at {goal === 'cut' ? '2.2' : '1.8'} g/kg for{' '}
            {goal === 'cut' ? 'muscle preservation in a deficit' : 'hypertrophy support'}.
          </p>

          <div className="space-y-3">
            <Button size="lg" className="w-full" onClick={() => onApply(result)}>
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
