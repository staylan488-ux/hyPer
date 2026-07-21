import {
  Capacitor,
  registerPlugin,
  type PluginListenerHandle,
} from '@capacitor/core';

export const NATIVE_AUTH_CALLBACK_SCHEME = 'app.hyper.mobile';
export const NATIVE_AUTH_REDIRECT_URL = `${NATIVE_AUTH_CALLBACK_SCHEME}://auth/callback`;

export function isNativeIOS(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
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
  addListener(
    eventName: 'locationSample',
    listener: (sample: NativeRunSample) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'locationError',
    listener: (event: { code: string; message: string }) => void,
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

interface NativeBarcodePlugin {
  getAvailability(): Promise<{ available: boolean }>;
  scanBarcode(): Promise<{ rawValue: string; format: string }>;
}

export const NativeAuth = registerPlugin<NativeAuthPlugin>('HyperAuth');
export const NativeRun = registerPlugin<NativeRunPlugin>('HyperRun');
export const NativeHealth = registerPlugin<NativeHealthPlugin>('HyperHealth');
export const NativeBarcode = registerPlugin<NativeBarcodePlugin>('HyperBarcode');
