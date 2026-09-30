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

export function installStaleChunkReload(target: Window = window) {
  target.addEventListener('vite:preloadError', () => {
    reloadOnceForStaleChunk(
      () => target.sessionStorage,
      () => target.location.reload(),
    );
  });
}
