// Changes to the live workout's movements: set counts, a swap for this workout
// only and switching it back, the order, and in a flexible session adding,
// removing and pairing movements and naming the session. Writes go through the
// shared store actions, the same ones the web Train page uses, after any notes
// typed before them have saved.
import { useAppStore } from '@/stores/appStore';
import type { Exercise } from '@/types';

import { afterNotes } from './notes';
import { useFocusStore } from './session';

const setCount = (exerciseId: string) =>
  useAppStore.getState().currentWorkout?.sets.filter((set) => set.exercise_id === exerciseId).length ?? 0;

/**
 * Adds a set, or removes the last unfinished one. The store gives up quietly
 * on a failed write, so this reports whether the count actually changed.
 */
export async function changeSetCount(exerciseId: string, change: 'add' | 'remove'): Promise<boolean> {
  const before = setCount(exerciseId);
  const store = useAppStore.getState();
  const flexibleItem = store.currentWorkout?.split_day_id === null
    ? store.currentWorkoutDayPlan?.items.find((item) => item.exercise_id === exerciseId)
    : undefined;
  if (flexibleItem) {
    // A flexible session keeps the count in its plan, as the web's Adjust sets
    // does, so "save as quick start" keeps it; a superset pair changes together.
    const target = change === 'add' ? before + 1 : before - 1;
    if (target < 1 || target > 12) return false;
    await store.updateFlexibleExerciseMeta(exerciseId, { target_sets: target });
  } else {
    await (change === 'add' ? store.addWorkoutSet(exerciseId) : store.removeLastUncompletedSet(exerciseId));
  }
  const after = setCount(exerciseId);
  return change === 'add' ? after > before : after < before;
}

/** Runs a change to this workout once earlier notes have saved; refuses once the workout has closed. */
function changeWorkout(workoutId: string, write: () => Promise<unknown>): Promise<void> {
  return afterNotes(workoutId, async () => {
    if (useAppStore.getState().currentWorkout?.id !== workoutId) throw new Error('This workout is no longer open.');
    await write();
  });
}

/** The replacement keeps the movement's turn when the movement was the one being worked on. */
function handOverFocus(fromId: string, toId: string, wasCurrent: boolean) {
  const focus = useFocusStore.getState();
  if (wasCurrent || focus.exerciseId === fromId) focus.focus(toId);
}

/**
 * Swaps a movement for another exercise for this workout only; the program is
 * untouched. Notes typed before the swap are saved first, as on the web.
 */
export async function swapMovement(workoutId: string, exerciseId: string, replacement: Exercise, wasCurrent: boolean) {
  await changeWorkout(workoutId, () => useAppStore.getState().substituteWorkoutExercise(exerciseId, replacement));
  handOverFocus(exerciseId, replacement.id, wasCurrent);
}

/** Returns a swapped movement to the one it replaced. */
export async function switchBack(workoutId: string, exerciseId: string, plannedId: string, wasCurrent: boolean) {
  await changeWorkout(workoutId, () => useAppStore.getState().switchBackWorkoutExercise(exerciseId));
  handOverFocus(exerciseId, plannedId, wasCurrent);
}

/**
 * Saves a new movement order (superset pairs stay together). Only the
 * session's order changes, never the program.
 */
export function reorderMovements(workoutId: string, exerciseIds: string[]) {
  return changeWorkout(workoutId, () => useAppStore.getState().reorderWorkoutExercises(workoutId, exerciseIds));
}

const inPlan = (exerciseId: string) =>
  useAppStore.getState().currentWorkoutDayPlan?.items.some((item) => item.exercise_id === exerciseId && !item.hidden) ?? false;

/** Flexible session: adds a movement with three sets. */
export async function addMovement(workoutId: string, exercise: Exercise) {
  await changeWorkout(workoutId, () => useAppStore.getState().addFlexibleExercise(exercise));
  if (!inPlan(exercise.id)) throw new Error('Could not add the exercise. Try again.');
}

/** Flexible session: pairs a new movement with this one as a superset (this one leads). */
export async function addSupersetPartner(workoutId: string, exerciseId: string, partner: Exercise) {
  await changeWorkout(workoutId, () => useAppStore.getState().addFlexibleSuperset(exerciseId, partner));
  const plan = useAppStore.getState().currentWorkoutDayPlan;
  const group = plan?.items.find((item) => item.exercise_id === exerciseId)?.superset_group_id;
  if (!group || !plan?.items.some((item) => item.exercise_id === partner.id && item.superset_group_id === group)) {
    throw new Error('Could not add the superset. Try again.');
  }
}

/** Flexible session: the pair goes back to two separate movements. */
export function unlinkSuperset(workoutId: string, exerciseId: string) {
  return changeWorkout(workoutId, () => useAppStore.getState().clearFlexibleSuperset(exerciseId));
}

/** Flexible session: takes a movement out; its logged sets stay in the workout. */
export async function removeMovement(workoutId: string, exerciseId: string) {
  await changeWorkout(workoutId, () => useAppStore.getState().removeFlexibleExerciseFromPlan(exerciseId));
  if (inPlan(exerciseId)) throw new Error('Could not remove the exercise. Try again.');
  const focus = useFocusStore.getState();
  if (focus.exerciseId === exerciseId) focus.focus(null);
}

/** Flexible session: renames it (an empty name keeps the old one). */
export function renameSession(workoutId: string, label: string) {
  return changeWorkout(workoutId, () => useAppStore.getState().setFlexibleWorkoutLabel(label));
}

/** A store error's own message (they are written for people), else a fallback. */
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
