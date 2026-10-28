// Whether the app is in front of the user, and when that changes. The web app
// reads the page's visibility; the native app swaps in iOS app state
// (native/src/platform/appVisibility.ts), so shared hooks never touch
// `document` directly.

/** True while the app is on screen. Outside a browser it counts as on screen. */
export function isAppVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

/** Calls `listener` each time the app comes back to the front. Returns a disposer. */
export function onAppVisible(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', handleVisibility);
  return () => document.removeEventListener('visibilitychange', handleVisibility);
}

/**
 * Calls `listener` when the app goes to the background, and when the page is
 * being unloaded, the last chance to keep unsaved work. Returns a disposer.
 */
export function onAppHidden(listener: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const handleVisibility = () => {
    if (document.visibilityState === 'hidden') listener();
  };
  const handlePageHide = () => listener();
  document.addEventListener('visibilitychange', handleVisibility);
  if (typeof window !== 'undefined') window.addEventListener('pagehide', handlePageHide);
  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', handlePageHide);
  };
}
