// Stands in for @capacitor/core, @capacitor/app and @capacitor/status-bar
// (see metro.config.js).
//
// Shared helpers such as ../src/lib/authResume.ts import Capacitor only to ask
// "is this the native shell?" and to listen for app state. Here the answer is
// no, so they take their plain paths; this app's own foreground handling uses
// React Native's AppState instead.
type PluginListenerHandle = { remove: () => Promise<void> };

const noListener: PluginListenerHandle = { remove: async () => {} };

export const Capacitor = {
  isNativePlatform: () => false,
  getPlatform: () => 'web',
};

export const App = {
  addListener: async (): Promise<PluginListenerHandle> => noListener,
};

// themeStore styles the status bar only when isNativePlatform() is true, so
// these are never called here; iOS styles it from the app's appearance.
export const Style = { Dark: 'DARK', Light: 'LIGHT', Default: 'DEFAULT' } as const;

export const StatusBar = {
  setStyle: async (_options: { style: string }): Promise<void> => {},
};

export function registerPlugin<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, property) =>
      property === 'then'
        ? undefined
        : () => Promise.reject(new Error(`${name} is not available in the native app yet.`)),
  });
}
