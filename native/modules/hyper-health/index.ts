export interface NativeWeightSample {
  id: string;
  measuredAt: string;
  kilograms: number;
  sourceBundle: string;
  sourceName: string;
}

type Subscription = { remove: () => void };

interface HyperHealthNative {
  requestBodyMeasurementAccess(): Promise<{ available: boolean; requested: boolean }>;
  readWeightSamples(options: { since?: string; limit?: number }): Promise<{ samples: NativeWeightSample[] }>;
  enableWeightUpdates(): Promise<{ enabled: boolean }>;
  addListener(eventName: 'weightSamplesChanged', listener: () => void): Subscription;
}

let loaded: HyperHealthNative | null = null;
// Loaded on first use, and typed locally: the native bridge (which uses this)
// is also imported by shared code under test, outside React Native.
type ExpoModules = { requireNativeModule<T>(name: string): T };
const native = (): HyperHealthNative =>
  (loaded ??= (require('expo') as ExpoModules).requireNativeModule<HyperHealthNative>('HyperHealth'));

/**
 * Apple Health body weight, the same calls as the Capacitor app's HyperHealth
 * plugin (ios/App/App/HyperHealthPlugin.swift), so the shared
 * src/lib/healthWeights sync runs unchanged.
 */
export const HyperHealth = {
  requestBodyMeasurementAccess: () => native().requestBodyMeasurementAccess(),
  readWeightSamples: (options: { since?: string; limit?: number }) => native().readWeightSamples(options),
  enableWeightUpdates: () => native().enableWeightUpdates(),
  addListener: async (eventName: 'weightSamplesChanged', listener: () => void) => {
    const subscription = native().addListener(eventName, listener);
    return { remove: async () => subscription.remove() };
  },
};
