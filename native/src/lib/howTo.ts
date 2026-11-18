// "How to do it" in the movement sheet: the lines for a movement of the live
// workout, and whether the row starts open. The lines themselves are shared
// code (src/lib/movementHowTo.ts, docs/movement-how-to.md).
import { useState } from 'react';
import { create } from 'zustand';

import { movementHowTo, type HowTo } from '@/lib/movementHowTo';

import { usePreviousTargetsStore, type Movement } from './session';

/** With fewer past sessions of the movement than this, the row starts open. */
export const HOW_TO_OPEN_UNDER = 3;

/**
 * Whether the row starts open: for a movement still new to the person, by
 * the sessions the workout's lookup found. Null (the lookup has not landed)
 * starts folded, so the row never opens on a movement done a hundred times.
 */
export function howToStartsOpen(sessions: number | null): boolean {
  return sessions !== null && sessions < HOW_TO_OPEN_UNDER;
}

/** The lines for a movement, or null when its name says too little (no row then). */
export function howToFor(movement: Pick<Movement, 'name' | 'sets'>): HowTo | null {
  const exercise = movement.sets.find((set) => set.exercise)?.exercise;
  return movementHowTo({ name: exercise?.name ?? movement.name, equipment: exercise?.equipment ?? null });
}

/** Folding or opening the row is remembered per movement until the app restarts. */
const useChosenFold = create<{ chosen: Record<string, boolean> }>(() => ({ chosen: {} }));

/** The row's state for one movement: the person's last choice, else open while the movement is new. */
export function useHowToFold(workoutId: string, exerciseId: string): { open: boolean; toggle: () => void } {
  const chosen = useChosenFold((state) => state.chosen[exerciseId]);
  const sessions = usePreviousTargetsStore((state) => (state.workoutId === workoutId ? (state.history[exerciseId]?.length ?? 0) : null));
  // Decided as the sheet opens: a lookup landing while it is read does not move the page.
  const [first] = useState(() => howToStartsOpen(sessions));
  const open = chosen ?? first;
  return {
    open,
    toggle: () => useChosenFold.setState((state) => ({ chosen: { ...state.chosen, [exerciseId]: !open } })),
  };
}
