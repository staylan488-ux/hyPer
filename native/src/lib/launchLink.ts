// The screen a home-screen widget, the workout card or the run card asked for
// when its tap launched the app.
//
// On a cold launch the saved session is still being read from the Keychain,
// so the app's screens are guarded and Expo Router sends the link to the way
// in (index). +native-intent remembers the link here, and index opens it once
// the app is allowed. Only those links are kept, never any other path.

/** Where the widgets and cards link (targets/widgets, appURL). */
const LAUNCH_PATHS = ['/fuel', '/train', '/you/targets', '/run', '/log-food'] as const;

export type LaunchPath = (typeof LAUNCH_PATHS)[number];

let pending: LaunchPath | null = null;
let openRuns = 0;
const logFoodHolders: Array<() => void> = [];

export function holdRunLinks(): () => void {
  openRuns += 1;
  return () => { openRuns -= 1; };
}

export const blocksRunLink = (link: string): boolean => openRuns > 0 && launchPath(link) !== null;

/**
 * While Log food is already open, tapping the meal-analysis Live Activity brings
 * the app back to that open sheet (focusing its AI tab if needed) instead of
 * pushing a duplicate modal over the in-flight or finished estimate.
 */
export function holdLogFoodLinks(onFocus: () => void = () => {}): () => void {
  logFoodHolders.push(onFocus);
  return () => {
    const index = logFoodHolders.lastIndexOf(onFocus);
    if (index >= 0) logFoodHolders.splice(index, 1);
  };
}

/** Handles a tap on the meal-analysis card while Log food is already open. */
export function consumeLogFoodLink(link: string): boolean {
  if (logFoodHolders.length === 0 || launchPath(link) !== '/log-food') return false;
  logFoodHolders[logFoodHolders.length - 1]();
  return true;
}

/** The app route a widget or card link opens, or null for any other link. */
export function launchPath(link: string): LaunchPath | null {
  const path = link
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '');
  return LAUNCH_PATHS.find((item) => item === `/${path}`) ?? null;
}

/** Keeps the link that launched the app, if it is a widget or card link. */
export function rememberLaunchLink(link: string): void {
  pending = launchPath(link);
}

/** The launch link still waiting to open, without using it up. */
export function pendingLaunchLink(): LaunchPath | null {
  return pending;
}

/** Forgets the launch link: it has opened, or someone has to sign in first. */
export function dropLaunchLink(): void {
  pending = null;
}
