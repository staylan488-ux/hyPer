import { NativeHealth, isNativeIOS } from '@/lib/nativeBridge';
import {
  buildManualWeightMeasurement,
  normalizeNativeWeightSample,
  setHealthWeightSyncEnabled,
  type BodyWeightMeasurement,
} from '@/lib/healthWeightCore';
import { supabase } from '@/lib/supabase';

export {
  HEALTH_WEIGHT_SYNC_ENABLED_KEY,
  buildManualWeightMeasurement,
  isHealthWeightSyncEnabled,
  isPlausibleBodyWeightKg,
  normalizeNativeWeightSample,
  setHealthWeightSyncEnabled,
  type BodyWeightMeasurement,
  type BodyWeightSource,
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

/**
 * Weigh-ins from the last `days` calendar days. getBodyWeightHistory limits by
 * ROWS, so several weigh-ins in one day eat its window — the trend estimator
 * needs a date range instead.
 */
export async function getBodyWeightHistorySince(
  userId: string,
  days: number,
  now: Date = new Date(),
): Promise<BodyWeightMeasurement[]> {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
  const { data, error } = await supabase
    .from('body_weight_measurements')
    .select('*')
    .eq('user_id', userId)
    .gte('measured_at', since)
    .order('measured_at', { ascending: false });
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

/** Record a weigh-in the user typed. Works on web as well as native. */
export async function recordManualBodyWeight(
  userId: string,
  kilograms: number,
  measuredAt: Date = new Date(),
): Promise<BodyWeightMeasurement> {
  const row = buildManualWeightMeasurement(userId, kilograms, measuredAt);
  if (!row) throw new Error('That weight does not look right. Enter a value between 0 and 500 kg.');

  const { data, error } = await supabase
    .from('body_weight_measurements')
    .upsert(row, { onConflict: 'user_id,source,external_id' })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as BodyWeightMeasurement;
}

/** The native reader returns at most this many samples, oldest first. */
const HEALTH_WEIGHT_PAGE_SIZE = 500;
/** Catch-up bound per sync (10,000 samples); a later trigger continues from the cursor. */
const HEALTH_WEIGHT_MAX_PASSES = 20;

/** Only move the cursor forward, so an overlapping slower sync cannot rewind it. */
function advanceCursor(userId: string, candidate: string): void {
  const stored = localStorage.getItem(cursorKey(userId));
  const storedTime = stored ? Date.parse(stored) : Number.NaN;
  if (Number.isFinite(storedTime) && Date.parse(candidate) <= storedTime) return;
  localStorage.setItem(cursorKey(userId), candidate);
}

export async function syncNativeBodyWeights(userId: string): Promise<HealthWeightSyncResult> {
  if (!isNativeIOS()) return { imported: 0, latest: await getLatestBodyWeight(userId) };

  const previousCursor = localStorage.getItem(cursorKey(userId));
  let since = previousCursor
    ? new Date(Math.max(0, Date.parse(previousCursor) - 24 * 60 * 60 * 1_000)).toISOString()
    : undefined;
  const importedIds = new Set<string>();
  let previousNewest: number | undefined;

  // Samples come back oldest first, so a large backlog is read page by page.
  // Pages overlap at their boundary second; the upsert absorbs the repeat.
  for (let pass = 0; pass < HEALTH_WEIGHT_MAX_PASSES; pass++) {
    const { samples } = await NativeHealth.readWeightSamples({ since, limit: HEALTH_WEIGHT_PAGE_SIZE });
    const rows = samples
      .map((sample) => normalizeNativeWeightSample(userId, sample))
      .filter((sample): sample is NonNullable<typeof sample> => sample != null);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('body_weight_measurements')
        .upsert(rows, { onConflict: 'user_id,source,external_id' });
      if (error) throw new Error(error.message);

      rows.forEach((row) => importedIds.add(row.external_id));
      const latestTimestamp = rows.reduce(
        (latest, row) => row.measured_at > latest ? row.measured_at : latest,
        rows[0].measured_at,
      );
      advanceCursor(userId, latestTimestamp);
    }

    // A short raw page is the end of the backlog (normalization may drop rows
    // from a full page, so the raw count decides).
    if (samples.length < HEALTH_WEIGHT_PAGE_SIZE) break;
    const newest = samples.reduce((latest, sample) => {
      const time = Date.parse(sample.measuredAt);
      return Number.isFinite(time) && time > latest ? time : latest;
    }, Number.NEGATIVE_INFINITY);
    // Stop when a page cannot move forward, e.g. 500+ samples in one second.
    if (!Number.isFinite(newest) || (previousNewest !== undefined && newest <= previousNewest)) break;
    previousNewest = newest;
    since = new Date(newest).toISOString();
  }

  return { imported: importedIds.size, latest: await getLatestBodyWeight(userId) };
}

export async function enableNativeBodyWeightSync(userId: string): Promise<HealthWeightSyncResult> {
  if (!isNativeIOS()) throw new Error('Apple Health is only available in the iPhone app.');
  const access = await NativeHealth.requestBodyMeasurementAccess();
  if (!access.available) throw new Error('Apple Health is unavailable on this device.');
  await NativeHealth.enableWeightUpdates();
  setHealthWeightSyncEnabled(true);
  return syncNativeBodyWeights(userId);
}
