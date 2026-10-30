// The Recent list's data on the phone: the last fetched weeks of logs, kept so
// the next open shows them at once while a fresh read runs, and the foods
// hidden from the list on this device.
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  loadRecentLogs,
  pruneHiddenRecentFoods,
  type HiddenRecentFoods,
  type RecentLog,
} from '@/lib/recentFoods';
import { useAuthStore } from '@/stores/authStore';
import { useFuelStore } from '~/lib/fuel';

let cache: { userId: string; logs: RecentLog[] } | null = null;

// drop the list on sign-out or an account switch, not just on the next read
useAuthStore.subscribe((state) => {
  if (cache && state.user?.id !== cache.userId) cache = null;
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
    void loadRecentLogs(userId)
      .then(({ logs }) => {
        if (logs && cache?.userId === userId) cache = { userId, logs };
      })
      .catch(() => {});
  }, 1500);
});

/** Two reads of the log say the same thing (same entries in the same order). */
const sameLogs = (a: RecentLog[], b: RecentLog[]) =>
  a.length === b.length &&
  a.every((log, index) => {
    const other = b[index];
    return log.food_id === other.food_id && log.servings === other.servings && log.date === other.date && log.logged_at === other.logged_at && log.created_at === other.created_at;
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
        cache = { userId, logs: result.logs };
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

function readHidden(userId: string): HiddenRecentFoods {
  try {
    const raw = globalThis.localStorage?.getItem(hiddenKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as HiddenRecentFoods) : {};
  } catch {
    return {};
  }
}

/** Foods hidden from Recent on this device; each comes back when it is logged again. */
export function useHiddenRecentFoods(userId: string) {
  const [hidden, setHidden] = useState<HiddenRecentFoods>(() => readHidden(userId));
  const hide = useCallback(
    (key: string) => {
      setHidden((current) => {
        const next = pruneHiddenRecentFoods({ ...current, [key]: Date.now() });
        try {
          globalThis.localStorage?.setItem(hiddenKey(userId), JSON.stringify(next));
        } catch {
          // kept for this sheet only when the device cannot store it
        }
        return next;
      });
    },
    [userId],
  );
  return { hidden, hide };
}
