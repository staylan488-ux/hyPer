// The rest between sets, kept the way the web app keeps it (src/lib/restTimer):
// one stored rest that runs, pauses or runs out, and outlives screens and app
// launches. It starts after a set saves or from the timer button in Train's
// header. Each movement keeps its own length, shared with the web app
// (src/lib/restPreferences): its own, else the last chosen, else 90 s.
//
// While a rest runs, a "Rest over" notification is scheduled for its end and
// the workout's Live Activity counts it down on the lock screen. Both follow
// every pause, change and end (syncRestAlerts below). The card's +30 s and End
// rest change both without the app; the app applies those taps to its rest
// as soon as it runs (catchUpRestTaps below).
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import {
  DEFAULT_REST_SECONDS,
  getLastUsedRestSeconds,
  loadRestPreferences,
  loadRestPreferencesAsync,
  resolveRestSeconds,
  saveRestPreference,
  type RestPreferences,
} from '@/lib/restPreferences';
import {
  clearRestTimerSession,
  createRestTimerSession,
  extendRestTimerSession,
  getRestTimerRemainingSeconds,
  pauseRestTimerSession,
  readRestTimerSession,
  resumeRestTimerSession,
  saveRestTimerSession,
  syncRestTimerSession,
  type RestTimerSession,
} from '@/lib/restTimer';
import { watchRestTimerSignOut, watchRestTimerWorkoutEnd } from '@/lib/restTimerWorkoutGuard';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';

import { syncWorkoutActivityRest } from '~/platform/liveActivity';
import {
  cancelRestEndNotification,
  dismissDeliveredRestNotification,
  scheduleRestEndNotification,
} from '~/platform/restNotifications';

import { addRestControlListener, markRestControlsApplied, pendingRestControls } from '../../modules/hyper-activity';

import { haptics } from './haptics';
import { applyRestControls } from './restControls';
import { useFocusStore } from './session';
import { buildSessionModel } from './sessionModel';

type RestState = {
  /** The rest in progress, as the web app stores it. A finished one reads as no rest. */
  session: RestTimerSession | null;
  /** Rest lengths by movement, for the signed-in person. */
  prefs: RestPreferences;
  /** A length chosen with no movement up (every set done), for this launch. */
  chosen: number | null;
};

export const useRestStore = create<RestState>(() => ({ session: null, prefs: {}, chosen: null }));

function commit(session: RestTimerSession | null) {
  if (session) saveRestTimerSession(session);
  else clearRestTimerSession();
  useRestStore.setState({ session });
}

/** A movement's rest length; with no movement, the last length chosen. */
export function restSecondsFor(
  exerciseId: string | null,
  prefs = useRestStore.getState().prefs,
  chosen = useRestStore.getState().chosen,
): number {
  if (exerciseId) return resolveRestSeconds(prefs, exerciseId);
  return chosen ?? getLastUsedRestSeconds(prefs) ?? DEFAULT_REST_SECONDS;
}

/** The set that's up, as the "Rest over" notification names it (the web's words). */
export function restLabel(movementName: string, setNumber: number): string {
  return `${movementName} · set ${setNumber}`;
}

function nextUpLabel(): string | null {
  const { currentWorkout, activeSplit, currentWorkoutDayPlan } = useAppStore.getState();
  const model = buildSessionModel(
    currentWorkout,
    { split: activeSplit, plan: currentWorkoutDayPlan },
    useFocusStore.getState().exerciseId,
  );
  const next = model?.current;
  return next ? restLabel(next.movement.name, next.setNumber) : null;
}

/** The set that's up changed mid-rest (a swap, another movement chosen): name the new one. */
export function relabelRest(label: string) {
  const { session } = useRestStore.getState();
  if (session && session.status !== 'completed' && session.nextUpLabel !== label) commit({ ...session, nextUpLabel: label });
}

/** Starts a rest at the movement's length, replacing any rest in progress. */
export function startRest(exerciseId: string | null) {
  const workoutId = useAppStore.getState().currentWorkout?.id;
  if (!workoutId) return;
  commit(createRestTimerSession(workoutId, restSecondsFor(exerciseId), new Date(), { exerciseId, nextUpLabel: nextUpLabel() }));
}

export function pauseRest() {
  const { session } = useRestStore.getState();
  if (session?.status === 'running') commit(pauseRestTimerSession(session));
}

export function resumeRest() {
  const { session } = useRestStore.getState();
  if (session?.status === 'paused') commit(resumeRestTimerSession(session));
}

export function extendRest(seconds: number) {
  const { session } = useRestStore.getState();
  if (session && session.status !== 'completed') commit(extendRestTimerSession(session, seconds));
}

/** Ends the rest now: End rest, or the workout finishing. */
export function stopRest() {
  commit(null);
}

/**
 * Sets a movement's rest length and keeps it for that movement, as the web
 * does. A rest in progress starts over, running, at the new length.
 */
export function setRestLength(exerciseId: string | null, seconds: number) {
  const userId = useAuthStore.getState().user?.id;
  const { session } = useRestStore.getState();
  if (userId && exerciseId) useRestStore.setState({ prefs: saveRestPreference(userId, exerciseId, seconds) });
  else useRestStore.setState({ chosen: seconds });
  if (session && session.status !== 'completed') {
    commit(
      createRestTimerSession(session.workoutId, seconds, new Date(), {
        exerciseId: session.exerciseId ?? exerciseId,
        nextUpLabel: session.nextUpLabel ?? nextUpLabel(),
      }),
    );
  }
}

/** Taps on the card's +30 s and End rest not yet applied, and a way to confirm them once they are. */
function pendingRestTaps() {
  const controls = pendingRestControls();
  const last = controls.reduce((latest, control) => Math.max(latest, control.sequence), 0);
  return {
    controls,
    applied: () => {
      if (last > 0) markRestControlsApplied(last);
    },
  };
}

/** Applies taps on the card's rest buttons made since the app last looked. */
function catchUpRestTaps() {
  const taps = pendingRestTaps();
  if (taps.controls.length === 0) return;
  const { session } = useRestStore.getState();
  const next = applyRestControls(session, taps.controls);
  if (next !== session) commit(next);
  taps.applied();
}

/** Whole seconds left on a running or paused rest; null when there is none. */
export function restLeft(session: RestTimerSession | null, now: number): number | null {
  if (!session || session.status === 'completed') return null;
  return getRestTimerRemainingSeconds(session, new Date(now));
}

/** What the notification and the lock-screen card were last told, to skip repeats. */
function alertsKey(session: RestTimerSession | null): string {
  if (!session) return 'none';
  const paused = session.status === 'paused' ? session.remainingSeconds : '';
  return [session.status, session.endsAt, session.durationSeconds, paused, session.nextUpLabel ?? ''].join('|');
}

function syncRestAlerts(session: RestTimerSession | null) {
  switch (session?.status) {
    case 'running': {
      // The card's bar reads against the whole rest, also after a pause or +30 s.
      const endsAt = Date.parse(session.endsAt);
      const startedAt = new Date(endsAt - session.durationSeconds * 1000).toISOString();
      void scheduleRestEndNotification(session.endsAt, session.nextUpLabel);
      syncWorkoutActivityRest({ startedAtIso: startedAt, endsAtIso: session.endsAt });
      break;
    }
    case 'paused':
      void cancelRestEndNotification();
      syncWorkoutActivityRest({ pausedRemainingSeconds: session.remainingSeconds });
      break;
    case 'completed':
      // Time ran out: "Rest over" fires (or fired) on its own; leave it.
      syncWorkoutActivityRest(null);
      break;
    default:
      void cancelRestEndNotification();
      syncWorkoutActivityRest(null);
  }
}

/**
 * Mounted once (tab layout): restores a stored rest, keeps the "Rest over"
 * notification and the lock-screen countdown in step with it, and drops the
 * rest when its workout ends elsewhere or the person signs out (the shared
 * guard). A delivered "Rest over" clears once the app is back in front.
 */
export function useRestLifecycle() {
  useEffect(() => {
    // Taps on the card while the app was closed come first: +30 s may have
    // moved the end of a rest that would otherwise read as over.
    const taps = pendingRestTaps();
    const stored = applyRestControls(readRestTimerSession(), taps.controls);
    const synced = stored ? syncRestTimerSession(stored) : null;
    // A rest that ran out while the app was closed already alerted.
    commit(synced && synced.status !== 'completed' ? synced : null);
    taps.applied();

    let lastKey = '';
    const sync = (session: RestTimerSession | null) => {
      const key = alertsKey(session);
      if (key === lastKey) return;
      lastKey = key;
      syncRestAlerts(session);
    };
    sync(useRestStore.getState().session);
    const unsubscribe = useRestStore.subscribe((state) => sync(state.session));

    const dropRest = () => useRestStore.setState({ session: null });
    const stopWorkoutWatch = watchRestTimerWorkoutEnd(useAppStore, dropRest);
    const stopSignOutWatch = watchRestTimerSignOut(useAuthStore, dropRest);

    const restTaps = addRestControlListener(catchUpRestTaps);

    void dismissDeliveredRestNotification();
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      catchUpRestTaps();
      void dismissDeliveredRestNotification();
    });

    return () => {
      unsubscribe();
      stopWorkoutWatch();
      stopSignOutWatch();
      restTaps.remove();
      appState.remove();
    };
  }, []);
}

/** Mounted once (tab layout): when a running rest runs out, a haptic in the app, then it reads as done. */
export function useRestFinish() {
  const endsAt = useRestStore((state) => (state.session?.status === 'running' ? state.session.endsAt : null));
  useEffect(() => {
    if (!endsAt) return;
    const end = Date.parse(endsAt);
    // A little after the end, so the rest reads as finished when it fires.
    const timer = setTimeout(() => {
      // A +30 s on the card that the app has not applied yet keeps the rest going.
      catchUpRestTaps();
      const { session } = useRestStore.getState();
      if (session?.status !== 'running' || session.endsAt !== endsAt) return;
      // Late means the app was away, and the notification already said so.
      if (AppState.currentState === 'active' && Date.now() - end < 1500) haptics.success();
      const finished = syncRestTimerSession(session);
      commit(
        finished.status === 'completed'
          ? finished
          : { ...session, status: 'completed', remainingSeconds: 0, completedAt: new Date().toISOString() },
      );
    }, Math.max(0, end - Date.now()) + 60);
    return () => clearTimeout(timer);
  }, [endsAt]);
}

/** Mounted once (tab layout): the person's rest lengths, cached first, then merged with the server's. */
export function useRestPreferences() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    if (!userId) {
      useRestStore.setState({ prefs: {}, chosen: null });
      return;
    }
    useRestStore.setState({ prefs: loadRestPreferences(userId) });
    let cancelled = false;
    void loadRestPreferencesAsync(userId).then((prefs) => {
      if (!cancelled) useRestStore.setState({ prefs });
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);
}
