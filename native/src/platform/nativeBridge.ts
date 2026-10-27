// Replaces ../src/lib/nativeBridge.ts (see metro.config.js).
//
// The web app reaches its Swift code through Capacitor plugins. This app has no
// Capacitor, so shared code takes its non-plugin paths (isNativeIOS() is false)
// until each feature is rebuilt as a native module here. The plugin shapes
// below match the web bridge so shared code type-checks unchanged.

import { HyperBarcode } from '../../modules/hyper-barcode';
import { HyperHealth } from '../../modules/hyper-health';

// This app's own URL scheme (app.json "scheme") while it installs beside the
// Capacitor app; at cutover it takes over app.hyper.mobile. The shared OAuth
// callback parser checks returns against NATIVE_AUTH_REDIRECT_URL.
export const NATIVE_AUTH_CALLBACK_SCHEME = 'hyper-native';
export const NATIVE_AUTH_REDIRECT_URL = `${NATIVE_AUTH_CALLBACK_SCHEME}://auth/callback`;

export function isNativeIOS(): boolean {
  return false;
}

/** Apple Health is read through native/modules/hyper-health. */
export function hasNativeHealth(): boolean {
  return true;
}

type PluginListenerHandle = { remove: () => Promise<void> };

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
  addListener(eventName: 'authCallback', listener: (event: { callbackUrl: string }) => void): Promise<PluginListenerHandle>;
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

type LocationAuthorization = 'prompt' | 'denied' | 'restricted' | 'whenInUse' | 'always';

interface NativeRunPlugin {
  requestPermissions(): Promise<{ location: LocationAuthorization; precise: boolean; motionAvailable: boolean }>;
  startRecording(options: { runId: string; resume: boolean }): Promise<{ recording: boolean; lastSequence: number }>;
  stopRecording(options?: { discard?: boolean }): Promise<void>;
  getStatus(): Promise<{
    recording: boolean;
    runId: string | null;
    lastSequence: number;
    location: LocationAuthorization;
    precise: boolean;
  }>;
  drainSamples(options: { afterSequence: number }): Promise<{ samples: NativeRunSample[]; lastSequence: number; hasMore: boolean }>;
  drainControls(options: { afterSequence: number }): Promise<{ controls: NativeRunControl[]; lastSequence: number; hasMore: boolean }>;
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
  addListener(eventName: 'locationSample', listener: (sample: NativeRunSample) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'locationError', listener: (event: { code: string; message: string }) => void): Promise<PluginListenerHandle>;
  addListener(eventName: 'runControl', listener: (event: NativeRunControl) => void): Promise<PluginListenerHandle>;
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
  readWeightSamples(options: { since?: string; limit?: number }): Promise<{ samples: NativeWeightSample[] }>;
  enableWeightUpdates(): Promise<{ enabled: boolean }>;
  addListener(eventName: 'weightSamplesChanged', listener: () => void): Promise<PluginListenerHandle>;
}

interface NativeBarcodePlugin {
  getAvailability(): Promise<{ available: boolean }>;
  scanBarcode(): Promise<{ rawValue: string; format: string }>;
}

/** Every method rejects; each plugin will be replaced by a native module. */
function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: (_target, property) =>
      property === 'then'
        ? undefined
        : () => Promise.reject(new Error(`${name} is not available in the native app yet.`)),
  });
}

export const NativeAuth = unavailable<NativeAuthPlugin>('HyperAuth');
export const NativeRun = unavailable<NativeRunPlugin>('HyperRun');
// HealthKit body weight through native/modules/hyper-health.
export const NativeHealth: NativeHealthPlugin = HyperHealth;
// VisionKit's data scanner through native/modules/hyper-barcode.
export const NativeBarcode: NativeBarcodePlugin = HyperBarcode;
