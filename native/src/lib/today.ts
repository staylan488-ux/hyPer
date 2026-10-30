import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { nextPlannedSession, todayHero, weekSessionTarget } from '@/lib/todayModel';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useWeekSessions } from '@/hooks/useWeekSessions';
import { readTodayDone } from '@/lib/todayDay';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

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

  const next =
    hero.kind === 'rest' || hero.kind === 'done'
      ? nextPlannedSession({ activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey })
      : null;
  const week = useWeekSessions(userId, dayKey, refreshKey);

  return {
    hero,
    next,
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
