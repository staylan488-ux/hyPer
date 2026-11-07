// Whether preview mode is on: the app running on the in-memory sample backend
// in this folder, with no account. The app decides it in
// native/src/platform/previewFlag.ts (from the build), which
// native/metro.config.js swaps in for this file (it must stay so the swap can
// resolve). Outside the app preview is off; tests that need it mock this file.
export const isPreviewActive = (): boolean => false;
