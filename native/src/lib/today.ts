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
import { noteTodayPlan, useLaunchHint } from './launchCache';
import { heroFromSeed, seedHero, type TodaySeed } from './launchSnapshot';

/** Bumped after the schedule is saved on this device, so screens re-read it. */
export const useScheduleRevision = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * Today's training plan by the web app's rules (todayModel's todayHero): the
 * live session, the day planned by the program's schedule, a rest day, or a
 * session already done. Also the next session and this week's count.
 *
 * A cold start later the same day shows the plan this phone last decided
 * (launchCache's seed) while the reads it rests on land; `seeded` says so.
 */
export function useTodayPlan() {
  const userId = useAuthStore((state) => state.user?.id);
  const { dayKey, refreshedAt, loading } = useAccountDay();
  const activeSplit = useAppStore((state) => state.activeSplit);
  const currentWorkout = useAppStore((state) => state.currentWorkout);
  const currentWorkoutDayPlan = useAppStore((state) => state.currentWorkoutDayPlan);
  const workoutMode = useAppStore((state) => state.workoutMode);
  const hydratedForUserId = useAppStore((state) => state.hydratedForUserId);
  const workoutLoaded = useAppStore((state) => Boolean(userId) && state.workoutLoadedForUserId === userId);
  const launchSeed = useLaunchHint((state) => state.seed);
  const holdPlan = useLaunchHint((state) => state.holdPlan);
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
  const { done: todayDone, confirmed: doneConfirmed } = useTodayDone(userId, dayKey, refreshKey);
  const storeReady = Boolean(userId) && hydratedForUserId === userId;
  // The phone's copy didn't say "no workout": the plan waits for this launch's workout read.
  const heldForWorkout = holdPlan && !workoutLoaded;

  const hero = useMemo(
    () =>
      todayHero({
        heroLoading: (loading && !storeReady) || heldForWorkout,
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
      heldForWorkout,
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

  // The plan decided earlier today, while this launch decides it again.
  const fromSeed = useMemo(
    () => (!currentWorkout && !heldForWorkout && (!storeReady || hero.kind === 'loading')
      ? heroFromSeed(launchSeed, { dayKey, activeSplit, workoutMode })
      : null),
    [currentWorkout, heldForWorkout, storeReady, hero.kind, launchSeed, dayKey, activeSplit, workoutMode],
  );

  const next = fromSeed
    ? launchSeed?.next ?? null
    : hero.kind === 'rest' || hero.kind === 'done'
      ? nextPlannedSession({ activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey })
      : null;
  const week = useWeekSessions(userId, dayKey, refreshKey);
  const seedWeek = !currentWorkout && launchSeed?.dayKey === dayKey ? launchSeed.weekDone : null;

  // Kept for the next cold start: only a plan decided from this launch's own reads.
  const stable = storeReady && !currentWorkout && doneConfirmed && !fromSeed ? seedHero(hero) : null;
  const seedJson = stable
    ? JSON.stringify({
      dayKey,
      splitId: activeSplit?.id ?? null,
      mode: workoutMode,
      hero: stable,
      next,
      weekDone: week.dates?.length ?? null,
    } satisfies TodaySeed)
    : null;
  useEffect(() => {
    if (seedJson) noteTodayPlan(JSON.parse(seedJson) as TodaySeed);
  }, [seedJson]);

  return {
    hero: fromSeed ?? hero,
    next,
    schedule,
    scheduleWorkouts,
    adaptiveSchedulingEnabled,
    weekDone: week.dates?.length ?? seedWeek,
    weekTarget: weekSessionTarget(workoutMode, schedule, activeSplit),
    /** The hero comes from the phone's copy (never for the widgets). */
    seeded: fromSeed !== null,
  };
}

/**
 * Whether a session was completed today; done is undefined until known. A
 * failed read counts as not done, as on the web. confirmed: the latest read
 * (for this refreshKey) succeeded.
 */
function useTodayDone(userId: string | undefined, dayKey: string, refreshKey: string) {
  const [result, setResult] = useState<{ key: string; refreshKey: string; done: { title: string } | null; ok: boolean } | null>(null);
  const key = `${userId}:${dayKey}`;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const readKey = `${userId}:${dayKey}`;
    readTodayDone(userId, dayKey)
      .then((done) => {
        if (!cancelled) setResult({ key: readKey, refreshKey, done, ok: true });
      })
      .catch(() => {
        if (!cancelled) {
          setResult((previous) => (previous?.key === readKey
            ? { ...previous, refreshKey, ok: false }
            : { key: readKey, refreshKey, done: null, ok: false }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [userId, dayKey, refreshKey]);
  const current = result?.key === key ? result : null;
  return { done: current ? current.done : undefined, confirmed: Boolean(current?.ok && current.refreshKey === refreshKey) };
}
