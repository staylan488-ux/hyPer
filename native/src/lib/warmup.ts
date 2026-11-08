// Warm-up sets and plates for the live workout (rules in src/lib/warmupPlates).
// Warm-ups are never logged: ticking one off is kept for this launch only,
// per workout and movement. The bar a movement uses is kept on this phone
// per account, like rest lengths.
import { useEffect } from 'react';
import { create } from 'zustand';

import { defaultBarFor, loadBarWeights, saveBarWeight, type BarWeights } from '@/lib/warmupPlates';
import { useAuthStore } from '@/stores/authStore';

type WarmupState = {
  /** The account `bars` were read for. */
  userId: string | null;
  bars: BarWeights;
  /** Warm-up sets ticked off, by `tickKey`. */
  ticked: Record<string, true>;
};

export const useWarmupStore = create<WarmupState>(() => ({ userId: null, bars: {}, ticked: {} }));

/** One warm-up set of one movement in one workout. Its weight and reps are part of it, so a changed ramp starts clear. */
export const tickKey = (workoutId: string, exerciseId: string, step: { weight: number; reps: number }) =>
  `${workoutId}:${exerciseId}:${step.weight}x${step.reps}`;

export function toggleWarmup(key: string) {
  useWarmupStore.setState((state) => {
    const ticked = { ...state.ticked };
    if (ticked[key]) delete ticked[key];
    else ticked[key] = true;
    return { ticked };
  });
}

type BarMovement = { name?: string | null; equipment?: string | null } | null | undefined;

/**
 * The bar a movement is loaded on: the one picked for it on this phone, else
 * its default (an EZ bar 25 lb, any other 45). Reads the account's choices
 * once per sign-in.
 */
export function useBarWeight(exerciseId: string | null, exercise: BarMovement): number {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const picked = useWarmupStore((state) => (exerciseId && state.userId === userId ? state.bars[exerciseId] : undefined));
  useEffect(() => {
    if (useWarmupStore.getState().userId === userId) return;
    useWarmupStore.setState({ userId, bars: loadBarWeights(userId), ticked: {} });
  }, [userId]);
  return picked ?? defaultBarFor(exercise);
}

/** Keeps the bar picked for a movement. */
export function setBarWeight(exerciseId: string, bar: number) {
  const userId = useAuthStore.getState().user?.id ?? null;
  // Signed out (or no account read yet), it holds for this launch only.
  useWarmupStore.setState((state) => ({
    userId,
    bars: userId ? saveBarWeight(userId, exerciseId, bar) : { ...state.bars, [exerciseId]: bar },
  }));
}
