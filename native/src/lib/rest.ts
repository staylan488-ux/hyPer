// The rest countdown between sets. It starts only after a set saves, and
// keeps running while you browse other tabs (it lives outside any screen).
import { useEffect } from 'react';
import { create } from 'zustand';

import { haptics } from './haptics';

export const DEFAULT_REST_SECONDS = 120;

type RestState = {
  endsAt: number | null;
  seconds: number;
  start: (seconds?: number) => void;
  extend: (seconds: number) => void;
  stop: () => void;
};

export const useRestStore = create<RestState>((set, get) => ({
  endsAt: null,
  seconds: DEFAULT_REST_SECONDS,
  start: (seconds = get().seconds) => set({ endsAt: Date.now() + seconds * 1000, seconds }),
  extend: (seconds) => {
    const { endsAt } = get();
    if (endsAt) set({ endsAt: endsAt + seconds * 1000 });
  },
  stop: () => set({ endsAt: null }),
}));

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
