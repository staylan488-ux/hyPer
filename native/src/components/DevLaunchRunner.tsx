import { router } from 'expo-router';
import { useEffect } from 'react';

import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/stores/appStore';
import { summarize, useFinishedStore } from '~/lib/finished';
import { setSkipped } from '~/lib/movement';
import { startRest } from '~/lib/rest';
import { liveSessionModel, previousTargetsFor, useFocusStore } from '~/lib/session';
import { buildSessionModel } from '~/lib/sessionModel';
import { devScrollTrace, readDevLaunch } from '~/platform/devLaunch';

/**
 * Debug builds only: opens the launch-argument route and runs a scripted
 * action through the real stores, so a screen state can be checked without
 * tapping. See src/platform/devLaunch.ts.
 */
export function DevLaunchRunner() {
  useEffect(() => {
    if (!__DEV__) return;
    const { route, action } = readDevLaunch();
    const timers: ReturnType<typeof setTimeout>[] = [];

    if (route) timers.push(setTimeout(() => router.navigate(route as never), 400));

    if (action === 'probeTimeout') {
      // With EXPO_PUBLIC_SUPABASE_URL pointing at a server that never answers,
      // a request must fail at timedFetch's deadline instead of hanging.
      timers.push(
        setTimeout(() => {
          const startedAt = Date.now();
          void supabase
            .from('profiles')
            .select('id')
            .limit(1)
            .then(({ status, error }) => {
              console.log(`[probe] status=${status} error=${error?.message ?? 'none'} after ${Date.now() - startedAt} ms`);
            });
        }, 1000),
      );
    }

    if (action === 'logSet' || action === 'logTwoSets') {
      const logNext = async () => {
        const workout = useAppStore.getState().currentWorkout;
        const next = workout?.sets.find((set) => !set.completed);
        if (!next) return;
        await useAppStore.getState().logSet(next.id, next.weight ?? 0, next.reps ?? 0, next.rpe ?? undefined);
        startRest(next.exercise_id);
      };
      timers.push(
        setTimeout(() => {
          void logNext().then(() => (action === 'logTwoSets' ? logNext() : undefined));
        }, 1500),
      );
    }

    if (action === 'logFood') {
      timers.push(setTimeout(() => router.push('/log-food'), 900));
    }

    if (action === 'switchMovement') {
      // The same path as tapping another movement; the scroll trace shows
      // whether the screen moves.
      timers.push(
        setTimeout(() => {
          const app = useAppStore.getState();
          const session = buildSessionModel(app.currentWorkout, { split: app.activeSplit, plan: app.currentWorkoutDayPlan }, null);
          const other = session?.movements.find(
            (movement) => movement.exerciseId !== session.current?.movement.exerciseId && movement.done < movement.sets.length,
          );
          if (!other) return;
          devScrollTrace.enabled = true;
          console.log(`[switch] focusing ${other.name}`);
          useFocusStore.getState().focus(other.exerciseId);
          setTimeout(() => {
            devScrollTrace.enabled = false;
            console.log('[switch] trace end');
          }, 2500);
        }, 2500),
      );
    }

    if (action === 'skipMovement') {
      // The same path as Skip on the card, for the movement up now.
      timers.push(
        setTimeout(() => {
          const session = liveSessionModel();
          if (session?.current) void setSkipped(session.workoutId, session.current.movement, true);
        }, 1500),
      );
    }

    if (action === 'finish') {
      timers.push(
        setTimeout(() => {
          const app = useAppStore.getState();
          const session = buildSessionModel(app.currentWorkout, { split: app.activeSplit, plan: app.currentWorkoutDayPlan }, null);
          if (!session) return;
          const summary = summarize(session, previousTargetsFor(session.workoutId));
          void app.completeWorkout().then(() => {
            useFinishedStore.getState().set(summary);
            router.push('/session-done');
          });
        }, 1200),
      );
    }

    if (action === 'noWorkout') {
      // The sample account starts mid-workout; finish it quietly, so a run's
      // Live Activity can be checked on its own.
      timers.push(
        setTimeout(() => {
          if (useAppStore.getState().currentWorkout) void useAppStore.getState().completeWorkout();
        }, 1200),
      );
    }

    return () => timers.forEach(clearTimeout);
  }, []);

  return null;
}
