// The live workout as the screens need it, derived from the shared app store.
// Writes go through the store's own actions (startWorkout, logSet).
import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import { create } from 'zustand';

import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { fetchPreviousMovementNotes, fetchPreviousSetTargets, type PreviousMovementNotes } from '@/lib/previousSetTargets';
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

// A choice belongs to one workout: the next workout (or another account's)
// starts on its own first movement. A reload of the same workout keeps it.
let focusWorkoutId: string | null = null;
useAppStore.subscribe((state) => {
  const id = state.currentWorkout?.id ?? null;
  if (!id || id === focusWorkoutId) return;
  if (focusWorkoutId !== null) useFocusStore.setState({ exerciseId: null });
  focusWorkoutId = id;
});

/**
 * Skips and bring-backs still saving, by exercise id (true skipped, false
 * brought back), so the card moves on at once. Each clears once its save
 * lands, when the plan holds it, or fails.
 */
export const usePendingSkips = create<{ workoutId: string | null; skips: Record<string, boolean> }>(() => ({
  workoutId: null,
  skips: {},
}));

const NO_SKIPS: Record<string, boolean> = {};

export function useSessionModel(): SessionModel | null {
  const workout = useAppStore((state) => state.currentWorkout);
  const split = useAppStore((state) => state.activeSplit);
  const plan = useAppStore((state) => state.currentWorkoutDayPlan);
  const focused = useFocusStore((state) => state.exerciseId);
  const skips = usePendingSkips((state) => (workout && state.workoutId === workout.id ? state.skips : NO_SKIPS));
  return useMemo(() => buildSessionModel(workout, { split, plan, skips }, focused), [workout, split, plan, skips, focused]);
}

/** The same, outside a component. */
export function liveSessionModel(): SessionModel | null {
  const { currentWorkout, activeSplit, currentWorkoutDayPlan } = useAppStore.getState();
  const pending = usePendingSkips.getState();
  return buildSessionModel(
    currentWorkout,
    { split: activeSplit, plan: currentWorkoutDayPlan, skips: currentWorkout && pending.workoutId === currentWorkout.id ? pending.skips : NO_SKIPS },
    useFocusStore.getState().exerciseId,
  );
}

/**
 * Mounted once (tab layout): the live workout's day plan (swaps, order, a
 * flexible session's movements) follows the workout, as the web Train page
 * does. Resuming through Start leaves the store without one otherwise.
 */
export function useWorkoutDayPlan() {
  const workoutId = useAppStore((state) => state.currentWorkout?.id ?? null);
  const planWorkoutId = useAppStore((state) => state.currentWorkoutDayPlan?.workout_id ?? null);
  useEffect(() => {
    if (workoutId && planWorkoutId !== workoutId) void useAppStore.getState().fetchCurrentWorkoutDayPlan(workoutId);
  }, [workoutId, planWorkoutId]);
}

/**
 * Last time's weight, reps and RPE per exercise and set number for the live
 * workout. Kept in a store so Train, the movement sheet and Finish (on Today
 * too) read the same lookup.
 */
export const usePreviousTargetsStore = create<{ workoutId: string | null; targets: PreviousWorkoutSetMap }>(() => ({
  workoutId: null,
  targets: {},
}));

const NO_TARGETS: PreviousWorkoutSetMap = {};

/**
 * Mounted once (tab layout): looks up last time's numbers while a workout is
 * live, from the shared lookup. As on the web: a failed lookup tries again on
 * the next logged set.
 */
export function usePreviousTargetsLookup(session: SessionModel | null) {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [failed, setFailed] = useState(false);
  const exerciseKey = session ? session.movements.map((movement) => movement.exerciseId).sort().join(',') : '';
  const workoutId = session?.workoutId ?? null;
  const date = session?.date ?? null;
  const retry = failed ? (session?.doneCount ?? 0) : -1;

  useEffect(() => {
    if (!userId || !workoutId || !date || !exerciseKey) return;
    let cancelled = false;
    void fetchPreviousSetTargets({ userId, workoutId, date, exerciseIds: exerciseKey.split(',') }).then((result) => {
      if (cancelled) return;
      if (result) usePreviousTargetsStore.setState({ workoutId, targets: result });
      setFailed(!result);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, workoutId, date, exerciseKey, retry]);
}

/** Last time's numbers for this workout ({} until the lookup lands). */
export function usePreviousTargets(workoutId: string | null): PreviousWorkoutSetMap {
  return usePreviousTargetsStore((state) => (workoutId && state.workoutId === workoutId ? state.targets : NO_TARGETS));
}

/** The same, outside a component (Finish). */
export function previousTargetsFor(workoutId: string): PreviousWorkoutSetMap {
  const state = usePreviousTargetsStore.getState();
  return state.workoutId === workoutId ? state.targets : NO_TARGETS;
}

/**
 * Last time's note per movement, for the live workout. Kept in a store so the
 * movement sheet (its own screen) reads the same lookup Train made.
 */
export const usePreviousNotesStore = create<{ workoutId: string | null; notes: PreviousMovementNotes }>(() => ({
  workoutId: null,
  notes: {},
}));

export function usePreviousNotes(session: SessionModel | null): PreviousMovementNotes {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const exerciseKey = session ? session.movements.map((movement) => movement.exerciseId).sort().join(',') : '';
  const workoutId = session?.workoutId ?? null;
  const date = session?.date ?? null;
  const notes = usePreviousNotesStore((state) => (state.workoutId === workoutId ? state.notes : null));

  useEffect(() => {
    if (!userId || !workoutId || !date || !exerciseKey) return;
    let cancelled = false;
    void fetchPreviousMovementNotes({ userId, workoutId, date, exerciseIds: exerciseKey.split(',') }).then((result) => {
      if (!cancelled && result) usePreviousNotesStore.setState({ workoutId, notes: result });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, workoutId, date, exerciseKey]);

  return notes ?? {};
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
