// The shapes shared code uses to reach the phone's own features: the run
// recorder, Apple Health and the Keychain. The app uses
// native/src/platform/nativeBridge.ts instead, which native/metro.config.js
// swaps in for this file (it must stay so the swap can resolve) and which backs
// them with its Expo modules. This default has no phone behind it, so shared
// code takes its plain paths in tests and type-checks.

type PluginListenerHandle = { remove: () => Promise<void> };

export const NATIVE_AUTH_CALLBACK_SCHEME = 'app.hyper.mobile';
export const NATIVE_AUTH_REDIRECT_URL = `${NATIVE_AUTH_CALLBACK_SCHEME}://auth/callback`;

/** Always false: it meant the retired Capacitor shell. nativeSecureStorage's
 *  default storage still takes it as its switch. */
export function isNativeIOS(): boolean {
  return false;
}

interface NativeAuthPlugin {
  openOAuth(options: {
    url: string;
    callbackScheme: string;
    callbackHost: 'auth' | 'settings';
    callbackPath: string;
  }): Promise<{ callbackUrl: string }>;
  getSecureValue(options: { key: string }): Promise<{ value: string | null }>;
  setSecureValue(options: { key: string; value: string }): Promise<void>;
  removeSecureValue(options: { key: string }): Promise<void>;
  getPendingAuthCallback(): Promise<{ callbackUrl: string | null }>;
  addListener(
    eventName: 'authCallback',
    listener: (event: { callbackUrl: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export interface NativeRunSample {
  sequence: number;
  timestampMs: number;
  latitude: number;
  longitude: number;
  horizontalAccuracyM: number;
  speedMps: number | null;
  speedAccuracyMps: number | null;
  courseDegrees: number | null;
  courseAccuracyDegrees: number | null;
  altitudeM: number;
  verticalAccuracyM: number | null;
  motion: 'moving' | 'stationary' | 'unknown';
  reducedAccuracy: boolean;
  simulated: boolean;
}

export interface NativeRunControl {
  sequence: number;
  timestampMs: number;
  action: 'split' | 'rest' | 'finish';
}

interface NativeRunPlugin {
  requestPermissions(): Promise<{
    location: 'prompt' | 'denied' | 'restricted' | 'whenInUse' | 'always';
    precise: boolean;
    motionAvailable: boolean;
  }>;
  startRecording(options: { runId: string; resume: boolean }): Promise<{
    recording: boolean;
    lastSequence: number;
  }>;
  stopRecording(options?: { discard?: boolean }): Promise<void>;
  getStatus(): Promise<{
    recording: boolean;
    runId: string | null;
    lastSequence: number;
    location: 'prompt' | 'denied' | 'restricted' | 'whenInUse' | 'always';
    precise: boolean;
  }>;
  drainSamples(options: { afterSequence: number }): Promise<{
    samples: NativeRunSample[];
    lastSequence: number;
    hasMore: boolean;
  }>;
  drainControls(options: { afterSequence: number }): Promise<{
    controls: NativeRunControl[];
    lastSequence: number;
    hasMore: boolean;
  }>;
  syncLiveActivity(options: {
    runId: string;
    mode: 'free' | 'intervals';
    distanceM: number;
    elapsedS: number;
    livePace: string;
    averagePace: string;
    isResting: boolean;
  }): Promise<void>;
  shareDiagnostics(options: { filename: string; content: string }): Promise<void>;
  addListener(
    eventName: 'locationSample',
    listener: (sample: NativeRunSample) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'locationError',
    listener: (event: { code: string; message: string }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'runControl',
    listener: (event: NativeRunControl) => void,
  ): Promise<PluginListenerHandle>;
}

export interface NativeWeightSample {
  id: string;
  measuredAt: string;
  kilograms: number;
  sourceBundle: string;
  sourceName: string;
}

interface NativeHealthPlugin {
  requestBodyMeasurementAccess(): Promise<{ available: boolean; requested: boolean }>;
  readWeightSamples(options: { since?: string; limit?: number }): Promise<{
    samples: NativeWeightSample[];
  }>;
  enableWeightUpdates(): Promise<{ enabled: boolean }>;
  addListener(
    eventName: 'weightSamplesChanged',
    listener: () => void,
  ): Promise<PluginListenerHandle>;
}

// Every call rejects: there is no phone behind this default.
function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, property) =>
      property === 'then'
        ? undefined
        : () => Promise.reject(new Error(`${name} is available only in the iPhone app.`)),
  });
}

export const NativeAuth = unavailable<NativeAuthPlugin>('HyperAuth');
export const NativeRun = unavailable<NativeRunPlugin>('HyperRun');
export const NativeHealth = unavailable<NativeHealthPlugin>('HyperHealth');
/** Whether runs record through the native GPS recorder (NativeRun) instead of the browser's geolocation. */
export function hasNativeRun(): boolean {
  return false;
}
/** Whether Apple Health can be read here: the iPhone app only. */
export function hasNativeHealth(): boolean {
  return false;
}
