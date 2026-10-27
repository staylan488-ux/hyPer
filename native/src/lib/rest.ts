// The rest countdown between sets. It starts after a set saves or from the
// clock in Train's header, and keeps running while you browse other tabs (it
// lives outside any screen). Each movement keeps its own rest length, shared
// with the web app (src/lib/restPreferences): its own, else the last length
// chosen, else 90 s.
import { useEffect } from 'react';
import { create } from 'zustand';

import {
  DEFAULT_REST_SECONDS,
  loadRestPreferences,
  loadRestPreferencesAsync,
  resolveRestSeconds,
  saveRestPreference,
  type RestPreferences,
} from '@/lib/restPreferences';
import { useAuthStore } from '@/stores/authStore';

import { haptics } from './haptics';

type RestState = {
  endsAt: number | null;
  /** The running rest's length, or the last one used. */
  seconds: number;
  /** The movement the running rest follows. */
  exerciseId: string | null;
  /** Rest lengths by movement, for the signed-in person. */
  prefs: RestPreferences;
  start: (seconds: number, exerciseId: string | null) => void;
  extend: (seconds: number) => void;
  stop: () => void;
};

export const useRestStore = create<RestState>((set, get) => ({
  endsAt: null,
  seconds: DEFAULT_REST_SECONDS,
  exerciseId: null,
  prefs: {},
  start: (seconds, exerciseId) => set({ endsAt: Date.now() + seconds * 1000, seconds, exerciseId }),
  extend: (seconds) => {
    const { endsAt } = get();
    if (endsAt) set({ endsAt: endsAt + seconds * 1000 });
  },
  stop: () => set({ endsAt: null }),
}));

/** A movement's rest length; without a movement, the last length used. */
export function restSecondsFor(exerciseId: string | null, prefs = useRestStore.getState().prefs): number {
  return exerciseId ? resolveRestSeconds(prefs, exerciseId) : useRestStore.getState().seconds;
}

/** Starts a rest at the movement's length. */
export function startRest(exerciseId: string | null) {
  useRestStore.getState().start(restSecondsFor(exerciseId), exerciseId);
}

/**
 * Sets a movement's rest length and keeps it for that movement, as the web
 * does. A running rest starts over at the new length.
 */
export function setRestLength(exerciseId: string | null, seconds: number) {
  const userId = useAuthStore.getState().user?.id;
  const state = useRestStore.getState();
  const prefs = userId && exerciseId ? saveRestPreference(userId, exerciseId, seconds) : state.prefs;
  useRestStore.setState({ prefs, seconds });
  if (state.endsAt) state.start(seconds, exerciseId);
}

/** Whole seconds left, or null when no rest is running. */
export function remainingSeconds(endsAt: number | null, now: number): number | null {
  if (!endsAt) return null;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

/** Mounted once (tab layout): a haptic when rest ends, then the timer clears. */
export function useRestFinish() {
  const endsAt = useRestStore((state) => state.endsAt);
  useEffect(() => {
    if (!endsAt) return;
    const timer = setTimeout(() => {
      haptics.success();
      useRestStore.getState().stop();
    }, Math.max(0, endsAt - Date.now()));
    return () => clearTimeout(timer);
  }, [endsAt]);
}

/** Mounted once (tab layout): the person's rest lengths, cached first, then merged with the server's. */
export function useRestPreferences() {
  const userId = useAuthStore((state) => state.user?.id ?? null);
  useEffect(() => {
    if (!userId) {
      useRestStore.setState({ prefs: {} });
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
