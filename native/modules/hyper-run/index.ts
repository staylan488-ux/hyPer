// The run recorder (ios/HyperRunModule.swift), with the same calls and events
// as the Capacitor app's HyperRun plugin, so the shared src/lib/nativeRunSource
// and src/hooks/useRunTracker run unchanged. The native bridge
// (src/platform/nativeBridge.ts) hands it to shared code as NativeRun.

export type LocationAuthorization = 'prompt' | 'denied' | 'restricted' | 'whenInUse' | 'always';

export interface RunSample {
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

export interface RunControl {
  sequence: number;
  timestampMs: number;
  action: 'split' | 'rest' | 'finish';
}

export type RunCue = 'lap' | 'sprintStart' | 'sprintEnd';

type Subscription = { remove: () => void };

interface HyperRunNative {
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
  drainSamples(options: { afterSequence: number }): Promise<{ samples: RunSample[]; lastSequence: number; hasMore: boolean }>;
  drainControls(options: { afterSequence: number }): Promise<{ controls: RunControl[]; lastSequence: number; hasMore: boolean }>;
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
  playCue(kind: RunCue): Promise<void>;
  addListener(eventName: 'locationSample', listener: (sample: RunSample) => void): Subscription;
  addListener(eventName: 'locationError', listener: (event: { code: string; message: string }) => void): Subscription;
  addListener(eventName: 'runControl', listener: (event: RunControl) => void): Subscription;
}

let loaded: HyperRunNative | null = null;
// Loaded on first use, and typed locally: the native bridge (which uses this)
// is also imported by shared code under test, outside React Native.
type ExpoModules = { requireNativeModule<T>(name: string): T };
const native = (): HyperRunNative => (loaded ??= (require('expo') as ExpoModules).requireNativeModule<HyperRunNative>('HyperRun'));

type Listener<E extends string> = E extends 'locationSample'
  ? (sample: RunSample) => void
  : E extends 'locationError'
    ? (event: { code: string; message: string }) => void
    : (event: RunControl) => void;

export const HyperRun = {
  requestPermissions: () => native().requestPermissions(),
  startRecording: (options: { runId: string; resume: boolean }) => native().startRecording(options),
  stopRecording: (options?: { discard?: boolean }) => native().stopRecording(options ?? {}),
  getStatus: () => native().getStatus(),
  drainSamples: (options: { afterSequence: number }) => native().drainSamples(options),
  drainControls: (options: { afterSequence: number }) => native().drainControls(options),
  syncLiveActivity: (options: Parameters<HyperRunNative['syncLiveActivity']>[0]) => native().syncLiveActivity(options),
  shareDiagnostics: (options: { filename: string; content: string }) => native().shareDiagnostics(options),
  /** Lap and sprint tones, over any music and with the screen locked. */
  playCue: (kind: RunCue) => native().playCue(kind),
  addListener: async <E extends 'locationSample' | 'locationError' | 'runControl'>(eventName: E, listener: Listener<E>) => {
    const subscription = (native().addListener as (name: string, listener: (event: never) => void) => Subscription)(
      eventName,
      listener as (event: never) => void,
    );
    return { remove: async () => subscription.remove() };
  },
};
