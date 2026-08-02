import type { NativeWeightSample } from '@/lib/nativeBridge';

export const HEALTH_WEIGHT_SYNC_ENABLED_KEY = 'hyper:health-weight-sync-enabled';

export type BodyWeightSource = 'apple_health' | 'manual';

export interface BodyWeightMeasurement {
  id: string;
  user_id: string;
  source: BodyWeightSource;
  external_id: string;
  measured_at: string;
  kilograms: number;
  source_bundle: string;
  source_name: string;
  created_at?: string;
}

export function isPlausibleBodyWeightKg(kilograms: number): boolean {
  return Number.isFinite(kilograms) && kilograms > 0 && kilograms < 500;
}

export function isHealthWeightSyncEnabled(storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  return storage.getItem(HEALTH_WEIGHT_SYNC_ENABLED_KEY) === '1';
}

export function setHealthWeightSyncEnabled(
  enabled: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
): void {
  if (enabled) storage.setItem(HEALTH_WEIGHT_SYNC_ENABLED_KEY, '1');
  else storage.removeItem(HEALTH_WEIGHT_SYNC_ENABLED_KEY);
}

export function normalizeNativeWeightSample(
  userId: string,
  sample: NativeWeightSample,
): Omit<BodyWeightMeasurement, 'id' | 'created_at'> | null {
  const kilograms = Number(sample.kilograms);
  const measuredAtMs = Date.parse(sample.measuredAt);
  if (!sample.id || !isPlausibleBodyWeightKg(kilograms) || !Number.isFinite(measuredAtMs)) {
    return null;
  }
  return {
    user_id: userId,
    source: 'apple_health',
    external_id: sample.id,
    measured_at: new Date(measuredAtMs).toISOString(),
    kilograms,
    source_bundle: sample.sourceBundle || 'unknown',
    source_name: sample.sourceName || 'Apple Health',
  };
}

/**
 * A weigh-in the user typed. The external id is the measurement minute, so
 * re-submitting the same entry is idempotent while a later one is a new row.
 */
export function buildManualWeightMeasurement(
  userId: string,
  kilograms: number,
  measuredAt: Date = new Date(),
): Omit<BodyWeightMeasurement, 'id' | 'created_at'> | null {
  const measuredAtMs = measuredAt.getTime();
  if (!isPlausibleBodyWeightKg(kilograms) || !Number.isFinite(measuredAtMs)) return null;

  const isoMinute = new Date(measuredAtMs).toISOString().slice(0, 16);
  return {
    user_id: userId,
    source: 'manual',
    external_id: `manual:${isoMinute}`,
    measured_at: new Date(measuredAtMs).toISOString(),
    kilograms,
    source_bundle: 'manual',
    source_name: 'Manual entry',
  };
}

