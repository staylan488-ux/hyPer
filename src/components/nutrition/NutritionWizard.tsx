import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/shared';
import { springs } from '@/lib/animations';
import { kgToLbs, macroCaloriePercentages } from '@/lib/nutritionCalculator';
import type { NutritionProfile } from '@/lib/nutritionProfile';
import {
  ACTIVITY_OPTIONS,
  GOAL_OPTIONS,
  SEX_OPTIONS,
  UNIT_OPTIONS,
  initialWizardDraft,
  selectWizardGoal,
  stepWizardRate,
  switchWizardUnits,
  wizardBodyFatPct,
  wizardBodyReady,
  wizardBurns,
  wizardMethodNote,
  wizardOutcome,
  wizardRateBounds,
  wizardRateDisplay,
  wizardResult,
  wizardWeightKg,
  type NutritionWizardOutcome,
  type WizardDraft,
  type WizardOption,
} from '@/lib/nutritionWizard';

export type { NutritionWizardOutcome } from '@/lib/nutritionWizard';

interface NutritionWizardProps {
  /** Saved profile, so the wizard resumes instead of resetting to defaults. */
  initialProfile?: NutritionProfile | null;
  /** Most recent weigh-in, so bodyweight is not re-typed. */
  initialWeightKg?: number | null;
  onApply: (outcome: NutritionWizardOutcome) => void;
  onCancel: () => void;
  saving?: boolean;
  saveError?: string | null;
  onDraftChange?: (dirty: boolean) => void;
}

type WizardStep = 'units' | 'body' | 'composition' | 'activity' | 'goal' | 'review';

type Option<T extends string> = WizardOption<T>;

const STEPS: WizardStep[] = ['units', 'body', 'composition', 'activity', 'goal', 'review'];

export function NutritionWizard({
  initialProfile,
  initialWeightKg,
  onApply,
  onCancel,
  saving = false,
  saveError = null,
  onDraftChange,
}: NutritionWizardProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<WizardDraft>(() => initialWizardDraft(initialProfile, initialWeightKg));
  const update = (patch: Partial<WizardDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const { unitSystem, sex, age, activity, goal } = draft;
  const weightInput = draft.weight;
  const heightFeet = draft.heightFeet;
  const heightInches = draft.heightInches;
  const heightCmInput = draft.heightCm;
  const bodyFatInput = draft.bodyFat;
  const setSex = (next: WizardDraft['sex']) => update({ sex: next });
  const setAge = (next: string) => update({ age: next });
  const setWeightInput = (next: string) => update({ weight: next });
  const setHeightFeet = (next: string) => update({ heightFeet: next });
  const setHeightInches = (next: string) => update({ heightInches: next });
  const setHeightCmInput = (next: string) => update({ heightCm: next });
  const setBodyFatInput = (next: string) => update({ bodyFat: next });
  const setActivity = (next: WizardDraft['activity']) => update({ activity: next });

  const [step, setStep] = useState<WizardStep>('units');
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef<WizardStep>(step);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const heading = stepHeading.current;
    if (!heading || heading.closest('[hidden]')) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [step]);

  const stepIndex = STEPS.indexOf(step);

  const goBack = () => {
    if (stepIndex > 0) setStep(STEPS[stepIndex - 1]);
    else onCancel();
  };

  const goNext = () => {
    if (stepIndex < STEPS.length - 1) setStep(STEPS[stepIndex + 1]);
  };

  const selectGoal = (next: WizardDraft['goal']) => setDraft((current) => selectWizardGoal(current, next));

  const weightKg = useMemo(() => wizardWeightKg(draft), [draft]);
  const bodyFatPct = useMemo(() => wizardBodyFatPct(draft), [draft]);
  const result = useMemo(() => wizardResult(draft, initialProfile), [draft, initialProfile]);
  const percentages = useMemo(() => macroCaloriePercentages(result), [result]);

  const rateBounds = wizardRateBounds(draft);
  const showsRateControl = goal !== 'maintain';
  const burns = wizardBurns(draft, initialProfile);

  const rateDisplay = wizardRateDisplay(draft, result);
  const displayedRate = rateDisplay.value;
  const weeklyChangeInUnit = rateDisplay.weeklyChange;
  const weightUnitLabel = rateDisplay.unit;

  const handleApply = () => onApply(wizardOutcome(draft, initialProfile));

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
              className="metal-row you-row"
              onClick={() => {
                if (option.value === selected) return;
                onDraftChange?.(true);
                onSelect(option.value);
              }}
            >
              <span className="flex-1 min-w-0">
                <span className={`metal-row-title ${active ? '' : 'text-[var(--metal-ink-2)]'}`}>
                  {option.label}
                </span>
                <span className="metal-row-detail">{option.hint}</span>
              </span>
              <svg
                className={`you-check ${active ? '' : 'invisible'}`}
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 8.5l3.2 3L13 4.5" />
              </svg>
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
      <label htmlFor={`${inputId}-${label.replaceAll(' ', '-')}`} className="t-label block mb-2">{label}</label>
      <div className="you-field">
        <input
          id={`${inputId}-${label.replaceAll(' ', '-')}`}
          aria-label={`${label}${suffix ? ` (${suffix})` : ''}`}
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            if (e.target.value !== value) onDraftChange?.(true);
            onChange(e.target.value);
          }}
          className="flex-1 min-w-0 px-0 py-3 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)]"
        />
        {suffix && <span className="you-field-unit">{suffix}</span>}
      </div>
    </div>
  );

  const canProceedFromBody = wizardBodyReady(draft);

  return (
    <div className="space-y-7">
      {/* Step dateline */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={saving}
          className="min-h-11 flex items-center gap-1.5 text-[15px] text-[var(--metal-ink-2)] hover:text-[var(--color-text)] transition-colors"
          onClick={goBack}
        >
          <ChevronLeft className="w-3 h-3" strokeWidth={1.75} />
          {stepIndex === 0 ? 'Cancel' : 'Back'}
        </button>
        <span className="text-[13px] tabular-nums text-[var(--metal-ink-2)]">
          {String(stepIndex + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </span>
      </div>

      {/* Step progress — hairline ticks */}
      <div className="metal-segs is-wide !mt-1" aria-hidden>
        {STEPS.map((s, i) => (
          <span key={s} className={i <= stepIndex ? 'is-on' : undefined} />
        ))}
      </div>

      {/* Step: Units + Sex */}
      {step === 'units' && (
        <motion.div
          className="space-y-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.settle}
        >
          <div className="pt-5 metal-rule">
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">Units &amp; biological sex</h2>
            <p className="you-copy mt-3 max-w-[34ch]">Sex affects basal metabolic rate estimation.</p>
          </div>

          <div>
            <p className="t-label mb-2">Unit system</p>
            {renderOptionRow(UNIT_OPTIONS, unitSystem, (v) => {
              if (v === unitSystem) return;
              setDraft((current) => switchWizardUnits(current, v));
            })}
          </div>

          <div>
            <p className="t-label mb-2">Biological sex</p>
            {renderOptionRow(SEX_OPTIONS, sex, setSex)}
          </div>

          <Button size="lg" className="w-full normal-case tracking-normal text-sm" onClick={goNext}>
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
          transition={springs.settle}
        >
          <div className="pt-1 metal-rule">
            <p className="t-label mt-5 mb-3">Body measurements</p>
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">Your current stats</h2>
            <p className="you-copy mt-3 max-w-[34ch]">
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
                <p className="t-label block mb-2">Height</p>
                <div className="grid grid-cols-2 gap-6">
                  <div className="you-field">
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="Height (feet)"
                      value={heightFeet}
                      onChange={(e) => {
                        if (e.target.value !== heightFeet) onDraftChange?.(true);
                        setHeightFeet(e.target.value);
                      }}
                      className="flex-1 min-w-0 px-0 py-3 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)]"
                    />
                    <span className="you-field-unit">ft</span>
                  </div>
                  <div className="you-field">
                    <input
                      type="number"
                      inputMode="numeric"
                      aria-label="Height (inches)"
                      value={heightInches}
                      onChange={(e) => {
                        if (e.target.value !== heightInches) onDraftChange?.(true);
                        setHeightInches(e.target.value);
                      }}
                      className="flex-1 min-w-0 px-0 py-3 bg-transparent border-0 text-[var(--color-text)] text-[1rem] tabular-nums [font-family:var(--font-sans)]"
                    />
                    <span className="you-field-unit">in</span>
                  </div>
                </div>
              </div>
            ) : (
              renderNumericInput('Height', heightCmInput, setHeightCmInput, 'cm')
            )}
          </div>

          <Button size="lg" className="w-full normal-case tracking-normal text-sm" onClick={goNext} disabled={!canProceedFromBody}>
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
          transition={springs.settle}
        >
          <div className="pt-1 metal-rule">
            <p className="t-label mt-5 mb-3">Body composition</p>
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">Body fat, if you know it</h2>
            <p className="you-copy mt-3 max-w-[38ch]">
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
            <Button size="lg" className="w-full normal-case tracking-normal text-sm" onClick={goNext}>
              Continue
            </Button>
            <button
              type="button"
              className="min-h-11 w-full text-sm hover:text-[var(--color-text)] transition-colors"
              onClick={() => {
                if (bodyFatInput !== '') onDraftChange?.(true);
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
          transition={springs.settle}
        >
          <div className="pt-1 metal-rule">
            <p className="t-label mt-5 mb-3">Daily activity</p>
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">How active are you?</h2>
            <p className="you-copy mt-3 max-w-[38ch]">
              Lifestyle and training combined. Pick the lower option when torn — this is only a
              starting estimate. With adaptive targets enabled, logged data can refine it over time.
            </p>
          </div>

          {renderOptionRow(ACTIVITY_OPTIONS, activity, setActivity)}

          <Button size="lg" className="w-full normal-case tracking-normal text-sm" onClick={goNext}>
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
          transition={springs.settle}
        >
          <div className="pt-1 metal-rule">
            <p className="t-label mt-5 mb-3">Nutrition goal</p>
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">What are you optimising for?</h2>
            <p className="you-copy mt-3 max-w-[34ch]">This sets how fast your weight should move.</p>
          </div>

          {renderOptionRow(GOAL_OPTIONS, goal, selectGoal)}

          {showsRateControl && (
            <div className="pt-8 metal-rule">
              <p className="t-label mb-4">Rate of change</p>

              <div className="flex items-center justify-between gap-6">
                <button
                  type="button"
                  aria-label="Slower"
                  disabled={!rateBounds.slower}
                  className="pressable metal-step-btn shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-30 transition-opacity"
                  onClick={() => {
                    onDraftChange?.(true);
                    setDraft((current) => stepWizardRate(current, -1));
                  }}
                >
                  <Minus className="w-4 h-4" strokeWidth={1.75} />
                </button>

                <div className="text-center">
                  <span className="metal-step-value">
                    {displayedRate > 0 ? '+' : ''}
                    {displayedRate.toFixed(2)}
                  </span>
                  <span className="text-sm leading-relaxed text-[var(--color-text-dim)] ml-1">
                    %
                  </span>
                  <p className="text-sm leading-relaxed text-[var(--color-text-dim)] mt-1">
                    of bodyweight per week
                  </p>
                </div>

                <button
                  type="button"
                  aria-label="Faster"
                  disabled={!rateBounds.faster}
                  className="pressable metal-step-btn shrink-0 w-11 h-11 flex items-center justify-center disabled:opacity-30 transition-opacity"
                  onClick={() => {
                    onDraftChange?.(true);
                    setDraft((current) => stepWizardRate(current, 1));
                  }}
                >
                  <Plus className="w-4 h-4" strokeWidth={1.75} />
                </button>
              </div>

              <p className="text-sm leading-relaxed text-[var(--color-text-dim)] mt-5 max-w-[38ch]">
                About {weeklyChangeInUnit.toFixed(2)} {weightUnitLabel} a week
                ({rateDisplay.monthlyChange.toFixed(1)} {weightUnitLabel} a month) at your current
                bodyweight.
              </p>
            </div>
          )}

          <Button size="lg" className="w-full normal-case tracking-normal text-sm" onClick={goNext}>
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
          transition={springs.settle}
        >
          <div className="pt-1 metal-rule">
            <p className="t-label mt-5 mb-3">Suggested daily targets</p>
            <h2 ref={stepHeading} tabIndex={-1} className="you-step-title scroll-mt-4 outline-none">Based on your profile</h2>
          </div>

          {/* Calories hero — the data is the point */}
          <div>
            <p className="t-label-sm mb-1">Daily calories</p>
            <div className="metal-big">
              <span className="metal-num">{result.calories.toLocaleString()}</span>
              <span className="metal-unit">kcal</span>
            </div>
            <p className="text-[12.5px] tabular-nums text-[var(--metal-ink-2)] mt-2">
              {result.tdeeIsMeasured ? 'Learned daily-burn estimate' : 'Estimated daily burn'} {result.tdee.toLocaleString()} kcal
              {' · '}
              {GOAL_OPTIONS.find((o) => o.value === goal)?.label}
            </p>
          </div>

          {/* Which daily burn to build on, when the app has learned one */}
          {burns.learned !== null && (
            <div>
              <p className="t-label mb-2">Daily burn</p>
              {renderOptionRow<WizardDraft['burn']>(
                [
                  { value: 'learned', label: `Learned · ${burns.learned.toLocaleString()} kcal`, hint: 'From your food logs and weigh-ins; targets keep adapting' },
                  { value: 'formula', label: `Formula · ${burns.formula.toLocaleString()} kcal`, hint: 'From your body and activity; targets stay as set' },
                ],
                draft.burn,
                (burn) => update({ burn }),
              )}
            </div>
          )}

          {/* Macro breakdown */}
          <dl>
            {[
              { label: 'Protein', grams: result.protein, pct: percentages.protein },
              { label: 'Carbs', grams: result.carbs, pct: percentages.carbs },
              { label: 'Fat', grams: result.fat, pct: percentages.fat },
            ].map((macro) => (
              <div
                key={macro.label}
                className="metal-row you-figure-row"
              >
                <dt>{macro.label}</dt>
                <dd className="flex items-baseline gap-3">
                  <span className="text-[12.5px] text-[var(--metal-ink-2)] tabular-nums">{macro.pct}%</span>
                  <span className="you-figure-value">
                    <span className="metal-num">{macro.grams}</span>
                    <span className="metal-unit">g</span>
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
                  className="text-sm leading-relaxed text-[var(--color-text-dim)] max-w-[44ch]"
                >
                  {note.message}
                </li>
              ))}
            </ul>
          )}

          {/* Methodology note */}
          <p className="text-sm leading-relaxed text-[var(--color-text-dim)] max-w-[44ch]">
            {wizardMethodNote(result)}
          </p>

          <div className="space-y-3">
            <Button size="lg" className="w-full normal-case tracking-normal text-sm" loading={saving} onClick={handleApply}>
              Save profile &amp; review targets
            </Button>
            <p className="text-sm leading-relaxed text-[var(--color-text-dim)] text-center">
              Saves these profile details and records a changed weight. Save targets on the next
              screen to use these suggested numbers. If adaptive targets are active, saved profile
              and weight changes can also affect a later automatic update.
            </p>
            {saveError && <p role="alert" className="text-sm leading-relaxed text-[var(--color-accent)]">{saveError}</p>}
          </div>
        </motion.div>
      )}
    </div>
  );
}
