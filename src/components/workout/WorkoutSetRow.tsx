import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronRight, Loader2, RotateCcw } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useAppStore } from '@/stores/appStore';
import { celebrationHaptic, tapHaptic } from '@/lib/haptics';
import { emitBurstFrom } from '@/lib/fx';
import { springs } from '@/lib/animations';
import { compareSetPerformance, describeSetGain, formatSetPerformanceTarget, isLoggableSetEntry } from '@/lib/workoutProgress';
import type { WorkoutSet } from '@/types';
import type { AutofillSetValues } from '@/lib/setAutofill';
import { useLitSurface } from '@/hooks/useLitSurface';
import { repeatOfferLabel } from './workoutFocus';

interface PreviousTarget { weight: number | null; reps: number | null; rpe: number | null }
/** Numbers offered for an unlogged set, shown dimmed until typed over or confirmed. */
interface SetSuggestion { weight: string; reps: string; rpe: string; source: 'planned' | 'last_workout' | 'last_set' }

/** The cue beside ghosted numbers: where they came from. */
const SUGGESTION_SOURCE: Record<SetSuggestion['source'], string> = {
  planned: 'Planned',
  last_workout: 'From last workout',
  last_set: 'From your last set',
};

const numberText = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? value.toString() : '');

/** The set's own stored numbers come first, then last workout's same set, then
 *  this session's previous set. Logged sets have no suggestion: they hold data. */
function suggestionFor(set: WorkoutSet, previousTarget: PreviousTarget | null | undefined, autofill: AutofillSetValues | null | undefined): SetSuggestion | null {
  if (set.completed) return null;
  if (set.weight != null || set.reps != null) {
    return { weight: numberText(set.weight), reps: numberText(set.reps), rpe: numberText(set.rpe), source: 'planned' };
  }
  if (previousTarget && (previousTarget.weight != null || previousTarget.reps != null)) {
    return { weight: numberText(previousTarget.weight), reps: numberText(previousTarget.reps), rpe: numberText(previousTarget.rpe), source: 'last_workout' };
  }
  if (autofill) {
    return { weight: autofill.weight, reps: autofill.reps, rpe: autofill.rpe, source: autofill.source === 'current_workout' ? 'last_set' : 'last_workout' };
  }
  return null;
}
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
  // Inputs hold only what the user typed (or a logged set's own numbers); an
  // unlogged set's suggestion stays a dimmed placeholder until confirmed.
  const [weight, setWeight] = useState(set.completed ? set.weight?.toString() ?? '' : '');
  const [reps, setReps] = useState(set.completed ? set.reps?.toString() ?? '' : '');
  const [rpe, setRpe] = useState(set.completed ? set.rpe?.toString() ?? '' : '');
  const [saving, setSaving] = useState(false);
  const saveInFlight = useRef(false);
  const hasDraft = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  // The metal key catches the motion light only while its entry is open.
  const litSaveRef = useLitSurface<HTMLButtonElement>();
  const rowRef = useRef<HTMLButtonElement>(null);
  const focusOnOpen = useRef(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The ink stamp after a confirmed save; `gain` when it beat last workout.
  const [stamp, setStamp] = useState<{ key: number; gain: string | null } | null>(null);
  const formattedTarget = previousTarget ? formatSetPerformanceTarget(previousTarget) : '';
  const performance = set.completed && previousTarget ? compareSetPerformance(set, previousTarget) : 'unknown';
  const suggestion = suggestionFor(set, previousTarget, autofillValues);
  // What the save key logs: typed numbers, else the suggestion shown in their place.
  const entered = (value: string, suggested: string | undefined) => (value.trim() !== '' ? value : suggestion ? suggested ?? '' : '');
  const entryWeight = entered(weight, suggestion?.weight);
  const entryReps = entered(reps, suggestion?.reps);
  const entryRpe = entered(rpe, suggestion?.rpe);
  const showingSuggestion = Boolean(suggestion) && [[weight, suggestion?.weight], [reps, suggestion?.reps], [rpe, suggestion?.rpe]]
    .some(([value, suggested]) => value === '' && suggested);
  const validNumbers = isLoggableSetEntry(entryWeight, entryReps, entryRpe);
  const suggestionCaptionId = useId();

  useEffect(() => {
    if (!stamp) return;
    const timer = window.setTimeout(() => setStamp(null), stamp.gain ? 2600 : 1200);
    return () => window.clearTimeout(timer);
  }, [stamp]);

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
    // Confirming a suggestion makes it the entry: the inputs keep exactly what
    // was sent, so Retry after a failure resends the same numbers.
    const savedWeight = entryWeight;
    const savedReps = entryReps;
    const savedRpe = entryRpe;
    if (savedWeight !== weight || savedReps !== reps || savedRpe !== rpe) {
      hasDraft.current = true;
      setWeight(savedWeight); setReps(savedReps); setRpe(savedRpe);
    }
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
      await logSet(originalSet.exercise_id, originalSet.set_number, Number(savedWeight), Number(savedReps), savedRpe ? Number(savedRpe) : undefined);
      hasDraft.current = false;
      releaseEditorFocus();
      const gain = !originalSet.completed && previousTarget
        ? describeSetGain({ weight: Number(savedWeight), reps: Number(savedReps) }, previousTarget)
        : null;
      setStamp({ key: Date.now(), gain });
      onComplete?.(originalSet);
      if (gain) {
        celebrationHaptic();
        // The editor has handed over to the ledger row; burst from its mark.
        requestAnimationFrame(() => emitBurstFrom(
          rowRef.current?.querySelector('.studio-set-state'),
          { palette: 'ink', count: 30, power: 0.75, spread: 70 },
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

  const setLabel = `set ${setNumber}${exerciseName ? ` of ${exerciseName}` : ''}`;
  // Only a saved set without a pending draft is logged data. Everything else is
  // a plan: a draft, or a suggestion as a ghosted guide.
  const logged = set.completed && !hasDraft.current;
  const displayWeight = logged ? numberText(set.weight) : hasDraft.current ? entryWeight : suggestion?.weight ?? '';
  const displayReps = logged ? numberText(set.reps) : hasDraft.current ? entryReps : suggestion?.reps ?? '';
  const displayRpe = logged ? numberText(set.rpe) : hasDraft.current ? entryRpe : suggestion?.rpe ?? '';
  const suggestedLabel = !logged && !hasDraft.current && suggestion ? ', suggested values' : '';
  const entryLabel = validNumbers ? `, ${entryWeight} pounds, ${entryReps} reps${entryRpe ? `, RPE ${entryRpe}` : ''}` : '';
  // Offer last workout/last set only when it differs from what is already shown.
  const autofillAction = autofillValues && (autofillValues.weight !== entryWeight || autofillValues.reps !== entryReps || autofillValues.rpe !== entryRpe)
    ? <button type="button" disabled={saving} onClick={() => {
      tapHaptic(); hasDraft.current = true; setWeight(autofillValues.weight); setReps(autofillValues.reps); setRpe(autofillValues.rpe);
    }}><RotateCcw size={13} aria-hidden /><span className="studio-set-offer">{repeatOfferLabel(autofillValues)}</span></button>
    : null;

  return <>
    <button ref={rowRef} type="button" className={`studio-set-ledger${stamp ? ' is-stamped' : ''}`} hidden={editing} onClick={chooseSet}
      aria-label={`${set.completed ? 'Edit' : 'Enter'} ${setLabel}${hasDraft.current ? ', draft' : ''}${suggestedLabel}${displayWeight ? `, ${displayWeight} pounds` : ''}${displayReps ? `, ${displayReps} reps` : ''}${displayRpe ? `, ${displayRpe} RPE` : ''}`}
      data-next={isNext && !set.completed ? true : undefined} data-logged={logged || undefined}>
      <span className="studio-set-index">{String(setNumber).padStart(2, '0')}</span>
      <span className="studio-set-value">{displayWeight || '—'}</span>
      <span className="studio-set-value">{displayReps || '—'}</span>
      <span className="studio-set-value">{displayRpe || '—'}</span>
      <span className="studio-set-state">{saveError ? 'Retry' : hasDraft.current ? 'Draft' : set.completed ? <>
        <InkCheck key={stamp?.key ?? 'settled'} />
        {performance === 'beat' && <ArrowUp size={12} strokeWidth={2.25} className="studio-set-beat" aria-hidden />}
      </> : <ChevronRight size={16} aria-hidden />}</span>
      <AnimatePresence>
        {stamp?.gain && (
          <motion.span
            key={stamp.key}
            className="studio-set-gain"
            aria-hidden
            initial={{ opacity: 0, y: 10, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.28 } }}
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
    <form ref={formRef} className="studio-set-editor" data-set-id={set.id} aria-label={`Set ${setNumber} entry${exerciseName ? ` for ${exerciseName}` : ''}`} hidden={!editing}
      onSubmit={(event) => { event.preventDefault(); void handleSave(); }}>
      <div className="studio-set-entry" data-workout-set-entry>
        <span className="studio-set-index">{String(setNumber).padStart(2, '0')}</span>
        <SetInput label="Weight" value={weight} onChange={(value) => { hasDraft.current = true; setWeight(value); }} placeholder={suggestion?.weight || '0'} suggested={Boolean(suggestion?.weight)} describedBy={showingSuggestion ? suggestionCaptionId : undefined} disabled={saving} inputMode="decimal" min={0} step="any" required={!suggestion?.weight} />
        <SetInput label="Reps" value={reps} onChange={(value) => { hasDraft.current = true; setReps(value); }} placeholder={suggestion?.reps || '0'} suggested={Boolean(suggestion?.reps)} describedBy={showingSuggestion ? suggestionCaptionId : undefined} disabled={saving} inputMode="numeric" min={0} step={1} required={!suggestion?.reps} />
        <SetInput label="Effort (RPE, optional)" value={rpe} onChange={(value) => { hasDraft.current = true; setRpe(value); }} placeholder={suggestion?.rpe || '—'} suggested={Boolean(suggestion?.rpe)} describedBy={showingSuggestion ? suggestionCaptionId : undefined} disabled={saving} inputMode="decimal" min={1} max={10} step={0.5} />
        <button ref={editing ? litSaveRef : undefined} type="submit" className="studio-save-set liquid-metal" disabled={!validNumbers || saving} aria-busy={saving}
          aria-label={saving ? `Saving ${setLabel}` : saveError ? `Retry saving ${setLabel}${entryLabel}` : set.completed ? `Save changes to ${setLabel}${entryLabel}` : `Save ${setLabel}${entryLabel}`}>
          {saving ? <Loader2 size={18} className="animate-spin" aria-hidden /> : saveError ? <span>Retry</span> : <Check size={22} strokeWidth={2.25} aria-hidden />}
        </button>
      </div>
      {saveError && <p role="alert" className="studio-save-error">{saveError}</p>}
      {/* One line under the fields: where the numbers came from, and the
          alternatives (repeat last, or cancel an edit). Entry closes with the
          movement's own disclosure. */}
      <div className="studio-set-editor-foot">
        {showingSuggestion && suggestion
          ? <span id={suggestionCaptionId} className="studio-set-suggestion">
            <strong>{SUGGESTION_SOURCE[suggestion.source]}</strong>
            <span aria-hidden> · tap <Check size={12} strokeWidth={2.25} className="studio-set-suggestion-check" /> to log</span>
            <span className="sr-only">, Save logs these numbers as shown</span>
          </span>
          : <span className="studio-set-foot-note">{!autofillAction && formattedTarget ? `Last ${formattedTarget}` : 'RPE is optional'}</span>}
        {(autofillAction || set.completed) && <div>
          {autofillAction}
          {set.completed && <button type="button" disabled={saving} onClick={() => {
            hasDraft.current = false;
            setWeight(set.weight?.toString() ?? ''); setReps(set.reps?.toString() ?? ''); setRpe(set.rpe?.toString() ?? '');
            setSaveError(null); releaseEditorFocus(); onHide?.();
          }}>Cancel</button>}
        </div>}
      </div>
      <span className="sr-only" role="status">{saving ? 'Saving…' : saveError ? 'Not saved' : set.completed ? 'Editing saved set' : 'Ready to log'}</span>
    </form>
  </>;
}

/** A check drawn in ink: its stroke plays in whenever it remounts after a save. */
function InkCheck() {
  return (
    <svg className="studio-ink-check" width={16} height={16} viewBox="0 0 24 24" aria-hidden>
      <path d="M5 12.5l4.6 4.6L19.2 7.4" pathLength={1} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SetInput({ label, value, onChange, placeholder, suggested, describedBy, disabled, inputMode, min, max, step, required }: {
  label: string; value: string; onChange: (value: string) => void; placeholder: string; suggested: boolean; describedBy?: string;
  disabled: boolean; inputMode: 'decimal' | 'numeric'; min: number; max?: number; step: string | number; required?: boolean;
}) {
  // A suggested number reads clearly (ghost ink, not a faint hint); a bare "0" or "—" stays a hint.
  return <input className="studio-set-input" type="number" aria-label={label} aria-describedby={describedBy} inputMode={inputMode}
    data-suggested={suggested || undefined}
    value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder}
    disabled={disabled} min={min} max={max} step={step} required={required} />;
}

export function WorkoutSetHeadings() {
  return <div className="studio-set-headings" aria-hidden="true"><span>Set</span><span>lb</span><span>Reps</span><span>RPE</span><span /></div>;
}
