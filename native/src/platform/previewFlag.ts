// Replaces ../src/preview/flag.ts (see metro.config.js).
//
// Preview mode runs the real stores against the in-memory sample backend in
// ../src/preview, so the app can be explored without signing in and without
// touching real data. It is on unless EXPO_PUBLIC_HYPER_PREVIEW is "0".
const PREVIEW = process.env.EXPO_PUBLIC_HYPER_PREVIEW !== '0';

export const isPreviewActive = (): boolean => PREVIEW;

export const isAppSandboxActive = (): boolean => false;
