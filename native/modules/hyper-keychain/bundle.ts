// The bundle ID this build runs as, from iOS itself: app.hyper.native for the
// test app, app.hyper.mobile once released. Kept apart from index.ts and loaded
// lazily so shared tests can import the native bridge without React Native.
export function runningBundleIdentifier(): string {
  try {
    // Typed by hand: importing expo's types here would pull React Native's
    // globals into the web app's type-check through the shared tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expo = require('expo') as { requireOptionalNativeModule: (name: string) => { bundleIdentifier?: string } | null };
    return expo.requireOptionalNativeModule('HyperKeychain')?.bundleIdentifier ?? '';
  } catch {
    return '';
  }
}
