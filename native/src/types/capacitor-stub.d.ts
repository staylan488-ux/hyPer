// Type-only stand-in for the Capacitor packages shared code imports (see
// tsconfig paths).
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

// @capacitor/status-bar
export declare const Style: { readonly Dark: 'DARK'; readonly Light: 'LIGHT'; readonly Default: 'DEFAULT' };
export declare const StatusBar: { setStyle(options: { style: string }): Promise<void> };

// @capacitor/haptics
export declare const ImpactStyle: { readonly Heavy: 'HEAVY'; readonly Medium: 'MEDIUM'; readonly Light: 'LIGHT' };
export declare const NotificationType: { readonly Success: 'SUCCESS'; readonly Warning: 'WARNING'; readonly Error: 'ERROR' };
export declare const Haptics: {
  impact(options: { style: string }): Promise<void>;
  notification(options: { type: string }): Promise<void>;
  selectionStart(): Promise<void>;
  selectionChanged(): Promise<void>;
  selectionEnd(): Promise<void>;
};

// @capacitor/local-notifications
export declare const LocalNotifications: {
  checkPermissions(): Promise<{ display: string }>;
  requestPermissions(): Promise<{ display: string }>;
  schedule(options: {
    notifications: Array<{ id: number; title: string; body: string; schedule?: { at: Date } }>;
  }): Promise<unknown>;
  cancel(options: { notifications: Array<{ id: number }> }): Promise<void>;
};

// @capacitor-community/keep-awake
export declare const KeepAwake: { keepAwake(): Promise<void>; allowSleep(): Promise<void> };
