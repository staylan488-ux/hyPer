import { format } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { historyDayKey, historyWorkoutTitle, orderHistoryMovements } from '@/lib/historyMonth';
import { nextPlannedDay, todayHero, weekSessionTarget } from '@/lib/todayModel';
import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { usePlanSchedule } from '@/hooks/usePlanSchedule';
import { useScheduleWorkouts } from '@/hooks/useScheduleWorkouts';
import { useWeekSessions } from '@/hooks/useWeekSessions';
import { readTodayDone } from '@/lib/todayDay';
import { getWorkoutDurationMs } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { SplitDay } from '@/types';

import { useAccountDay, useWorkoutsRevision } from './accountData';
import { loadHistoryMonth, useHistoryStore } from './history';

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
  // History's deletes and completions, and pull to refresh, re-read what was done.
  const workoutsRevision = useWorkoutsRevision((state) => state.revision);
  const { schedule, loading: scheduleLoading } = usePlanSchedule(userId, activeSplit?.id, revision);
  const {
    workouts: scheduleWorkouts,
    loading: scheduleWorkoutsLoading,
    error: scheduleError,
    retry: retrySchedule,
  } = useScheduleWorkouts(userId, activeSplit, schedule, currentWorkout, adaptiveSchedulingEnabled, workoutsRevision);

  // Starting or finishing a session changes whether today is done and the week's count.
  const refreshKey = `${refreshedAt}:${workoutsRevision}:${currentWorkout?.id ?? ''}:${currentWorkout?.completed ?? ''}`;
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
  // next planned one. undefined while unknown (loading, or the completions
  // failed to load); null when there is none to go by.
  let upNext: SplitDay | null | undefined = null;
  if (hero.kind === 'planned') upNext = hero.day;
  else if (hero.kind === 'rest' || hero.kind === 'done') upNext = aheadKnown ? next?.day ?? null : undefined;
  else if (hero.kind === 'loading' || hero.kind === 'schedule-error') upNext = undefined;
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

/** Today's finished workout as Today and Train show it once the day is done. */
export type FinishedToday = {
  id: string;
  title: string;
  /** The program day it was, if any. */
  splitDayId: string | null;
  /** Logged or not, per set in the workout's order: its tally. */
  marks: boolean[];
  /** Logged sets. */
  sets: number;
  minutes: number | null;
};

// One History read per account, day and refresh, however many cards ask.
let finishedRead: { key: string; settled: Promise<void> } | null = null;

/**
 * The workout finished today, from History's month (where the past workout
 * screen opens it), read again on each refresh while today is done. Undefined
 * while that read runs with nothing to show yet; null when there is none, or
 * History is on another month.
 */
export function useFinishedToday(done: boolean): FinishedToday | null | undefined {
  const userId = useAuthStore((state) => state.user?.id);
  const dayKey = useAccountDay((state) => state.dayKey);
  const refreshedAt = useAccountDay((state) => state.refreshedAt);
  const currentWorkout = useAppStore((state) => state.currentWorkout);
  const month = useHistoryStore((state) => state.month);
  const workouts = useHistoryStore((state) => state.workouts);
  const plans = useHistoryStore((state) => state.plans);
  // Only this month's History holds today; never move History off the month it shows.
  const thisMonth = format(month, 'yyyy-MM') === dayKey.slice(0, 7);
  // As useTodayPlan: a refresh, or starting or finishing a session, reads again.
  const key = `${userId}:${dayKey}:${refreshedAt}:${currentWorkout?.id ?? ''}:${currentWorkout?.completed ?? ''}`;
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    if (!done || !userId || !thisMonth) return;
    if (finishedRead?.key !== key) finishedRead = { key, settled: loadHistoryMonth() };
    let cancelled = false;
    void finishedRead.settled.then(() => {
      if (!cancelled) setSettled(key);
    });
    return () => {
      cancelled = true;
    };
  }, [done, userId, thisMonth, key]);

  // The latest one: History lists a day's workouts newest first.
  const workout = done && thisMonth ? workouts.find((entry) => entry.completed && historyDayKey(entry) === dayKey) ?? null : null;
  const plan = workout ? plans[workout.id] : undefined;
  const finished = useMemo((): FinishedToday | null => {
    if (!workout) return null;
    const sets = orderHistoryMovements(workout.sets, plan ?? null).flatMap((movement) => movement.sets);
    const duration = getWorkoutDurationMs(workout);
    return {
      id: workout.id,
      title: historyWorkoutTitle(workout, plan),
      splitDayId: workout.split_day_id ?? null,
      marks: sets.map((set) => set.completed),
      sets: sets.filter((set) => set.completed).length,
      minutes: duration ? Math.max(1, Math.round(duration / 60_000)) : null,
    };
  }, [workout, plan]);

  if (!done) return null;
  if (finished) return finished;
  return thisMonth && userId && settled !== key ? undefined : null;
}
