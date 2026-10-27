// Changes to one movement of the live workout: its set count, a swap for this
// workout only, and switching a swap back. Writes go through the shared store
// actions, the same ones the web Train page uses.
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
  await (change === 'add' ? store.addWorkoutSet(exerciseId) : store.removeLastUncompletedSet(exerciseId));
  const after = setCount(exerciseId);
  return change === 'add' ? after > before : after < before;
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
  await afterNotes(workoutId, async () => {
    if (useAppStore.getState().currentWorkout?.id !== workoutId) throw new Error('This workout is no longer open.');
    await useAppStore.getState().substituteWorkoutExercise(exerciseId, replacement);
  });
  handOverFocus(exerciseId, replacement.id, wasCurrent);
}

/** Returns a swapped movement to the one it replaced. */
export async function switchBack(workoutId: string, exerciseId: string, plannedId: string, wasCurrent: boolean) {
  await afterNotes(workoutId, async () => {
    if (useAppStore.getState().currentWorkout?.id !== workoutId) throw new Error('This workout is no longer open.');
    await useAppStore.getState().switchBackWorkoutExercise(exerciseId);
  });
  handOverFocus(exerciseId, plannedId, wasCurrent);
}

/** A store error's own message (they are written for people), else a fallback. */
export const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;
