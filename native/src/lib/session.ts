// The live workout as the screens need it, derived from the shared app store.
// Writes go through the store's own actions (startWorkout, logSet).
import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { create } from 'zustand';

import { getExerciseLibrary, peekExerciseLibrary } from '@/lib/exerciseLibrary';
import { closeRelatives, readFirstTimes, type FirstTimeRead } from '@/lib/firstTimeTargets';
import { fetchMovementSets } from '@/lib/movementHistory';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { fetchPreviousMovementNotes, fetchPreviousTraining, type PreviousMovementNotes } from '@/lib/previousSetTargets';
import type { MovementHistoryMap, RepRange } from '@/lib/setTargets';
import type { Exercise } from '@/types';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { haptics } from './haptics';
import { sessionModelCache, type SessionModel } from './sessionModel';

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

// One build of the model per change, shared by every screen that shows it.
const sharedSessionModel = sessionModelCache();

export function useSessionModel(): SessionModel | null {
  const workout = useAppStore((state) => state.currentWorkout);
  const split = useAppStore((state) => state.activeSplit);
  const splits = useAppStore((state) => state.splits);
  const plan = useAppStore((state) => state.currentWorkoutDayPlan);
  const focused = useFocusStore((state) => state.exerciseId);
  const skips = usePendingSkips((state) => (workout && state.workoutId === workout.id ? state.skips : NO_SKIPS));
  return sharedSessionModel(workout, { split, splits, plan, skips }, focused);
}

/** The same, outside a component. */
export function liveSessionModel(): SessionModel | null {
  const { currentWorkout, activeSplit, splits, currentWorkoutDayPlan } = useAppStore.getState();
  const pending = usePendingSkips.getState();
  return sharedSessionModel(
    currentWorkout,
    { split: activeSplit, splits, plan: currentWorkoutDayPlan, skips: currentWorkout && pending.workoutId === currentWorkout.id ? pending.skips : NO_SKIPS },
    useFocusStore.getState().exerciseId,
  );
}

/**
 * Mounted once (tab layout): the live workout's day plan (swaps, order, a
 * flexible session's movements) follows the workout. Resuming through Start
 * leaves the store without one otherwise.
 */
export function useWorkoutDayPlan() {
  const workoutId = useAppStore((state) => state.currentWorkout?.id ?? null);
  const planWorkoutId = useAppStore((state) => state.currentWorkoutDayPlan?.workout_id ?? null);
  useEffect(() => {
    if (workoutId && planWorkoutId !== workoutId) void useAppStore.getState().fetchCurrentWorkoutDayPlan(workoutId);
  }, [workoutId, planWorkoutId]);
}

/** Where each first-time movement starts, by exercise id: null when nothing says (see src/lib/firstTimeTargets). */
export type FirstTimeStarts = FirstTimeRead['starts'];

/**
 * Last time's weight, reps and RPE per exercise and set number for the live
 * workout, and each movement's recent sessions (for set targets), from one
 * read. Kept in a store so Train, the movement sheet and Finish (on Today
 * too) read the same lookup.
 *
 * A movement the recent read has nothing on gets one wider read: its older
 * sessions join `history` (`older` keeps them across a re-read), or, when it
 * has never been trained, `starts` holds where its first session begins.
 */
export const usePreviousTargetsStore = create<{
  workoutId: string | null;
  targets: PreviousWorkoutSetMap;
  history: MovementHistoryMap;
  older: MovementHistoryMap;
  starts: FirstTimeStarts;
}>(() => ({
  workoutId: null,
  targets: {},
  history: {},
  older: {},
  starts: {},
}));

const NO_TARGETS: PreviousWorkoutSetMap = {};
const NO_HISTORY: MovementHistoryMap = {};
const NO_STARTS: FirstTimeStarts = {};

type MissingMovement = { exercise: Exercise; range: RepRange | null };

/** The session's movements the recent read found nothing on, with what the wider read needs. */
function missingMovements(session: SessionModel, history: MovementHistoryMap): MissingMovement[] {
  return session.movements.flatMap((movement) => {
    if (history[movement.exerciseId]?.length) return [];
    const exercise = movement.sets.find((set) => set.exercise)?.exercise;
    if (!exercise) return [];
    const min = movement.plan?.target_reps_min;
    const max = movement.plan?.target_reps_max;
    const range = typeof min === 'number' && typeof max === 'number' && min > 0 && max >= min ? { min, max } : null;
    return [{ exercise, range }];
  });
}

/**
 * The wider read for movements with no recent history: every logged set of
 * each, and of its close relatives in the library. Null when a read fails.
 */
async function readMissing(missing: MissingMovement[], workoutId: string, date: string): Promise<FirstTimeRead | null> {
  // Without the library there are no relatives to start from; older sessions still read.
  const library = await getExerciseLibrary().catch(() => peekExerciseLibrary() ?? []);
  const ids = new Set(missing.map((entry) => entry.exercise.id));
  for (const entry of missing) {
    for (const relative of closeRelatives(entry.exercise, library)) ids.add(relative.id);
  }
  const rows = await fetchMovementSets([...ids]);
  if (!rows) return null;
  return readFirstTimes({
    movements: missing.map((entry) => entry.exercise),
    library,
    rows,
    workoutId,
    date,
    ranges: Object.fromEntries(missing.map((entry) => [entry.exercise.id, entry.range])),
  });
}

/**
 * Mounted once (tab layout): looks up last time's numbers while a workout is
 * live, from the shared lookup. A failed lookup tries again on the next
 * logged set.
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
    void (async () => {
      const result = await fetchPreviousTraining({ userId, workoutId, date, exerciseIds: exerciseKey.split(',') });
      if (cancelled) return;
      if (!result) return setFailed(true);
      // What an earlier wider read of this workout found stays while this one runs.
      const before = usePreviousTargetsStore.getState();
      const kept = before.workoutId === workoutId ? { older: before.older, starts: before.starts } : { older: {}, starts: {} };
      usePreviousTargetsStore.setState({ workoutId, targets: result.targets, history: { ...kept.older, ...result.history }, ...kept });
      const live = liveSessionModel();
      const missing = live && live.workoutId === workoutId
        ? missingMovements(live, result.history).filter(({ exercise }) => !(exercise.id in kept.older) && !(exercise.id in kept.starts))
        : [];
      if (missing.length === 0) return setFailed(false);
      const read = await readMissing(missing, workoutId, date);
      if (cancelled) return;
      if (read) {
        usePreviousTargetsStore.setState((state) => (state.workoutId === workoutId
          ? { older: { ...state.older, ...read.history }, starts: { ...state.starts, ...read.starts }, history: { ...read.history, ...state.history } }
          : state));
      }
      setFailed(!read);
    })();
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

/** Each movement's recent sessions for this workout, for set targets ({} until the lookup lands). */
export function usePreviousHistory(workoutId: string | null): MovementHistoryMap {
  return usePreviousTargetsStore((state) => (workoutId && state.workoutId === workoutId ? state.history : NO_HISTORY));
}

/** The same, outside a component (Finish). */
export function previousHistoryFor(workoutId: string): MovementHistoryMap {
  const state = usePreviousTargetsStore.getState();
  return state.workoutId === workoutId ? state.history : NO_HISTORY;
}

/** Where this workout's first-time movements start ({} until the wider read lands). */
export function usePreviousStarts(workoutId: string | null): FirstTimeStarts {
  return usePreviousTargetsStore((state) => (workoutId && state.workoutId === workoutId ? state.starts : NO_STARTS));
}

/** The same, outside a component (Finish). */
export function previousStartsFor(workoutId: string): FirstTimeStarts {
  const state = usePreviousTargetsStore.getState();
  return state.workoutId === workoutId ? state.starts : NO_STARTS;
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
