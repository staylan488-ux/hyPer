import { useSyncExternalStore } from 'react';
import { useCommandCapsule } from '@/hooks/useCommandCapsule';
import type { CapsuleValue, CommandCapsuleSpec } from '@/lib/commandCapsule';
import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import type { WorkoutSet } from '@/types';
import { getSetEntry, readSetEntriesVersion, subscribeSetEntries, type SetEntryField, type SetEntryValues } from './setEntryRegistry';
import { capsuleTargetSet, resolveWorkoutCapsule } from './workoutCapsule';

interface WorkoutCapsuleInput {
  active: boolean;
  orderedSets: WorkoutSet[];
  focusOrder: string[];
  editorSet: WorkoutSet | undefined;
  pairings?: ReadonlyMap<string, { role: 'A' | 'B'; partnerExerciseId: string }>;
  previousWorkoutSetsByExercise: PreviousWorkoutSetMap;
  exerciseName: (exerciseId: string) => string;
  completedSets: number;
  totalSets: number;
  finishing: boolean;
  /** Main's Finish action (handleCompleteWorkout). */
  onFinish: () => void;
}

/**
 * The workout's command capsule: the next set's values with a check ring.
 * The ring calls the set row's own save (setEntryRegistry → WorkoutSetRow
 * handleSave), the same handler as the inline check; a value tap opens and
 * focuses that row. With no set left it offers main's Finish.
 */
export function useWorkoutCommandCapsule(input: WorkoutCapsuleInput): void {
  // Re-render when any row's draft, saving or error state changes.
  useSyncExternalStore(subscribeSetEntries, readSetEntriesVersion, readSetEntriesVersion);
  useCommandCapsule(input.active ? buildSpec(input) : null);
}

/** Renders nothing; mounted by the in-session Train view. */
export function WorkoutCommandCapsule(props: WorkoutCapsuleInput): null {
  useWorkoutCommandCapsule(props);
  return null;
}

function buildSpec({
  orderedSets, focusOrder, editorSet, pairings, previousWorkoutSetsByExercise,
  exerciseName, completedSets, totalSets, finishing, onFinish,
}: WorkoutCapsuleInput): CommandCapsuleSpec | null {
  const target = capsuleTargetSet(orderedSets, focusOrder, editorSet, pairings);
  const handle = getSetEntry(target?.id);
  const exerciseSets = target ? orderedSets.filter((set) => set.exercise_id === target.exercise_id) : [];
  const autofill = target ? getSetAutofillValues({
    exerciseId: target.exercise_id,
    setNumber: target.set_number,
    currentExerciseSets: exerciseSets,
    previousWorkoutSetsByExercise,
  }) : null;
  const model = resolveWorkoutCapsule({ target, entry: handle?.read(), autofill, totalSets, finishing });
  if (!model) return null;

  if (model.kind === 'finish') {
    return {
      key: 'finish',
      label: model.busy ? 'Finishing…' : 'Finish workout',
      sublabel: `${completedSets} of ${totalSets} sets logged`,
      glyph: 'check',
      busy: model.busy,
      dock: 'bottom',
      onPress: onFinish,
    };
  }

  const name = exerciseName(target!.exercise_id);
  const index = Math.max(1, exerciseSets.findIndex((set) => set.id === target!.id) + 1);
  const where = `${name} · Set ${index}`;

  if (model.kind === 'enter') {
    return {
      key: `enter:${model.setId}`,
      label: `Enter set ${index}`,
      sublabel: name,
      glyph: 'arrow',
      dock: 'bottom',
      ariaLabel: `Enter ${name} set ${index}`,
      onPress: () => getSetEntry(model.setId)?.focus(),
    };
  }

  const values = valueButtons(model.values, model.setId, model.kind === 'log' && model.suggested);
  const spoken = `${model.values.weight} pounds, ${model.values.reps} reps${model.values.rpe ? `, RPE ${model.values.rpe}` : ''}`;

  if (model.kind === 'retry') {
    return {
      key: `set:${model.setId}`,
      label: 'Retry',
      caption: `Not saved · ${where}`,
      alert: true,
      values,
      glyph: 'check',
      dock: 'bottom',
      ariaLabel: `Retry saving ${name} set ${index}: ${spoken}`,
      onPress: () => { void getSetEntry(model.setId)?.save(); },
    };
  }

  const suggested = model.kind === 'log' && model.suggested ? model.values : undefined;
  return {
    key: `set:${model.setId}`,
    label: 'Log set',
    caption: model.kind === 'saving' ? `Saving · ${where}` : where,
    values,
    glyph: 'check',
    busy: model.kind === 'saving',
    dock: 'bottom',
    ariaLabel: `Log ${name} set ${index}: ${spoken}`,
    // Suggested values are passed so the row saves (and keeps) exactly those.
    onPress: () => { void getSetEntry(model.setId)?.save(suggested); },
  };
}

function valueButtons(values: SetEntryValues, setId: string, suggested: boolean): CapsuleValue[] {
  const open = (field: SetEntryField) => () => getSetEntry(setId)?.focus(field);
  const buttons: CapsuleValue[] = [
    { id: 'weight', value: values.weight, unit: 'lb', suggested, ariaLabel: `Weight ${values.weight} pounds. Edit`, onPress: open('weight') },
    { id: 'reps', value: values.reps, unit: values.reps === '1' ? 'rep' : 'reps', suggested, ariaLabel: `${values.reps} reps. Edit`, onPress: open('reps') },
  ];
  if (values.rpe) {
    buttons.push({ id: 'rpe', value: values.rpe, unit: 'RPE', unitFirst: true, suggested, ariaLabel: `RPE ${values.rpe}. Edit`, onPress: open('rpe') });
  }
  return buttons;
}
