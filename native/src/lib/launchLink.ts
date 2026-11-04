// The screen a home-screen widget, the workout card or the run card asked for
// when its tap launched the app.
//
// On a cold launch the saved session is still being read from the Keychain,
// so the app's screens are guarded and Expo Router sends the link to the way
// in (index). +native-intent remembers the link here, and index opens it once
// the app is allowed. Only those links are kept, never any other path.

/** Where the widgets and cards link (targets/widgets, appURL). */
const LAUNCH_PATHS = ['/fuel', '/train', '/you/targets', '/run'] as const;

export type LaunchPath = (typeof LAUNCH_PATHS)[number];

let pending: LaunchPath | null = null;

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
