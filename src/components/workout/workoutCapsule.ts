import { isLoggableSetEntry } from '@/lib/workoutProgress';
import type { AutofillSetValues } from '@/lib/setAutofill';
import type { WorkoutSet } from '@/types';
import { nextWorkoutSet } from './workoutFocus';
import type { SetEntryState, SetEntryValues } from './setEntryRegistry';

type Pairings = ReadonlyMap<string, { role: 'A' | 'B'; partnerExerciseId: string }>;

/**
 * The set the capsule acts on: the open editor's set while it is unfinished,
 * otherwise the next set by the same round-aware rule as the resume cue.
 */
export function capsuleTargetSet(
  orderedSets: WorkoutSet[],
  focusOrder: string[],
  editorSet: WorkoutSet | undefined,
  pairings?: Pairings,
): WorkoutSet | undefined {
  if (editorSet && !editorSet.completed) return editorSet;
  return nextWorkoutSet(orderedSets, focusOrder, undefined, undefined, pairings);
}

export type WorkoutCapsuleModel =
  /** Values ready to log; `suggested` when they come from autofill, not the row. */
  | { kind: 'log'; setId: string; values: SetEntryValues; suggested: boolean }
  /** Nothing loggable yet: the ring opens the row to enter values. */
  | { kind: 'enter'; setId: string }
  | { kind: 'saving'; setId: string; values: SetEntryValues }
  /** The row's save failed; its draft is kept and the ring retries it. */
  | { kind: 'retry'; setId: string; values: SetEntryValues; error: string }
  /** No set left: main's finish action. */
  | { kind: 'finish'; busy: boolean };

/**
 * What the workout capsule shows for the target set. The row's own entry
 * state wins (draft, saving, error); autofill is only offered when the row
 * has nothing loggable, and is what gets logged if the ring is pressed.
 */
export function resolveWorkoutCapsule({ target, entry, autofill, totalSets, finishing }: {
  target: WorkoutSet | undefined;
  entry: SetEntryState | undefined;
  autofill: AutofillSetValues | null | undefined;
  totalSets: number;
  finishing: boolean;
}): WorkoutCapsuleModel | null {
  if (!target) return totalSets > 0 ? { kind: 'finish', busy: finishing } : null;

  const values: SetEntryValues = entry
    ? { weight: entry.weight, reps: entry.reps, rpe: entry.rpe }
    : { weight: target.weight?.toString() ?? '', reps: target.reps?.toString() ?? '', rpe: target.rpe?.toString() ?? '' };

  if (entry?.saving) return { kind: 'saving', setId: target.id, values };
  if (entry?.error) return { kind: 'retry', setId: target.id, values, error: entry.error };
  if (isLoggableSetEntry(values.weight, values.reps, values.rpe)) {
    return { kind: 'log', setId: target.id, values, suggested: false };
  }
  // A partial draft is the user's; never log over it with suggestions.
  if (!entry?.hasDraft && autofill && isLoggableSetEntry(autofill.weight, autofill.reps, autofill.rpe)) {
    return { kind: 'log', setId: target.id, values: { weight: autofill.weight, reps: autofill.reps, rpe: autofill.rpe }, suggested: true };
  }
  return { kind: 'enter', setId: target.id };
}
