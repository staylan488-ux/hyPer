import { format, parseISO, startOfMonth } from 'date-fns';
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';

import { fetchHistoryMonth, historyDayKey, historyWorkoutTitle, orderHistoryMovements, type HistoryWorkout } from '@/lib/historyMonth';
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
import { noteTodayPlan, useLaunchHint } from './launchCache';
import { heroFromSeed, planBasis, seedHero, type TodaySeed } from './launchSnapshot';

/** Bumped after the schedule is saved on this device, so screens re-read it. */
export const useScheduleRevision = create<{ revision: number; bump: () => void }>((set) => ({
  revision: 0,
  bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/**
 * Today's training plan by the shared rules (src/lib/todayModel's todayHero):
 * the live session, the day planned by the program's schedule, a rest day, or
 * a session already done. Also the next session and this week's count.
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
  const splits = useAppStore((state) => state.splits);
  const workoutMode = useAppStore((state) => state.workoutMode);
  const hydratedForUserId = useAppStore((state) => state.hydratedForUserId);
  const workoutLoaded = useAppStore((state) => Boolean(userId) && state.workoutLoadedForUserId === userId);
  const launchSeed = useLaunchHint((state) => state.seed);
  const holdPlan = useLaunchHint((state) => state.holdPlan);
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
  const { done: todayDone, confirmed: doneConfirmed } = useTodayDone(userId, dayKey, refreshKey);
  const storeReady = Boolean(userId) && hydratedForUserId === userId;
  // The phone's copy didn't say "no workout": the plan waits for this launch's workout read.
  const heldForWorkout = holdPlan && !workoutLoaded;
  // The account load is over and that read still hasn't landed (no connection):
  // the card says so with Retry rather than holding an empty place.
  const workoutReadFailed = heldForWorkout && !loading;
  const [retryWorkout] = useState(() => () => void useAppStore.getState().fetchCurrentWorkout());

  const hero = useMemo(
    () =>
      workoutReadFailed ? { kind: 'schedule-error' as const, retry: retryWorkout } : todayHero({
        heroLoading: (loading && !storeReady) || heldForWorkout,
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
      workoutReadFailed,
      retryWorkout,
      loading,
      storeReady,
      heldForWorkout,
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

  // The plan decided earlier today, while this launch decides it again, and
  // only from the same schedule and days (a change shows the card's place).
  const basis = useMemo(
    () => planBasis({ activeSplit, schedule, adaptiveSchedulingEnabled }),
    [activeSplit, schedule, adaptiveSchedulingEnabled],
  );
  const fromSeed = useMemo(
    () => (!currentWorkout && !heldForWorkout && (!storeReady || hero.kind === 'loading')
      ? heroFromSeed(launchSeed, { dayKey, activeSplit, workoutMode, basis })
      : null),
    [currentWorkout, heldForWorkout, storeReady, hero.kind, launchSeed, dayKey, activeSplit, workoutMode, basis],
  );

  // The days after today are planned from the completions. A day already
  // trained shows before they load, so its next session waits for them.
  const aheadLoading = scheduleLoading || scheduleWorkoutsLoading;
  const aheadKnown = !aheadLoading && !scheduleError;
  const nextDay =
    !fromSeed && (hero.kind === 'rest' || hero.kind === 'done') && aheadKnown
      ? nextPlannedDay({ activeSplit, schedule, scheduleWorkouts, adaptiveSchedulingEnabled, dayKey })
      : null;
  // A plan shown from the phone's copy shows the next session that copy kept.
  const next = fromSeed ? launchSeed?.next ?? null : nextDay?.label ?? null;
  // The session up next: today's, or after a rest day or a day trained, the
  // next planned one. undefined while unknown (loading, a plan shown from the
  // phone's copy, or the completions failed to load); null when there is none
  // to go by.
  let upNext: SplitDay | null | undefined = null;
  if (fromSeed) upNext = undefined;
  else if (hero.kind === 'planned') upNext = hero.day;
  else if (hero.kind === 'rest' || hero.kind === 'done') upNext = aheadKnown ? nextDay?.day ?? null : undefined;
  else if (hero.kind === 'loading' || hero.kind === 'schedule-error') upNext = undefined;
  const week = useWeekSessions(userId, dayKey, refreshKey);
  const seedWeek = !currentWorkout && launchSeed?.dayKey === dayKey ? launchSeed.weekDone : null;

  // Kept for the next cold start: only a plan decided from this launch's own reads.
  const stable = storeReady && !currentWorkout && doneConfirmed && !fromSeed ? seedHero(hero) : null;
  const seedJson = stable
    ? JSON.stringify({
      dayKey,
      splitId: activeSplit?.id ?? null,
      mode: workoutMode,
      basis,
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
    upNext,
    /** The days after today can be planned: the schedule and its completions have loaded. */
    aheadKnown,
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
 * failed read counts as not done. confirmed: the latest read (for this
 * refreshKey) succeeded.
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
  /** Its day, yyyy-MM-dd: History shows it there when the record opens it. */
  day: string;
};

// One read per account, day and refresh, however many cards ask.
let finishedRead: { key: string; settled: Promise<void> } | null = null;

/**
 * Today's month as the record reads it while History shows another month
 * (History is never moved for the card), by the read's key.
 */
const useTodayMonth = create<{ key: string | null; workouts: HistoryWorkout[] }>(() => ({ key: null, workouts: [] }));

async function readTodayMonth(key: string, dayKey: string): Promise<void> {
  try {
    const { workouts } = await fetchHistoryMonth(startOfMonth(parseISO(dayKey)));
    // Only the latest read keeps its answer: one a refresh overtook would replace the newer one.
    if (finishedRead?.key !== key) return;
    useTodayMonth.setState({ key, workouts });
  } catch (error) {
    // No record: the card says "Trained today", as when History's own read fails.
    console.error("Could not read today's workout:", error);
  }
}

/**
 * The workout finished today, read again on each refresh while today is
 * done: from History's month while History shows this month (its edits show
 * at once), else from a read of this month of its own, so browsing an older
 * month never takes the record away. Undefined while the read runs with
 * nothing to show yet; null when there is none.
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
  const key = `${userId}:${dayKey}:${refreshedAt}:${currentWorkout?.id ?? ''}:${currentWorkout?.completed ?? ''}:${thisMonth ? 'history' : 'own'}`;
  const ownRead = useTodayMonth((state) => (state.key === key ? state.workouts : null));
  const [settled, setSettled] = useState<string | null>(null);

  useEffect(() => {
    if (!done || !userId) return;
    if (finishedRead?.key !== key) finishedRead = { key, settled: thisMonth ? loadHistoryMonth() : readTodayMonth(key, dayKey) };
    let cancelled = false;
    void finishedRead.settled.then(() => {
      if (!cancelled) setSettled(key);
    });
    return () => {
      cancelled = true;
    };
  }, [done, userId, thisMonth, key, dayKey]);

  // The latest one: History lists a day's workouts newest first.
  const shown = thisMonth ? workouts : ownRead ?? [];
  const workout = done ? shown.find((entry) => entry.completed && historyDayKey(entry) === dayKey) ?? null : null;
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
      day: dayKey,
    };
  }, [workout, plan, dayKey]);

  if (!done) return null;
  if (finished) return finished;
  return userId && settled !== key ? undefined : null;
}
