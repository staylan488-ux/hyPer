const RELOADED_KEY = 'hyper:stale-chunk-reload';

type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * After a web deploy, an open tab can ask for a hashed chunk the server or
 * service worker no longer has. Reload once per tab session so the fresh build
 * loads. A second failure, or storage that can't hold the flag, falls through
 * to the route error screen instead of risking a reload loop.
 */
export function reloadOnceForStaleChunk(
  storage: () => FlagStorage | undefined,
  reload: () => void,
): boolean {
  try {
    const flags = storage();
    if (!flags || flags.getItem(RELOADED_KEY)) return false;
    flags.setItem(RELOADED_KEY, '1');
  } catch {
    return false;
  }
  reload();
  return true;
}

interface ReloadEnv {
  storage: () => FlagStorage | undefined;
  reload: () => void;
  isOffline: () => boolean;
}

const browserEnv: ReloadEnv = {
  storage: () => window.sessionStorage,
  reload: () => window.location.reload(),
  isOffline: () => typeof navigator !== 'undefined' && navigator.onLine === false,
};

/**
 * Wraps a route's chunk loader, and only that: background warm-ups and
 * optional imports (the 3D scenes) keep their own quiet fallbacks and never
 * reload the page. Offline, a failed load is a connection problem, not a stale
 * deploy, so it goes to the route error screen without spending the reload.
 */
export function reloadOnStaleChunk<T>(
  load: () => Promise<T>,
  env: ReloadEnv = browserEnv,
): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      if (!env.isOffline() && reloadOnceForStaleChunk(env.storage, env.reload)) {
        // Keep the current screen up until the reload replaces the page.
        return new Promise<T>(() => {});
      }
      throw error;
    });
}
