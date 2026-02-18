import { useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { Button, Card } from '@/components/shared';
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
    <div className="grid grid-cols-1 gap-2">
      {options.map((option) => {
        const active = selected === option.value;
        return (
          <button
            key={option.value}
            className={`w-full text-left p-3 rounded-[14px] border transition-colors ${
              active
                ? 'bg-[#E8E4DE] text-[#1A1A1A] border-[#E8E4DE]'
                : 'bg-[var(--color-card)] text-[var(--color-muted)] border-[var(--color-border)] hover:border-[color-mix(in_srgb,var(--color-border)_100%,var(--color-text)_20%)]'
            }`}
            onClick={() => onSelect(option.value)}
          >
            <p className="text-xs font-medium">{option.label}</p>
            <p className={`text-[10px] mt-1 ${active ? 'text-[#3D3D3D]' : 'text-[var(--color-muted)]'}`}>
              {option.hint}
            </p>
          </button>
        );
      })}
    </div>
  );

  const renderNumericInput = (
    label: string,
    value: string,
    onChange: (val: string) => void,
    suffix?: string
  ) => (
    <div>
      <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="number"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-4 py-3 rounded-[14px] bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] text-sm tabular-nums focus:outline-none focus:border-[var(--color-text)] transition-colors"
        />
        {suffix && (
          <span className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] min-w-[2rem]">
            {suffix}
          </span>
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
    <div className="space-y-5">
      {/* Back button */}
      <button
        className="flex items-center gap-2 text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
        onClick={goBack}
      >
        <ChevronLeft className="w-3 h-3" />
        {stepIndex === 0 ? 'Cancel' : 'Back'}
      </button>

      {/* Step: Units + Sex */}
      {step === 'units' && (
        <Card variant="slab" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] mb-1">
              Nutrition Calculator
            </p>
            <h4 className="text-sm text-[var(--color-text)]">Units & biological sex</h4>
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              Sex affects basal metabolic rate estimation
            </p>
          </div>

          <div>
            <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] mb-2">
              Unit system
            </p>
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
            <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)] mb-2">
              Biological sex
            </p>
            {renderOptionRow(SEX_OPTIONS, sex, setSex)}
          </div>

          <Button className="w-full" onClick={goNext}>
            Continue
          </Button>
        </Card>
      )}

      {/* Step: Body measurements */}
      {step === 'body' && (
        <Card variant="slab" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] mb-1">
              Body Measurements
            </p>
            <h4 className="text-sm text-[var(--color-text)]">Your current stats</h4>
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              Used to estimate your basal metabolic rate
            </p>
          </div>

          {renderNumericInput('Age', age, setAge, 'yrs')}

          {renderNumericInput(
            'Body weight',
            weightInput,
            setWeightInput,
            unitSystem === 'imperial' ? 'lbs' : 'kg'
          )}

          {unitSystem === 'imperial' ? (
            <div>
              <label className="block text-[10px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">
                Height
              </label>
              <div className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  value={heightFeet}
                  onChange={(e) => setHeightFeet(e.target.value)}
                  className="min-w-0 px-4 py-3 rounded-[14px] bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] text-sm tabular-nums focus:outline-none focus:border-[var(--color-text)] transition-colors"
                />
                <span className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">ft</span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={heightInches}
                  onChange={(e) => setHeightInches(e.target.value)}
                  className="min-w-0 px-4 py-3 rounded-[14px] bg-[var(--color-card)] border border-[var(--color-border)] text-[var(--color-text)] text-sm tabular-nums focus:outline-none focus:border-[var(--color-text)] transition-colors"
                />
                <span className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">in</span>
              </div>
            </div>
          ) : (
            renderNumericInput('Height', heightCmInput, setHeightCmInput, 'cm')
          )}

          <Button className="w-full" onClick={goNext} disabled={!canProceedFromBody}>
            Continue
          </Button>
        </Card>
      )}

      {/* Step: Activity level */}
      {step === 'activity' && (
        <Card variant="slab" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] mb-1">
              Daily Activity
            </p>
            <h4 className="text-sm text-[var(--color-text)]">How active are you?</h4>
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              Includes training, daily movement, and job activity
            </p>
          </div>

          {renderOptionRow(ACTIVITY_OPTIONS, activity, setActivity)}

          <Button className="w-full" onClick={goNext}>
            Continue
          </Button>
        </Card>
      )}

      {/* Step: Goal */}
      {step === 'goal' && (
        <Card variant="slab" className="space-y-5">
          <div>
            <p className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] mb-1">
              Nutrition Goal
            </p>
            <h4 className="text-sm text-[var(--color-text)]">What are you optimizing for?</h4>
            <p className="text-[10px] text-[var(--color-muted)] mt-1">
              This sets your calorie surplus or deficit
            </p>
          </div>

          {renderOptionRow(GOAL_OPTIONS, goal, setGoal)}

          <Button className="w-full" onClick={goNext}>
            Review Targets
          </Button>
        </Card>
      )}

      {/* Step: Review */}
      {step === 'review' && (
        <>
          <Card variant="slab" className="space-y-4">
            <div>
              <p className="text-[10px] tracking-[0.15em] uppercase text-[var(--color-muted)] mb-1">
                Suggested Daily Targets
              </p>
              <h4 className="text-sm text-[var(--color-text)]">Based on your profile</h4>
            </div>

            {/* Calories hero */}
            <div className="p-4 rounded-[18px] bg-[var(--color-base)] border border-[var(--color-border)]">
              <p className="text-[10px] tracking-[0.12em] uppercase text-[var(--color-muted)]">
                Daily Calories
              </p>
              <p className="text-3xl font-display-italic text-[var(--color-text)] tabular-nums mt-1">
                {result.calories.toLocaleString()}
              </p>
              <p className="text-[10px] text-[var(--color-muted)] mt-1 tabular-nums">
                TDEE: {result.tdee.toLocaleString()} kcal ·{' '}
                {GOAL_OPTIONS.find((o) => o.value === goal)?.label}
              </p>
            </div>

            {/* Macro breakdown */}
            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 rounded-[14px] bg-[var(--color-base)] border border-[var(--color-border)] text-center">
                <p className="text-[9px] tracking-[0.12em] uppercase text-[var(--color-muted)]">Protein</p>
                <p className="text-lg font-display-italic text-[var(--color-text)] tabular-nums mt-1">
                  {result.protein}g
                </p>
                <p className="text-[9px] text-[var(--color-muted)] tabular-nums">
                  {Math.round((result.protein * 4 / result.calories) * 100)}%
                </p>
              </div>
              <div className="p-3 rounded-[14px] bg-[var(--color-base)] border border-[var(--color-border)] text-center">
                <p className="text-[9px] tracking-[0.12em] uppercase text-[var(--color-muted)]">Carbs</p>
                <p className="text-lg font-display-italic text-[var(--color-text)] tabular-nums mt-1">
                  {result.carbs}g
                </p>
                <p className="text-[9px] text-[var(--color-muted)] tabular-nums">
                  {Math.round((result.carbs * 4 / result.calories) * 100)}%
                </p>
              </div>
              <div className="p-3 rounded-[14px] bg-[var(--color-base)] border border-[var(--color-border)] text-center">
                <p className="text-[9px] tracking-[0.12em] uppercase text-[var(--color-muted)]">Fat</p>
                <p className="text-lg font-display-italic text-[var(--color-text)] tabular-nums mt-1">
                  {result.fat}g
                </p>
                <p className="text-[9px] text-[var(--color-muted)] tabular-nums">
                  {Math.round((result.fat * 9 / result.calories) * 100)}%
                </p>
              </div>
            </div>

            {/* Methodology note */}
            <p className="text-[9px] tracking-[0.08em] text-[var(--color-muted)] leading-relaxed">
              Calculated using Mifflin-St Jeor BMR ({result.bmr} kcal) ×{' '}
              {ACTIVITY_OPTIONS.find((o) => o.value === activity)?.label.toLowerCase()} activity multiplier.
              Protein set at {goal === 'cut' ? '2.2' : '1.8'} g/kg for{' '}
              {goal === 'cut' ? 'muscle preservation in a deficit' : 'hypertrophy support'}.
            </p>
          </Card>

          <div className="space-y-2">
            <Button className="w-full" onClick={() => onApply(result)}>
              Apply These Targets
            </Button>
            <p className="text-[10px] text-center text-[var(--color-muted)]">
              You can fine-tune values manually after applying
            </p>
          </div>
        </>
      )}
    </div>
  );
}
