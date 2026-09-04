import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronRight, RotateCcw, Timer, X } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { tapHaptic } from '@/lib/haptics';
import { compareSetPerformance, formatSetPerformanceTarget } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';
import type { AutofillSetValues } from '@/lib/setAutofill';

interface PreviousTarget { weight: number | null; reps: number | null; rpe: number | null }
interface WorkoutSetRowProps {
  set: WorkoutSet;
  setNumber: number;
  autofillValues?: AutofillSetValues | null;
  previousTarget?: PreviousTarget | null;
  isNext?: boolean;
  composer?: boolean;
  composerHidden?: boolean;
  exerciseName?: string;
  onSelect?: () => void;
  onCancel?: () => void;
  onStartRest?: () => void;
  onComplete?: (set: WorkoutSet) => void;
  onBeforeComplete?: (set: WorkoutSet) => Promise<true | string> | true | string;
}

/** One persistent draft per real set. The selected row supplies the anchored editor. */
export function WorkoutSetRow({ set, setNumber, autofillValues, previousTarget, isNext = false,
  composer = false, composerHidden = false, exerciseName, onSelect, onCancel, onStartRest,
  onComplete, onBeforeComplete }: WorkoutSetRowProps) {
  const logSet = useAppStore((state) => state.logSet);
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const hasDraft = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formattedTarget = previousTarget ? formatSetPerformanceTarget(previousTarget) : '';
  const performance = set.completed && previousTarget ? compareSetPerformance(set, previousTarget) : 'unknown';
  const validNumbers = weight.trim() !== '' && Number.isFinite(Number(weight)) && Number(weight) >= 0 &&
    reps.trim() !== '' && Number.isInteger(Number(reps)) && Number(reps) > 0 &&
    (rpe.trim() === '' || (Number.isFinite(Number(rpe)) && Number(rpe) >= 1 && Number(rpe) <= 10));

  const handleSave = async () => {
    if (!validNumbers || saveInFlight.current) return;
    saveInFlight.current = true;
    tapHaptic();
    setSaving(true);
    setSaveError(null);
    // Capture this exact row before awaiting. The store owns deadline/retry and ID isolation.
    const originalSet = set;
    try {
      if (onBeforeComplete) {
        const verdict = await onBeforeComplete(originalSet);
        if (verdict !== true) {
          setSaveError(verdict || 'Complete the previous superset round first.');
          return;
        }
      }
      const liveWorkout = useAppStore.getState().currentWorkout;
      const liveSet = liveWorkout?.sets.find((candidate) => candidate.exercise_id === originalSet.exercise_id && candidate.set_number === originalSet.set_number);
      if (liveWorkout?.id !== originalSet.workout_id || liveSet?.id !== originalSet.id) {
        throw new Error('This workout set is no longer active.');
      }
      await logSet(originalSet.exercise_id, originalSet.set_number, Number(weight), Number(reps), rpe ? Number(rpe) : undefined);
      hasDraft.current = false;
      onComplete?.(originalSet);
    } catch (error) {
      console.error('Failed to log set:', error);
      setSaveError('Couldn’t confirm this set was saved. Your numbers are still here. Check your connection and tap Retry.');
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  };

  const chooseSet = () => {
    tapHaptic();
    if (set.completed && !hasDraft.current) {
      setWeight(set.weight?.toString() ?? '');
      setReps(set.reps?.toString() ?? '');
      setRpe(set.rpe?.toString() ?? '');
    }
    onSelect?.();
  };

  return <>
    <button type="button" className="studio-set-ledger" onClick={chooseSet}
      aria-label={`${set.completed ? 'Edit' : 'Enter'} set ${setNumber}${exerciseName ? ` of ${exerciseName}` : ''}`}
      aria-current={composer && !composerHidden ? 'step' : undefined}>
      <span className="studio-set-index">{set.completed ? <Check size={13} /> : String(setNumber).padStart(2, '0')}</span>
      <span>{set.weight != null ? `${set.weight} lb` : weight ? `${weight} lb` : '— lb'}</span>
      <span>{set.reps != null ? `${set.reps} reps` : reps ? `${reps} reps` : '— reps'}</span>
      <span>{set.rpe != null ? `${set.rpe} RPE` : isNext ? 'Next set' : 'Planned'}</span>
      <ChevronRight size={13} aria-hidden />
      {performance !== 'unknown' && <span className="sr-only">{performance} previous workout</span>}
    </button>
    {composer && createPortal(
      <section className="studio-workout-dock" aria-label={`Set ${setNumber} entry`} hidden={composerHidden}>
        <div className="studio-composer-label">
          <span className="t-label">{set.completed ? 'Edit' : 'Set'} {String(setNumber).padStart(2, '0')}</span>
          <span className="t-caption" role="status">{saving ? 'Saving…' : saveError ? 'Not saved' : set.completed ? 'Previously saved' : 'Ready to log'}</span>
          {set.completed && <button type="button" aria-label="Cancel set edit" disabled={saving} onClick={() => {
            hasDraft.current = false;
            setWeight(set.weight?.toString() ?? ''); setReps(set.reps?.toString() ?? ''); setRpe(set.rpe?.toString() ?? '');
            setSaveError(null); onCancel?.();
          }}><X size={17} /></button>}
        </div>
        <p className="studio-composer-movement">{exerciseName}</p>
        <form onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
          <div className="studio-set-entry">
            <SetInput label="Weight" unit="lb" value={weight} onChange={(value) => { hasDraft.current = true; setWeight(value); }} placeholder={previousTarget?.weight?.toString() ?? '0'} disabled={saving} inputMode="decimal" min={0} step="any" />
            <SetInput label="Reps" value={reps} onChange={(value) => { hasDraft.current = true; setReps(value); }} placeholder={previousTarget?.reps?.toString() ?? '0'} disabled={saving} inputMode="numeric" min={1} step={1} />
            <SetInput label="Effort" unit="RPE" value={rpe} onChange={(value) => { hasDraft.current = true; setRpe(value); }} placeholder={previousTarget?.rpe?.toString() ?? '—'} disabled={saving} inputMode="decimal" min={1} max={10} step={0.5} />
          </div>
          {saveError && <p role="alert" className="studio-save-error">{saveError}</p>}
          <button type="submit" className="studio-save-set" disabled={!validNumbers || saving} aria-busy={saving}>
            <span>{saving ? 'Saving…' : saveError ? 'Retry' : set.completed ? 'Save changes' : 'Save set'}</span><Check size={16} />
          </button>
        </form>
        <div className="studio-composer-foot">
          {autofillValues ? <button type="button" disabled={saving} onClick={() => {
            tapHaptic(); hasDraft.current = true; setWeight(autofillValues.weight); setReps(autofillValues.reps); setRpe(autofillValues.rpe);
          }}><RotateCcw size={13} />{autofillValues.source === 'current_workout' ? 'Repeat last set' : 'Use last workout'}</button> :
            <span>{formattedTarget ? `Last ${formattedTarget}` : 'Effort is optional'}</span>}
          {onStartRest && <button type="button" disabled={saving} onClick={onStartRest}><Timer size={13} /> Rest</button>}
        </div>
      </section>, document.body
    )}
  </>;
}

function SetInput({ label, unit, value, onChange, placeholder, disabled, inputMode, min, max, step }: {
  label: string; unit?: string; value: string; onChange: (value: string) => void; placeholder: string;
  disabled: boolean; inputMode: 'decimal' | 'numeric'; min: number; max?: number; step: string | number;
}) {
  return <label className="studio-set-field"><span className="t-label">{label}</span><span className="studio-set-value">
    <input type="number" aria-label={label} inputMode={inputMode} value={value} onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder} disabled={disabled} min={min} max={max} step={step} />
    {unit && <small>{unit}</small>}
  </span></label>;
}
