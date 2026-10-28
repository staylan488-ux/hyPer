// Replaces ../src/preview/flag.ts (see metro.config.js).
//
// Preview mode runs the real stores against the in-memory sample backend in
// ../src/preview, so the app can be explored without signing in and without
// touching real data. Development builds start in it unless
// EXPO_PUBLIC_HYPER_PREVIEW is "0"; a release build uses the real account
// unless it is "1", so an archive can never ship the sample data by accident.
const development = typeof __DEV__ === 'undefined' || __DEV__;
const PREVIEW = development ? process.env.EXPO_PUBLIC_HYPER_PREVIEW !== '0' : process.env.EXPO_PUBLIC_HYPER_PREVIEW === '1';

export const isPreviewActive = (): boolean => PREVIEW;

export const isAppSandboxActive = (): boolean => false;
