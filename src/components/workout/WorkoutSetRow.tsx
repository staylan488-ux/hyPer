import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronUp, Loader2, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAppStore } from '@/stores/appStore';
import { celebrationHaptic, tapHaptic } from '@/lib/haptics';
import { emitBurstFrom } from '@/lib/fx';
import { springs } from '@/lib/animations';
import { compareSetPerformance, describeSetGain, formatSetPerformanceTarget, isLoggableSetEntry } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';
import type { AutofillSetValues } from '@/lib/setAutofill';
import { notifySetEntries, registerSetEntry, type SetEntryField, type SetEntryState, type SetEntryValues } from './setEntryRegistry';

const FIELD_LABELS: Record<SetEntryField, string> = { weight: 'Weight', reps: 'Reps', rpe: 'Effort (RPE, optional)' };

interface PreviousTarget { weight: number | null; reps: number | null; rpe: number | null }
interface WorkoutSetRowProps {
  set: WorkoutSet;
  setNumber: number;
  autofillValues?: AutofillSetValues | null;
  previousTarget?: PreviousTarget | null;
  /** The movement's rep target ("8–10 reps"), shown on planned rows with no numbers yet. */
  repTarget?: string | null;
  isNext?: boolean;
  editing?: boolean;
  exerciseName?: string;
  onSelect?: () => void;
  onHide?: () => void;
  onComplete?: (set: WorkoutSet) => void;
  onBeforeComplete?: (set: WorkoutSet) => Promise<true | string> | true | string;
}

/** One draft per real set, retained while its row or movement is collapsed. */
export function WorkoutSetRow({ set, setNumber, autofillValues, previousTarget, repTarget, isNext = false,
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
  // true focuses the first field; a field name focuses that field (capsule).
  const focusOnOpen = useRef<boolean | SetEntryField>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The ink stamp after a confirmed save; `gain` when it beat last workout.
  const [stamp, setStamp] = useState<{ key: number; gain: string | null } | null>(null);
  const formattedTarget = previousTarget ? formatSetPerformanceTarget(previousTarget) : '';
  const performance = set.completed && previousTarget ? compareSetPerformance(set, previousTarget) : 'unknown';
  const validNumbers = isLoggableSetEntry(weight, reps, rpe);

  useEffect(() => {
    if (!stamp) return;
    const timer = window.setTimeout(() => setStamp(null), stamp.gain ? 2600 : 1200);
    return () => window.clearTimeout(timer);
  }, [stamp]);

  useLayoutEffect(() => {
    if (!editing || !focusOnOpen.current) return;
    const field = focusOnOpen.current;
    focusOnOpen.current = false;
    const target = (typeof field === 'string' ? formRef.current?.querySelector<HTMLInputElement>(`input[aria-label="${FIELD_LABELS[field]}"]:not(:disabled)`) : null)
      ?? formRef.current?.querySelector<HTMLInputElement>('input:not(:disabled)')
      ?? formRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    target?.focus({ preventScroll: true });
    if (typeof field === 'string') revealEditor(target);
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

  // The inline check and the command capsule both save here. The capsule may
  // pass the values it showed; they become this row's draft first, so a
  // failed save keeps them for Retry. It logs without opening a closed row.
  const handleSave = async ({ values, fromCapsule = false }: { values?: SetEntryValues; fromCapsule?: boolean } = {}) => {
    const entry = values ?? { weight, reps, rpe };
    if (!isLoggableSetEntry(entry.weight, entry.reps, entry.rpe) || saveInFlight.current) return;
    saveInFlight.current = true;
    if (values) {
      hasDraft.current = true;
      setWeight(values.weight); setReps(values.reps); setRpe(values.rpe);
    }
    if (!fromCapsule) tapHaptic(); // The capsule's ring already ticked.
    // Pin an implicitly opened row until its save callback confirms completion.
    if (!fromCapsule || editing) onSelect?.();
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
      await logSet(originalSet.exercise_id, originalSet.set_number, Number(entry.weight), Number(entry.reps), entry.rpe ? Number(entry.rpe) : undefined);
      hasDraft.current = false;
      releaseEditorFocus();
      const gain = !originalSet.completed && previousTarget
        ? describeSetGain({ weight: Number(entry.weight), reps: Number(entry.reps) }, previousTarget)
        : null;
      setStamp({ key: Date.now(), gain });
      onComplete?.(originalSet);
      if (gain) {
        celebrationHaptic();
        // The editor has handed over to the ledger row; burst from its mark.
        requestAnimationFrame(() => emitBurstFrom(
          rowRef.current?.querySelector('.studio-set-state'),
          { palette: 'lacquer', count: 30, power: 0.75, spread: 70 },
        ));
      }
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

  // The capsule's value tap: open this row's editor on one field.
  const focusFromCapsule = (field: SetEntryField = 'weight') => {
    focusOnOpen.current = field;
    if (set.completed && !hasDraft.current) {
      setWeight(set.weight?.toString() ?? '');
      setReps(set.reps?.toString() ?? '');
      setRpe(set.rpe?.toString() ?? '');
    }
    onSelect?.();
    if (!editing) return; // The editing layout effect focuses once it opens.
    focusOnOpen.current = false;
    const target = formRef.current?.querySelector<HTMLInputElement>(`input[aria-label="${FIELD_LABELS[field]}"]:not(:disabled)`);
    target?.focus({ preventScroll: true });
    revealEditor(target);
  };

  // Publish this row to the set-entry registry (see setEntryRegistry.ts).
  const entryState: SetEntryState = { weight, reps, rpe, hasDraft: hasDraft.current, saving, error: saveError, completed: set.completed };
  const entryRef = useRef({ state: entryState, save: handleSave, focus: focusFromCapsule });
  useLayoutEffect(() => {
    entryRef.current = { state: entryState, save: handleSave, focus: focusFromCapsule };
  });
  useEffect(() => registerSetEntry(set.id, {
    read: () => entryRef.current.state,
    save: (values) => entryRef.current.save({ values, fromCapsule: true }),
    focus: (field) => entryRef.current.focus(field),
  }), [set.id]);
  useEffect(() => { notifySetEntries(); }, [weight, reps, rpe, saving, saveError, set.completed]);

  const displayWeight = hasDraft.current ? weight : set.weight?.toString() ?? weight;
  const displayReps = hasDraft.current ? reps : set.reps?.toString() ?? reps;
  const displayRpe = hasDraft.current ? rpe : set.rpe?.toString() ?? rpe;
  const setLabel = `set ${setNumber}${exerciseName ? ` of ${exerciseName}` : ''}`;
  const view = ledgerView({
    completed: set.completed,
    draft: hasDraft.current,
    current: isNext && !set.completed,
    weight: displayWeight,
    reps: displayReps,
    rpe: displayRpe,
    autofill: autofillValues,
    previousTarget,
    formattedTarget,
    repTarget,
  });

  return <>
    <button ref={rowRef} type="button" className={`studio-set-ledger is-${view.tone}${saveError ? ' is-failed' : ''}${stamp ? ' is-stamped' : ''}`} hidden={editing} onClick={chooseSet}
      aria-label={`${set.completed ? 'Edit' : 'Enter'} ${setLabel}${hasDraft.current ? ', draft' : ''}${displayWeight ? `, ${displayWeight} pounds` : ''}${displayReps ? `, ${displayReps} reps` : ''}${displayRpe ? `, ${displayRpe} RPE` : ''}`}
      data-next={isNext && !set.completed ? true : undefined}>
      <span className="studio-set-index">{setNumber}</span>
      <span className="studio-set-main">
        {view.prefix && <span className="studio-set-prefix">{view.prefix}</span>}
        <span className="studio-set-figures">{view.figures}</span>
        <span className="studio-set-state">
          {set.completed && !hasDraft.current && <InkCheck key={stamp?.key ?? 'settled'} />}
          {set.completed && !hasDraft.current && performance === 'beat' && <ArrowUp size={12} strokeWidth={2.25} className="studio-set-beat" aria-hidden />}
        </span>
      </span>
      <span className="studio-set-side">
        {saveError ? 'Not saved · Retry' : view.draft ? `${view.rpe ? `RPE ${view.rpe} · ` : ''}Draft` : view.rpe ? `RPE ${view.rpe}` : ''}
      </span>
      <AnimatePresence>
        {stamp?.gain && (
          <motion.span
            key={stamp.key}
            className="studio-set-gain"
            aria-hidden
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: 0.28 } }}
            transition={springs.lift}
          >
            {stamp.gain}
          </motion.span>
        )}
      </AnimatePresence>
      {stamp?.gain && <span className="sr-only" role="status">Beat last workout, {stamp.gain}</span>}
      {isNext && <span className="sr-only">Next set</span>}
      {performance !== 'unknown' && <span className="sr-only">{performance} previous workout</span>}
    </button>
    <form ref={formRef} className="studio-set-editor" aria-label={`Set ${setNumber} entry${exerciseName ? ` for ${exerciseName}` : ''}`} hidden={!editing}
      data-next={isNext && !set.completed ? true : undefined}
      onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
      <div className="studio-set-entry" data-workout-set-entry>
        <span className="studio-set-index">{setNumber}</span>
        <span className="studio-set-fields">
          <SetInput label="Weight" unit="lb" value={weight} onChange={(value) => { hasDraft.current = true; setWeight(value); }} placeholder={previousTarget?.weight?.toString() ?? '0'} disabled={saving} inputMode="decimal" min={0} step="any" required />
          <span className="studio-set-times" aria-hidden>×</span>
          <SetInput label="Reps" unit="reps" value={reps} onChange={(value) => { hasDraft.current = true; setReps(value); }} placeholder={previousTarget?.reps?.toString() ?? '0'} disabled={saving} inputMode="numeric" min={0} step={1} required />
        </span>
        <SetInput label="Effort (RPE, optional)" unit="RPE" unitFirst value={rpe} onChange={(value) => { hasDraft.current = true; setRpe(value); }} placeholder={previousTarget?.rpe?.toString() ?? '—'} disabled={saving} inputMode="decimal" min={1} max={10} step={0.5} />
        <button type="submit" className="studio-save-set material-button-primary" disabled={!validNumbers || saving} aria-busy={saving}
          aria-label={saving ? `Saving ${setLabel}` : saveError ? `Retry saving ${setLabel}` : set.completed ? `Save changes to ${setLabel}` : `Save ${setLabel}`}>
          {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : saveError ? <span>Retry</span> : <SaveCheck />}
        </button>
      </div>
      {saveError && <p role="alert" className="studio-save-error">{saveError}</p>}
      <div className="studio-set-editor-foot">
        {autofillValues ? <button type="button" disabled={saving} onClick={() => {
          tapHaptic(); hasDraft.current = true; setWeight(autofillValues.weight); setReps(autofillValues.reps); setRpe(autofillValues.rpe);
        }}><RotateCcw size={13} aria-hidden />{autofillValues.source === 'current_workout' ? 'Use last set' : 'Use last workout'}
          {formatEntry(autofillValues) && <span className="studio-set-foot-figures">· {formatEntry(autofillValues)}</span>}</button> :
          <span>{formattedTarget ? `Last ${formattedTarget}` : 'RPE is optional'}</span>}
        <div>
          {set.completed && <button type="button" disabled={saving} onClick={() => {
            hasDraft.current = false;
            setWeight(set.weight?.toString() ?? ''); setReps(set.reps?.toString() ?? ''); setRpe(set.rpe?.toString() ?? '');
            setSaveError(null); releaseEditorFocus(); onHide?.();
          }}>Cancel</button>}
          <button type="button" onClick={() => { tapHaptic(); releaseEditorFocus(); onHide?.(); }}>Hide <ChevronUp size={13} aria-hidden /></button>
        </div>
      </div>
      <span className="sr-only" role="status">{saving ? 'Saving…' : saveError ? 'Not saved' : set.completed ? 'Editing saved set' : 'Ready to log'}</span>
    </form>
  </>;
}

type LedgerTone = 'done' | 'now' | 'suggested' | 'planned' | 'draft';

/**
 * What a closed row reads: logged sets in ink with a check, the current set
 * in ink (its suggestion in ink-2, exactly what the capsule would log), and
 * later sets as tertiary targets.
 */
function ledgerView({ completed, draft, current, weight, reps, rpe, autofill, previousTarget, formattedTarget, repTarget }: {
  completed: boolean;
  draft: boolean;
  current: boolean;
  weight: string;
  reps: string;
  rpe: string;
  autofill?: AutofillSetValues | null;
  previousTarget?: PreviousTarget | null;
  formattedTarget: string;
  repTarget?: string | null;
}): { tone: LedgerTone; prefix: string; figures: string; rpe: string; draft: boolean } {
  const pair = (w: string, r: string) => `${w || '—'} × ${r || '—'}`;
  if (draft) return { tone: 'draft', prefix: '', figures: pair(weight, reps), rpe, draft: true };
  if (completed) return { tone: 'done', prefix: '', figures: pair(weight, reps), rpe, draft: false };
  if (weight && reps) return current
    ? { tone: 'now', prefix: '', figures: pair(weight, reps), rpe, draft: false }
    : { tone: 'planned', prefix: 'target', figures: pair(weight, reps), rpe, draft: false };
  if (current && autofill && isLoggableSetEntry(autofill.weight, autofill.reps, autofill.rpe)) {
    return { tone: 'suggested', prefix: '', figures: pair(autofill.weight, autofill.reps), rpe: autofill.rpe, draft: false };
  }
  const tone = current ? 'suggested' : 'planned';
  if (formattedTarget) return { tone, prefix: 'target', figures: formattedTarget, rpe: previousTarget?.rpe?.toString() ?? '', draft: false };
  if (repTarget) return { tone, prefix: 'target', figures: repTarget, rpe: '', draft: false };
  return { tone, prefix: '', figures: '—', rpe: '', draft: false };
}

function formatEntry(values: AutofillSetValues): string {
  return values.weight && values.reps ? `${values.weight} × ${values.reps}` : '';
}

/** Bring a capsule-opened editor into view once its movement has expanded. */
function revealEditor(target: HTMLElement | null | undefined) {
  if (!target?.scrollIntoView) return;
  requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }));
  window.setTimeout(() => { if (target.isConnected) target.scrollIntoView({ block: 'center' }); }, 360);
}

/** A check drawn in ink: its stroke plays in whenever it remounts after a save. */
function InkCheck() {
  return (
    <svg className="studio-ink-check" width={12} height={12} viewBox="0 0 24 24" aria-hidden>
      <path d="M4.5 12.5l4.8 4.8L19.5 7" pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SaveCheck() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12.5l4.6 4.6L19.2 7.4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A number that reads as type and becomes a field when tapped: no box, a
 * hairline underline, and an ink line while focused. The sizer keeps the
 * field as wide as its value so the unit sits right after the figure.
 */
function SetInput({ label, unit, unitFirst = false, value, onChange, placeholder, disabled, inputMode, min, max, step, required }: {
  label: string; unit: string; unitFirst?: boolean; value: string; onChange: (value: string) => void; placeholder: string;
  disabled: boolean; inputMode: 'decimal' | 'numeric'; min: number; max?: number; step: string | number; required?: boolean;
}) {
  return (
    <label className={`studio-set-field${unitFirst ? ' is-unit-first' : ''}`}>
      {unitFirst && <span className="studio-set-unit" aria-hidden>{unit}</span>}
      <span className="studio-set-sizer" data-value={value || placeholder}>
        <input className="studio-set-input" type="number" aria-label={label} inputMode={inputMode}
          value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
          disabled={disabled} min={min} max={max} step={step} required={required} />
      </span>
      {!unitFirst && <span className="studio-set-unit" aria-hidden>{unit}</span>}
    </label>
  );
}
