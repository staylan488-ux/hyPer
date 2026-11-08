// The Recent list's data on the phone: the last fetched weeks of logs, kept so
// the next open shows them at once while a fresh read runs, and the foods
// hidden from the list on this device. Fuel's close-the-gap picks and the
// Fuel reminder read the same kept logs (readRecentCache, loadRecentCache).
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadRecentLogs,
  pruneHiddenRecentFoods,
  type HiddenRecentFoods,
  type RecentLog,
} from '@/lib/recentFoods';
import { useAuthStore } from '@/stores/authStore';
import { useFuelStore } from '~/lib/fuel';

type RecentCache = { userId: string; logs: RecentLog[]; at: number };
let cache: RecentCache | null = null;
const listeners = new Set<() => void>();

function keep(next: RecentCache | null) {
  cache = next;
  for (const listener of listeners) listener();
}

/** The kept logs for this account, or null before the first read (or after another account's). */
export function readRecentCache(userId: string | null | undefined): RecentCache | null {
  return userId && cache?.userId === userId ? cache : null;
}

/** Called whenever the kept logs change (a read lands, sign-out drops them). */
export function subscribeRecentCache(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const reading = new Map<string, Promise<void>>();
/**
 * Reads the window again unless the kept copy is younger than `maxAgeMs`; one
 * read at a time per account. A failure keeps what was kept.
 */
export function loadRecentCache(userId: string, maxAgeMs = 0): Promise<void> {
  const kept = readRecentCache(userId);
  if (kept && Date.now() - kept.at < maxAgeMs) return Promise.resolve();
  const running = reading.get(userId);
  if (running) return running;
  const read = loadRecentLogs(userId)
    .then(({ logs }) => {
      if (logs && useAuthStore.getState().user?.id === userId) keep({ userId, logs, at: Date.now() });
    })
    .catch(() => {})
    .finally(() => {
      reading.delete(userId);
    });
  reading.set(userId, read);
  return read;
}

// drop the list on sign-out or an account switch, not just on the next read
useAuthStore.subscribe((state) => {
  if (cache && state.user?.id !== cache.userId) keep(null);
});

// Food was logged, changed or deleted somewhere (Fuel reloads after every
// write): read the list again in the background, so the next open already
// shows it and nothing moves once it is on screen.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
useFuelStore.subscribe((state, previous) => {
  if (!cache || state.logs === previous.logs) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  const { userId } = cache;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void loadRecentCache(userId);
  }, 1500);
});

/** Same entries and food snapshots: the rows and quick-add both use the food. */
const sameLogs = (a: RecentLog[], b: RecentLog[]) =>
  a.length === b.length &&
  a.every((log, index) => {
    const other = b[index];
    return log.food_id === other.food_id && log.servings === other.servings && log.source === other.source
      && log.date === other.date && log.logged_at === other.logged_at && log.created_at === other.created_at
      && JSON.stringify(log.food) === JSON.stringify(other.food);
  });

/**
 * The window's logs: the kept ones at once, then the fresh read. Once the
 * person has started using the list (`settled`), a fresh read only refreshes
 * the kept copy, so rows never move under a finger; the next open shows it.
 */
export function useRecentLogs(userId: string) {
  const [logs, setLogs] = useState<RecentLog[] | null>(() => (cache?.userId === userId ? cache.logs : null));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // bumped when fresh logs replace what is shown, so the rows swap without motion
  const [version, setVersion] = useState(0);
  const settled = useRef(false);
  const shown = useRef(logs);

  useEffect(() => {
    let current = true;
    setFailed(false);
    void loadRecentLogs(userId)
      .catch((error: unknown) => ({ logs: null, error }))
      .then((result) => {
        if (!current) return;
        if (!result.logs) {
          setFailed(true);
          return;
        }
        keep({ userId, logs: result.logs, at: Date.now() });
        if (shown.current && (settled.current || sameLogs(shown.current, result.logs))) return;
        shown.current = result.logs;
        setLogs(result.logs);
        setVersion((value) => value + 1);
      });
    return () => {
      current = false;
    };
  }, [userId, attempt]);

  const settle = useCallback(() => {
    settled.current = true;
  }, []);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { logs, failed, version, settle, retry };
}

const hiddenKey = (userId: string) => `hyper-recent-hidden:${userId}`;

function writeHidden(userId: string, hidden: HiddenRecentFoods) {
  try {
    globalThis.localStorage?.setItem(hiddenKey(userId), JSON.stringify(hidden));
  } catch {
    // kept for this sheet only when the device cannot store it
  }
}

/** Foods hidden from Recent on this device (the close-the-gap picks leave them out too). */
export function readHidden(userId: string): HiddenRecentFoods {
  try {
    const raw = globalThis.localStorage?.getItem(hiddenKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as HiddenRecentFoods) : {};
  } catch {
    return {};
  }
}

/** Hides a food from Recent (and the close-the-gap picks) on this device until it is logged again; the new list. */
export function hideRecentFood(userId: string, key: string, current: HiddenRecentFoods = readHidden(userId)): HiddenRecentFoods {
  const next = pruneHiddenRecentFoods({ ...current, [key]: Date.now() });
  writeHidden(userId, next);
  return next;
}

/** Foods hidden from Recent on this device; each comes back when it is logged again. */
export function useHiddenRecentFoods(userId: string) {
  const [hidden, setHidden] = useState<HiddenRecentFoods>(() => readHidden(userId));
  const hide = useCallback(
    (key: string) => {
      setHidden((current) => hideRecentFood(userId, key, current));
    },
    [userId],
  );
  return { hidden, hide };
}
