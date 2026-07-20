import { NativeHealth, isNativeIOS } from '@/lib/nativeBridge';
import {
  normalizeNativeWeightSample,
  setHealthWeightSyncEnabled,
  type BodyWeightMeasurement,
} from '@/lib/healthWeightCore';
import { supabase } from '@/lib/supabase';

export {
  HEALTH_WEIGHT_SYNC_ENABLED_KEY,
  isHealthWeightSyncEnabled,
  normalizeNativeWeightSample,
  setHealthWeightSyncEnabled,
  type BodyWeightMeasurement,
} from '@/lib/healthWeightCore';

const HEALTH_WEIGHT_SYNC_CURSOR_PREFIX = 'hyper:health-weight-sync-cursor:';

export interface HealthWeightSyncResult {
  imported: number;
  latest: BodyWeightMeasurement | null;
}

function cursorKey(userId: string): string {
  return `${HEALTH_WEIGHT_SYNC_CURSOR_PREFIX}${userId}`;
}

export async function getBodyWeightHistory(userId: string, limit = 14): Promise<BodyWeightMeasurement[]> {
  const { data, error } = await supabase
    .from('body_weight_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data || []) as BodyWeightMeasurement[];
}

export async function getLatestBodyWeight(userId: string): Promise<BodyWeightMeasurement | null> {
  const { data, error } = await supabase
    .from('body_weight_measurements')
    .select('*')
    .eq('user_id', userId)
    .order('measured_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as BodyWeightMeasurement | null;
}

export async function syncNativeBodyWeights(userId: string): Promise<HealthWeightSyncResult> {
  if (!isNativeIOS()) return { imported: 0, latest: await getLatestBodyWeight(userId) };

  const previousCursor = localStorage.getItem(cursorKey(userId));
  const since = previousCursor
    ? new Date(Math.max(0, Date.parse(previousCursor) - 24 * 60 * 60 * 1_000)).toISOString()
    : undefined;
  const { samples } = await NativeHealth.readWeightSamples({ since, limit: 500 });
  const rows = samples
    .map((sample) => normalizeNativeWeightSample(userId, sample))
    .filter((sample): sample is NonNullable<typeof sample> => sample != null);

  if (rows.length > 0) {
    const { error } = await supabase
      .from('body_weight_measurements')
      .upsert(rows, { onConflict: 'user_id,source,external_id' });
    if (error) throw new Error(error.message);

    const latestTimestamp = rows.reduce(
      (latest, row) => row.measured_at > latest ? row.measured_at : latest,
      rows[0].measured_at,
    );
    localStorage.setItem(cursorKey(userId), latestTimestamp);
  }

  return { imported: rows.length, latest: await getLatestBodyWeight(userId) };
}

export async function enableNativeBodyWeightSync(userId: string): Promise<HealthWeightSyncResult> {
  if (!isNativeIOS()) throw new Error('Apple Health is only available in the iPhone app.');
  const access = await NativeHealth.requestBodyMeasurementAccess();
  if (!access.available) throw new Error('Apple Health is unavailable on this device.');
  await NativeHealth.enableWeightUpdates();
  setHealthWeightSyncEnabled(true);
  return syncNativeBodyWeights(userId);
}
