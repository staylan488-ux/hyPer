// The live workout as the screens need it, derived from the shared app store.
// Writes go through the store's own actions (startWorkout, logSet).
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { create } from 'zustand';

import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { fetchPreviousSetTargets } from '@/lib/previousSetTargets';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { haptics } from './haptics';
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
  const plan = useAppStore((state) => state.currentWorkoutDayPlan);
  const focused = useFocusStore((state) => state.exerciseId);
  return useMemo(() => buildSessionModel(workout, { split, plan }, focused), [workout, split, plan, focused]);
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

/** Starts a program day's session; the same feedback wherever it is started from. */
export function useStartSession() {
  const startWorkout = useAppStore((state) => state.startWorkout);
  const [starting, setStarting] = useState<string | null>(null);
  const start = async (dayId: string): Promise<boolean> => {
    setStarting(dayId);
    try {
      const workout = await startWorkout(dayId);
      if (!workout) throw new Error('not started');
      haptics.success();
      return true;
    } catch {
      haptics.error();
      Alert.alert('Could not start', 'Check your connection and try again.');
      return false;
    } finally {
      setStarting(null);
    }
  };
  return { starting, start };
}
