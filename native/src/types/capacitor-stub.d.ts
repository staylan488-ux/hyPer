// Type-only stand-in for @capacitor/core and @capacitor/app (see tsconfig paths).
//
// A few shared web files that this app never bundles (Metro swaps them for
// src/platform versions) still import Capacitor, and TypeScript follows their
// relative imports. This lets them type-check without installing Capacitor.
export type PluginListenerHandle = { remove: () => Promise<void> };

export declare const Capacitor: {
  isNativePlatform(): boolean;
  getPlatform(): string;
};

export declare const App: {
  addListener(
    eventName: 'appStateChange',
    listener: (state: { isActive: boolean }) => void,
  ): Promise<PluginListenerHandle>;
};

export declare function registerPlugin<T>(name: string, implementations?: unknown): T;
