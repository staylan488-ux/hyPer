import type { NativeWeightSample } from '@/lib/nativeBridge';

export const HEALTH_WEIGHT_SYNC_ENABLED_KEY = 'hyper:health-weight-sync-enabled';

export interface BodyWeightMeasurement {
  id: string;
  user_id: string;
  source: 'apple_health';
  external_id: string;
  measured_at: string;
  kilograms: number;
  source_bundle: string;
  source_name: string;
  created_at?: string;
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
  if (
    !sample.id
    || !Number.isFinite(kilograms)
    || kilograms <= 0
    || kilograms >= 500
    || !Number.isFinite(measuredAtMs)
  ) {
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

