// Development-only launch hooks for headless checks.
//
// iOS asks "Open in …?" before any link opened from the command line, which a
// script cannot answer. Debug builds instead read launch arguments, which iOS
// exposes through user defaults:
//
//   xcrun simctl launch <device> app.hyper.native -hyperRoute /train -hyperAction logSet
//
// `-hyperThen <route>` opens a second screen three seconds later, for screens
// that read what the first one loaded (a past workout needs History's list).
//
// Release builds ignore all of this.
import { Settings } from 'react-native';

export type DevLaunch = { route?: string; then?: string; action?: string; skipIntro?: boolean };

/** Debug only: while enabled, the workout screen logs every scroll offset to Metro. */
export const devScrollTrace = { enabled: false };

export function readDevLaunch(): DevLaunch {
  if (!__DEV__) return {};
  try {
    const route = Settings.get('hyperRoute');
    const then = Settings.get('hyperThen');
    const action = Settings.get('hyperAction');
    const devRoute = typeof route === 'string' && route.startsWith('/') ? route : undefined;
    const devAction = typeof action === 'string' ? action : undefined;
    return {
      route: devRoute,
      then: devRoute && typeof then === 'string' && then.startsWith('/') ? then : undefined,
      action: devAction,
      // A scripted check wants its screen at once; `-hyperIntro off` skips the
      // launch intro for any other run (UI test probes).
      skipIntro: Boolean(devRoute || devAction) || Settings.get('hyperIntro') === 'off',
    };
  } catch {
    return {};
  }
}
