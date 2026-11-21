// The week around the live workout, kept ready for the Add list: the sets
// finished in the week's other workouts and the week's planned sets per
// muscle, as Progress counts them. Read while the workout is live, so the
// list opens with its lead rows already worked out and nothing moves under a
// finger. What leads the list is src/lib/addSuggestions.ts.
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import type { SessionMovementSets } from '@/lib/addSuggestions';
import { plannedWeekDays, programVolume, type MuscleSets } from '@/lib/muscleVolume';
import { readWeekSetsBesides } from '@/lib/weekSetsRead';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { useAccountDay, useWorkoutsRevision } from './accountData';
import type { SessionModel } from './sessionModel';
import { useScheduleRevision } from './today';

export type WeekFit = {
  /** Finished sets this week outside the live workout, per muscle. */
  elsewhere: MuscleSets;
  /** The week's planned sets per muscle; null with no plan. */
  planned: MuscleSets | null;
};

type State = { workoutId: string | null; elsewhere: MuscleSets | null; planned: MuscleSets | null; plannedKnown: boolean };
const EMPTY: State = { workoutId: null, elsewhere: null, planned: null, plannedKnown: false };

export const useWeekFitStore = create<State>(() => EMPTY);

const forWorkout = (state: State, workoutId: string): State => (state.workoutId === workoutId ? state : { ...EMPTY, workoutId });

/**
 * Mounted with the live workout (Train): reads the week once, and again when
 * finished workouts change elsewhere (History) or the day turns.
 */
export function useWeekFitLookup(session: SessionModel): void {
  const workoutId = session.workoutId;
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const dayKey = useAccountDay((state) => state.dayKey);
  const workoutsRevision = useWorkoutsRevision((state) => state.revision);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void readWeekSetsBesides(userId, workoutId).then(
      (elsewhere) => {
        if (!cancelled) useWeekFitStore.setState((state) => ({ ...forWorkout(state, workoutId), elsewhere }));
      },
      // A failed read leaves the Add list as it always was.
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [userId, workoutId, dayKey, workoutsRevision]);

  // The planned week, from the same inputs Progress plans it with.
  const activeSplit = useAppStore((state) => state.activeSplit);
  const workoutMode = useAppStore((state) => state.workoutMode);
  const currentWorkout = useAppStore((state) => state.currentWorkout);
  const adaptiveSchedulingEnabled = useAdaptiveSplitScheduling();
  const scheduleRevision = useScheduleRevision((state) => state.revision);
  const { schedule, loading: scheduleLoading } = usePlanSchedule(userId ?? undefined, activeSplit?.id, scheduleRevision);
  const { workouts: scheduleWorkouts, loading: completionsLoading } = useScheduleWorkouts(userId, activeSplit, schedule, currentWorkout, adaptiveSchedulingEnabled, workoutsRevision);
  const hasPlan = workoutMode !== 'flexible' && Boolean(activeSplit?.days.length);
  const planned = useMemo(
    () => (hasPlan && activeSplit
      ? programVolume({
        days: plannedWeekDays({ splitDays: activeSplit.days, daysPerWeek: activeSplit.days_per_week, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey }),
      })
      : null),
    [hasPlan, activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey],
  );
  const settled = !hasPlan || (!scheduleLoading && !completionsLoading);
  useEffect(() => {
    if (settled) useWeekFitStore.setState((state) => ({ ...forWorkout(state, workoutId), planned, plannedKnown: true }));
  }, [workoutId, settled, planned]);
}

/** The week for this workout, or null until both reads have landed. */
export function weekFitFor(workoutId: string): WeekFit | null {
  const state = useWeekFitStore.getState();
  if (state.workoutId !== workoutId || state.elsewhere === null || !state.plannedKnown) return null;
  return { elsewhere: state.elsewhere, planned: state.planned };
}

/** Today's movements with their sets logged and still to do; a skipped movement has none to come. */
export function sessionMovementSets(session: SessionModel): SessionMovementSets[] {
  return session.movements.flatMap((movement) => {
    const exercise = movement.sets.find((set) => set.exercise)?.exercise;
    if (!exercise) return [];
    return [{ exercise, done: movement.done, left: movement.skipped ? 0 : Math.max(0, movement.sets.length - movement.done) }];
  });
}

/** Every movement the active program holds, on any day. */
export function programExerciseIds(): Set<string> {
  const split = useAppStore.getState().activeSplit;
  return new Set((split?.days ?? []).flatMap((day) => day.exercises.map((entry) => entry.exercise_id)));
}
