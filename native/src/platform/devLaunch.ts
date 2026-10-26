// Development-only launch hooks for headless checks.
//
// iOS asks "Open in …?" before any link opened from the command line, which a
// script cannot answer. Debug builds instead read launch arguments, which iOS
// exposes through user defaults:
//
//   xcrun simctl launch <device> app.hyper.native -hyperRoute /train -hyperAction logSet
//
// Release builds ignore all of this.
import { Settings } from 'react-native';

export type DevLaunch = { route?: string; action?: string };

/** Debug only: while enabled, the workout screen logs every scroll offset to Metro. */
export const devScrollTrace = { enabled: false };

export function readDevLaunch(): DevLaunch {
  if (!__DEV__) return {};
  try {
    const route = Settings.get('hyperRoute');
    const action = Settings.get('hyperAction');
    return {
      route: typeof route === 'string' && route.startsWith('/') ? route : undefined,
      action: typeof action === 'string' ? action : undefined,
    };
  } catch {
    return {};
  }
}
