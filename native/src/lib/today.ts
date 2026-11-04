import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { nextPlannedDay, todayHero, weekSessionTarget } from '@/lib/todayModel';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useWeekSessions } from '@/hooks/useWeekSessions';
import { readTodayDone } from '@/lib/todayDay';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { SplitDay } from '@/types';

import { useAccountDay } from './accountData';

/** Bumped after the schedule is saved on this device, so screens re-read it. */
export const useScheduleRevision = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * Today's training plan by the web app's rules (todayModel's todayHero): the
 * live session, the day planned by the program's schedule, a rest day, or a
 * session already done. Also the next session and this week's count.
 */
export function useTodayPlan() {
  const userId = useAuthStore((state) => state.user?.id);
  const { dayKey, refreshedAt, loading } = useAccountDay();
  const activeSplit = useAppStore((state) => state.activeSplit);
  const currentWorkout = useAppStore((state) => state.currentWorkout);
  const currentWorkoutDayPlan = useAppStore((state) => state.currentWorkoutDayPlan);
  const splits = useAppStore((state) => state.splits);
  const workoutMode = useAppStore((state) => state.workoutMode);
  const hydratedForUserId = useAppStore((state) => state.hydratedForUserId);
  const adaptiveSchedulingEnabled = useAdaptiveSplitScheduling();
  const revision = useScheduleRevision((state) => state.revision);
  const { schedule, loading: scheduleLoading } = usePlanSchedule(userId, activeSplit?.id, revision);
  const {
    workouts: scheduleWorkouts,
    loading: scheduleWorkoutsLoading,
    error: scheduleError,
    retry: retrySchedule,
  } = useScheduleWorkouts(userId, activeSplit, schedule, currentWorkout, adaptiveSchedulingEnabled);

  // Starting or finishing a session changes whether today is done and the week's count.
  const refreshKey = `${refreshedAt}:${currentWorkout?.id ?? ''}:${currentWorkout?.completed ?? ''}`;
  const todayDone = useTodayDone(userId, dayKey, refreshKey);
  const storeReady = Boolean(userId) && hydratedForUserId === userId;

  const hero = useMemo(
    () =>
      todayHero({
        heroLoading: loading && !storeReady,
        currentWorkout,
        currentWorkoutDayPlan,
        splits,
        todayDone,
        workoutMode,
        activeSplit,
        schedule,
        scheduleLoading,
        scheduleWorkoutsLoading,
        scheduleWorkouts,
        scheduleError,
        retrySchedule,
        refreshedAt,
        dayKey,
        adaptiveSchedulingEnabled,
      }),
    [
      loading,
      storeReady,
      currentWorkout,
      currentWorkoutDayPlan,
      splits,
      todayDone,
      workoutMode,
      activeSplit,
      schedule,
      scheduleLoading,
      scheduleWorkoutsLoading,
      scheduleWorkouts,
      scheduleError,
      retrySchedule,
      refreshedAt,
      dayKey,
      adaptiveSchedulingEnabled,
    ],
  );

  // The days after today are planned from the completions. A day already
  // trained shows before they load, so its next session waits for them.
  const aheadLoading = scheduleLoading || scheduleWorkoutsLoading;
  const aheadKnown = !aheadLoading && !scheduleError;
  const next =
    (hero.kind === 'rest' || hero.kind === 'done') && aheadKnown
      ? nextPlannedDay({ activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey })
      : null;
  // The session up next: today's, or after a rest day or a day trained, the
  // next planned one. undefined while loading; null when there is none to go by.
  let upNext: SplitDay | null | undefined = null;
  if (hero.kind === 'planned') upNext = hero.day;
  else if (hero.kind === 'rest' || hero.kind === 'done') upNext = aheadKnown ? next?.day ?? null : aheadLoading ? undefined : null;
  else if (hero.kind === 'loading') upNext = undefined;
  const week = useWeekSessions(userId, dayKey, refreshKey);

  return {
    hero,
    next: next?.label ?? null,
    upNext,
    /** The days after today can be planned: the schedule and its completions have loaded. */
    aheadKnown,
    schedule,
    scheduleWorkouts,
    adaptiveSchedulingEnabled,
    weekDone: week.dates?.length ?? null,
    weekTarget: weekSessionTarget(workoutMode, schedule, activeSplit),
  };
}

/** Whether a session was completed today; undefined until known. A failed read counts as not done, as on the web. */
function useTodayDone(userId: string | undefined, dayKey: string, refreshKey: string) {
  const [result, setResult] = useState<{ key: string; done: { title: string } | null } | null>(null);
  const key = `${userId}:${dayKey}`;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const readKey = `${userId}:${dayKey}`;
    readTodayDone(userId, dayKey)
      .then((done) => {
        if (!cancelled) setResult({ key: readKey, done });
      })
      .catch(() => {
        if (!cancelled) setResult((previous) => (previous?.key === readKey ? previous : { key: readKey, done: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dayKey, refreshKey]);
  return result?.key === key ? result.done : undefined;
}
