import { useState } from 'react';
import { Check, Pencil, RotateCcw } from 'lucide-react';
import { motion } from 'motion/react';
import { useAppStore } from '@/stores/appStore';
import { springs } from '@/lib/animations';
import { compareSetPerformance, formatSetPerformanceTarget } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';
import type { AutofillSetValues } from '@/lib/setAutofill';

interface PreviousTarget {
  weight: number | null;
  reps: number | null;
  rpe: number | null;
}

interface WorkoutSetRowProps {
  set: WorkoutSet;
  setNumber: number;
  autofillValues?: AutofillSetValues | null;
  previousTarget?: PreviousTarget | null;
  /** This is the next set to log — gets the live amber tick */
  isNext?: boolean;
  onComplete?: (set: WorkoutSet) => void;
  onBeforeComplete?: (set: WorkoutSet) => Promise<true | string> | true | string;
}

/**
 * Persistent, thumb-first set row. Weight/reps/RPE live in milled wells with the
 * log action on the thumb side. Previous performance rides along as ghost
 * placeholders and a "last" line — never a separate card.
 */
export function WorkoutSetRow({
  set,
  setNumber,
  autofillValues,
  previousTarget,
  isNext = false,
  onComplete,
  onBeforeComplete,
}: WorkoutSetRowProps) {
  const { logSet } = useAppStore();
  const [weight, setWeight] = useState(set.weight?.toString() || '');
  const [reps, setReps] = useState(set.reps?.toString() || '');
  const [rpe, setRpe] = useState(set.rpe?.toString() || '');
  const [isEditing, setIsEditing] = useState(!set.completed);
  const [saving, setSaving] = useState(false);

  const formattedTarget = previousTarget ? formatSetPerformanceTarget(previousTarget) : '';
  const performanceStatus =
    set.completed && previousTarget
      ? compareSetPerformance({ weight: set.weight, reps: set.reps }, previousTarget)
      : 'unknown';

  const handleAutofill = () => {
    if (!autofillValues) return;
    setWeight(autofillValues.weight);
    setReps(autofillValues.reps);
    setRpe(autofillValues.rpe);
  };

  const handleSave = async () => {
    if (!weight || !reps || saving) return;

    try {
      setSaving(true);

      if (onBeforeComplete) {
        const verdict = await onBeforeComplete(set);
        if (verdict !== true) {
          if (typeof verdict === 'string' && verdict.trim()) {
            window.alert(verdict);
          }
          return;
        }
      }

      await logSet(
        set.exercise_id,
        set.set_number,
        parseFloat(weight),
        parseInt(reps),
        rpe ? parseFloat(rpe) : undefined
      );

      setIsEditing(false);
      onComplete?.(set);
    } catch (error) {
      console.error('Failed to log set:', error);
    } finally {
      setSaving(false);
    }
  };

  /* ── Completed (ledger line) ── */
  if (set.completed && !isEditing) {
    const statusLabel =
      performanceStatus === 'beat' ? 'Beat' : performanceStatus === 'matched' ? 'Matched' : performanceStatus === 'below' ? 'Below' : null;
    const statusColor =
      performanceStatus === 'beat'
        ? 'var(--color-sage)'
        : performanceStatus === 'matched'
          ? 'var(--color-stone)'
          : 'var(--color-rose)';

    return (
      <motion.div
        className="flex items-center gap-3 min-h-12 px-3 bg-sage-tint rounded-[var(--radius-md)]"
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={springs.smooth}
      >
        <motion.span
          className="flex items-center justify-center w-6 h-6 rounded-full bg-[color-mix(in_srgb,var(--color-sage)_22%,transparent)] shrink-0"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.15, 1] }}
          transition={{ ...springs.bouncy, duration: 0.45 }}
        >
          <svg className="w-3 h-3 text-[var(--color-sage)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <motion.path
              d="M5 13l4 4L19 7"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.35, delay: 0.08, ease: 'easeOut' }}
              strokeDasharray="0 1"
            />
          </svg>
        </motion.span>
        <span className="t-data-sm text-[var(--color-muted)] w-7 shrink-0">{String(setNumber).padStart(2, '0')}</span>
        <div className="flex items-baseline gap-3 flex-1 min-w-0 t-data text-[var(--color-text)]">
          <span>{set.weight}<span className="text-[var(--color-muted)] text-[11px] ml-0.5">lb</span></span>
          <span>{set.reps}<span className="text-[var(--color-muted)] text-[11px] ml-0.5">reps</span></span>
          {set.rpe != null && <span className="text-[var(--color-sage)] font-semibold">@{set.rpe}</span>}
        </div>
        {statusLabel && (
          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] shrink-0" style={{ color: statusColor }}>
            {statusLabel}
          </span>
        )}
        <motion.button
          className="p-2.5 -mr-1 hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)] rounded-[var(--radius-sm)] transition-colors shrink-0"
          onClick={() => setIsEditing(true)}
          whileTap={{ scale: 0.9 }}
          aria-label={`Edit set ${setNumber}`}
        >
          <Pencil className="w-3 h-3 text-[var(--color-muted)]" />
        </motion.button>
      </motion.div>
    );
  }

  /* ── Logging (live row) ── */
  const canLog = Boolean(weight && reps) && !saving;

  return (
    <div
      className={`rounded-[var(--radius-md)] px-3 py-2.5 bg-[var(--color-surface-1)] border ${
        isNext ? 'border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)]' : 'border-[var(--color-border)]'
      }`}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex flex-col items-center w-7 shrink-0">
          <span className={`t-data-sm ${isNext ? 'text-[var(--color-accent)]' : 'text-[var(--color-muted)]'}`}>
            {String(setNumber).padStart(2, '0')}
          </span>
          {isNext && <span className="mt-1 w-[3px] h-2 rounded-full bg-[var(--color-accent)] animate-tick-live" />}
        </div>

        <div className="grid grid-cols-3 gap-1.5 flex-1 min-w-0">
          <SetInput
            value={weight}
            onChange={setWeight}
            placeholder={previousTarget?.weight != null ? String(previousTarget.weight) : '0'}
            unit="lb"
            inputMode="decimal"
            disabled={saving}
          />
          <SetInput
            value={reps}
            onChange={setReps}
            placeholder={previousTarget?.reps != null ? String(previousTarget.reps) : '0'}
            unit="reps"
            inputMode="numeric"
            disabled={saving}
          />
          <SetInput
            value={rpe}
            onChange={setRpe}
            placeholder={previousTarget?.rpe != null ? String(previousTarget.rpe) : '—'}
            unit="rpe"
            inputMode="decimal"
            disabled={saving}
            min={1}
            max={10}
            step={0.5}
          />
        </div>

        <motion.button
          type="button"
          onClick={handleSave}
          disabled={!canLog}
          whileTap={canLog ? { scale: 0.92 } : undefined}
          transition={springs.snappy}
          aria-label={`Log set ${setNumber}`}
          className={`flex items-center justify-center w-12 h-12 rounded-[var(--radius-sm)] shrink-0 transition-all ${
            canLog
              ? '[background:var(--grad-amber)] text-[var(--button-primary-fg)] shadow-[var(--glow-amber)]'
              : 'bg-[var(--color-surface-2)] hairline text-[var(--color-muted)] opacity-60'
          }`}
        >
          {saving ? (
            <motion.span
              className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }}
            />
          ) : (
            <Check className="w-[18px] h-[18px]" strokeWidth={2.75} />
          )}
        </motion.button>
      </div>

      {(formattedTarget || autofillValues) && (
        <div className="flex items-center justify-between mt-2 pl-9">
          <span className="text-[11px] text-[var(--color-muted)]">
            {formattedTarget ? (
              <>Last <span className="t-data-sm text-[var(--color-text-dim)]">{formattedTarget}</span></>
            ) : (
              ' '
            )}
          </span>
          {autofillValues && (
            <button
              type="button"
              onClick={handleAutofill}
              disabled={saving}
              className="pressable flex items-center gap-1 text-[11px] font-semibold text-[var(--color-text-dim)] px-2 py-1 -mr-1 rounded-[var(--radius-xs)] hover:text-[var(--color-text)]"
            >
              <RotateCcw className="w-3 h-3" strokeWidth={2.25} />
              {autofillValues.source === 'current_workout' ? 'Repeat last set' : 'Use last workout'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SetInput({
  value,
  onChange,
  placeholder,
  unit,
  inputMode,
  disabled,
  min,
  max,
  step,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  unit: string;
  inputMode: 'decimal' | 'numeric';
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="well flex flex-col items-center justify-center min-h-12 px-1 cursor-text focus-within:ring-[1.5px] focus-within:ring-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]">
      <input
        type="number"
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        className="w-full text-center t-data-lg bg-transparent outline-none text-[var(--color-text)] placeholder:text-[color-mix(in_srgb,var(--color-muted)_50%,transparent)] disabled:opacity-60"
      />
      <span className="t-label-sm text-[9px] leading-none mt-[1px]">{unit}</span>
    </label>
  );
}
