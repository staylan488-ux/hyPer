import { useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronRight, ChevronUp, Loader2, RotateCcw } from 'lucide-react';
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
  editing?: boolean;
  exerciseName?: string;
  onSelect?: () => void;
  onHide?: () => void;
  onComplete?: (set: WorkoutSet) => void;
  onBeforeComplete?: (set: WorkoutSet) => Promise<true | string> | true | string;
}

/** One draft per real set, retained while its row or movement is collapsed. */
export function WorkoutSetRow({ set, setNumber, autofillValues, previousTarget, isNext = false,
  editing = false, exerciseName, onSelect, onHide, onComplete, onBeforeComplete }: WorkoutSetRowProps) {
  const logSet = useAppStore((state) => state.logSet);
  const [weight, setWeight] = useState(set.weight?.toString() ?? '');
  const [reps, setReps] = useState(set.reps?.toString() ?? '');
  const [rpe, setRpe] = useState(set.rpe?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const hasDraft = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const formattedTarget = previousTarget ? formatSetPerformanceTarget(previousTarget) : '';
  const performance = set.completed && previousTarget ? compareSetPerformance(set, previousTarget) : 'unknown';
  const validNumbers = weight.trim() !== '' && Number.isFinite(Number(weight)) && Number(weight) >= 0 &&
    reps.trim() !== '' && Number.isInteger(Number(reps)) && Number(reps) > 0 &&
    (rpe.trim() === '' || (Number.isFinite(Number(rpe)) && Number(rpe) >= 1 && Number(rpe) <= 10));

  useLayoutEffect(() => {
    if (!editing || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    const target = formRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')
      ?? formRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    target?.focus({ preventScroll: true });
  }, [editing]);

  const releaseEditorFocus = () => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !formRef.current?.contains(focused)) return;
    focused.blur();
    requestAnimationFrame(() => {
      // A save can finish after the user has opened another movement.
      if (rowRef.current?.getClientRects().length && document.activeElement === document.body) {
        rowRef.current.focus({ preventScroll: true });
      }
    });
  };

  const handleSave = async () => {
    if (!validNumbers || saveInFlight.current) return;
    saveInFlight.current = true;
    tapHaptic();
    // Pin an implicitly opened row until its save callback confirms completion.
    onSelect?.();
    setSaving(true);
    setSaveError(null);
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
      releaseEditorFocus();
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
    focusOnOpen.current = true;
    if (set.completed && !hasDraft.current) {
      setWeight(set.weight?.toString() ?? '');
      setReps(set.reps?.toString() ?? '');
      setRpe(set.rpe?.toString() ?? '');
    }
    onSelect?.();
  };

  const displayWeight = hasDraft.current ? weight : set.weight?.toString() ?? weight;
  const displayReps = hasDraft.current ? reps : set.reps?.toString() ?? reps;
  const displayRpe = hasDraft.current ? rpe : set.rpe?.toString() ?? rpe;
  const setLabel = `set ${setNumber}${exerciseName ? ` of ${exerciseName}` : ''}`;

  return <>
    <button ref={rowRef} type="button" className="studio-set-ledger" hidden={editing} onClick={chooseSet}
      aria-label={`${set.completed ? 'Edit' : 'Enter'} ${setLabel}${hasDraft.current ? ', draft' : ''}${displayWeight ? `, ${displayWeight} pounds` : ''}${displayReps ? `, ${displayReps} reps` : ''}${displayRpe ? `, ${displayRpe} RPE` : ''}`}
      data-next={isNext && !set.completed ? true : undefined}>
      <span className="studio-set-index">{String(setNumber).padStart(2, '0')}</span>
      <span>{displayWeight || '—'}</span><span>{displayReps || '—'}</span><span>{displayRpe || '—'}</span>
      <span className="studio-set-state">{saveError ? 'Retry' : hasDraft.current ? 'Draft' : set.completed ? <Check size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}</span>
      {isNext && <span className="sr-only">Next set</span>}
      {performance !== 'unknown' && <span className="sr-only">{performance} previous workout</span>}
    </button>
    <form ref={formRef} className="studio-set-editor" aria-label={`Set ${setNumber} entry${exerciseName ? ` for ${exerciseName}` : ''}`} hidden={!editing}
      onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
      <div className="studio-set-entry" data-workout-set-entry>
        <span className="studio-set-index">{String(setNumber).padStart(2, '0')}</span>
        <SetInput label="Weight" value={weight} onChange={(value) => { hasDraft.current = true; setWeight(value); }} placeholder={previousTarget?.weight?.toString() ?? '0'} disabled={saving} inputMode="decimal" min={0} step="any" required />
        <SetInput label="Reps" value={reps} onChange={(value) => { hasDraft.current = true; setReps(value); }} placeholder={previousTarget?.reps?.toString() ?? '0'} disabled={saving} inputMode="numeric" min={1} step={1} required />
        <SetInput label="Effort (RPE, optional)" value={rpe} onChange={(value) => { hasDraft.current = true; setRpe(value); }} placeholder={previousTarget?.rpe?.toString() ?? '—'} disabled={saving} inputMode="decimal" min={1} max={10} step={0.5} />
        <button type="submit" className="studio-save-set material-button-primary" disabled={!validNumbers || saving} aria-busy={saving}
          aria-label={saving ? `Saving ${setLabel}` : saveError ? `Retry saving ${setLabel}` : set.completed ? `Save changes to ${setLabel}` : `Save ${setLabel}`}>
          {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : saveError ? <span>Retry</span> : <Check size={20} aria-hidden />}
        </button>
      </div>
      {saveError && <p role="alert" className="studio-save-error">{saveError}</p>}
      <div className="studio-set-editor-foot">
        {autofillValues ? <button type="button" disabled={saving} onClick={() => {
          tapHaptic(); hasDraft.current = true; setWeight(autofillValues.weight); setReps(autofillValues.reps); setRpe(autofillValues.rpe);
        }}><RotateCcw size={13} />{autofillValues.source === 'current_workout' ? 'Use last set' : 'Use last workout'}</button> :
          <span>{formattedTarget ? `Last ${formattedTarget}` : 'RPE is optional'}</span>}
        <div>
          {set.completed && <button type="button" disabled={saving} onClick={() => {
            hasDraft.current = false;
            setWeight(set.weight?.toString() ?? ''); setReps(set.reps?.toString() ?? ''); setRpe(set.rpe?.toString() ?? '');
            setSaveError(null); releaseEditorFocus(); onHide?.();
          }}>Cancel</button>}
          <button type="button" onClick={() => { tapHaptic(); releaseEditorFocus(); onHide?.(); }}>Hide <ChevronUp size={13} /></button>
        </div>
      </div>
      <span className="sr-only" role="status">{saving ? 'Saving…' : saveError ? 'Not saved' : set.completed ? 'Editing saved set' : 'Ready to log'}</span>
    </form>
  </>;
}

function SetInput({ label, value, onChange, placeholder, disabled, inputMode, min, max, step, required }: {
  label: string; value: string; onChange: (value: string) => void; placeholder: string;
  disabled: boolean; inputMode: 'decimal' | 'numeric'; min: number; max?: number; step: string | number; required?: boolean;
}) {
  return <input className="studio-set-input material-control" type="number" aria-label={label} inputMode={inputMode}
    value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
    disabled={disabled} min={min} max={max} step={step} required={required} />;
}

export function WorkoutSetHeadings() {
  return <div className="studio-set-headings" aria-hidden="true"><span>Set</span><span>lb</span><span>Reps</span><span>RPE</span><span /></div>;
}
