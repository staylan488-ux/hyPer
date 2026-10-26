// The live workout as the screens need it, derived from the shared app store.
// Nothing here writes; logging a set goes through the store's own logSet.
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { fetchPreviousSetTargets } from '@/lib/previousSetTargets';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { buildSessionModel, type SessionModel } from './sessionModel';

export type { Movement, SessionModel } from './sessionModel';

/** The movement the person chose to work on next, if not the first unfinished one. */
export const useFocusStore = create<{ exerciseId: string | null; focus: (id: string | null) => void }>((set) => ({
  exerciseId: null,
  focus: (exerciseId) => set({ exerciseId }),
}));

export function useSessionModel(): SessionModel | null {
  const workout = useAppStore((state) => state.currentWorkout);
  const split = useAppStore((state) => state.activeSplit);
  const focused = useFocusStore((state) => state.exerciseId);
  return useMemo(() => buildSessionModel(workout, split, focused), [workout, split, focused]);
}

/** Last time's weight, reps and RPE per exercise and set number, from the shared lookup. */
export function usePreviousTargets(session: SessionModel | null): PreviousWorkoutSetMap {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [targets, setTargets] = useState<PreviousWorkoutSetMap>({});
  const exerciseKey = session ? session.movements.map((movement) => movement.exerciseId).sort().join(',') : '';
  const workoutId = session?.workoutId ?? null;
  const date = session?.date ?? null;

  useEffect(() => {
    if (!userId || !workoutId || !date || !exerciseKey) return;
    let cancelled = false;
    void fetchPreviousSetTargets({ userId, workoutId, date, exerciseIds: exerciseKey.split(',') }).then((result) => {
      if (!cancelled && result) setTargets(result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, workoutId, date, exerciseKey]);

  return targets;
}

/** Re-renders every `intervalMs` while mounted. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
