// Holds the screen awake while `active`. The app does it through
// native/src/platform/keepAwake.ts (expo-keep-awake), which
// native/metro.config.js swaps in for this file (it must stay so the swap can
// resolve). Outside the app there is no screen to hold, so this does nothing.
export const useKeepAwakeWhile: (active: boolean) => void = () => {};
