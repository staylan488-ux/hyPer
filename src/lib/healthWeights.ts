import { NativeHealth, hasNativeHealth } from '@/lib/nativeBridge';
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

/** Where getBodyWeightHistorySince's window starts: `days` days before `now`, as an ISO time. */
export function bodyWeightWindowStart(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1_000).toISOString();
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
  const since = bodyWeightWindowStart(days, now);
  const { data, error } = await supabase
    .from('body_weight_measurements')
    .select('*')
    .eq('user_id', userId)
    .gte('measured_at', since)
    .order('measured_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as BodyWeightMeasurement[];
}

/** Rows per request when reading every weigh-in: the API's own cap. */
export const BODY_WEIGHT_PAGE_SIZE = 1_000;
// Years of several-a-day Apple Health readings still fit; a runaway loop doesn't.
const BODY_WEIGHT_MAX_PAGES = 100;

/**
 * Every weigh-in, newest first, read a page at a time because one request
 * returns at most BODY_WEIGHT_PAGE_SIZE rows. Each page after the first
 * starts at the last time read (not at a row count), so a weigh-in deleted
 * or added mid-read can't shift an untouched one past the next page. That
 * time's rows are read again and kept once; a page holding nothing but that
 * time steps past it (only more weigh-ins in one instant than a page holds
 * could lose one).
 */
export async function getAllBodyWeights(userId: string, pageSize = BODY_WEIGHT_PAGE_SIZE): Promise<BodyWeightMeasurement[]> {
  const rows: BodyWeightMeasurement[] = [];
  const seen = new Set<string>();
  // Where the next page starts: at this time, or just before it.
  let fromTime: string | null = null;
  let pastTime = false;
  for (let page = 0; page < BODY_WEIGHT_MAX_PAGES; page++) {
    let query = supabase
      .from('body_weight_measurements')
      .select('*')
      .eq('user_id', userId);
    if (fromTime !== null) query = pastTime ? query.lt('measured_at', fromTime) : query.lte('measured_at', fromTime);
    const { data, error } = await query
      .order('measured_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(pageSize);
    if (error) throw new Error(error.message);
    const read = (data || []) as BodyWeightMeasurement[];
    for (const row of read) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      rows.push(row);
    }
    if (read.length < pageSize) break;
    const last = read[read.length - 1].measured_at;
    pastTime = last === fromTime;
    fromTime = last;
  }
  return rows;
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

/**
 * Removes a weigh-in the person typed. Apple Health readings are left alone:
 * they belong to Health, and a later sync could bring them back.
 */
export async function deleteManualBodyWeight(userId: string, measurementId: string): Promise<void> {
  const { error } = await supabase
    .from('body_weight_measurements')
    .delete()
    .eq('id', measurementId)
    .eq('user_id', userId)
    .eq('source', 'manual');
  if (error) throw new Error(error.message);
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

/** Stop before the next native read or upload; an upload already sent may still finish. */
function checkSyncCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Apple Health sync stopped.', 'AbortError');
}

export async function syncNativeBodyWeights(userId: string, signal?: AbortSignal): Promise<HealthWeightSyncResult> {
  checkSyncCancelled(signal);
  if (!hasNativeHealth()) return { imported: 0, latest: await getLatestBodyWeight(userId) };

  const previousCursor = localStorage.getItem(cursorKey(userId));
  let since = previousCursor
    ? new Date(Math.max(0, Date.parse(previousCursor) - 24 * 60 * 60 * 1_000)).toISOString()
    : undefined;
  const importedIds = new Set<string>();
  let previousNewest: number | undefined;

  // Samples come back oldest first, so a large backlog is read page by page.
  // Pages overlap at their boundary second; the upsert absorbs the repeat.
  for (let pass = 0; pass < HEALTH_WEIGHT_MAX_PASSES; pass++) {
    checkSyncCancelled(signal);
    const { samples } = await NativeHealth.readWeightSamples({ since, limit: HEALTH_WEIGHT_PAGE_SIZE });
    checkSyncCancelled(signal);
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

    // A successful upload owns its cursor even if Stop was tapped while it
    // was in flight. A later sync can safely pick up the remaining pages.
    checkSyncCancelled(signal);

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

  checkSyncCancelled(signal);
  return { imported: importedIds.size, latest: await getLatestBodyWeight(userId) };
}

export async function enableNativeBodyWeightSync(userId: string): Promise<HealthWeightSyncResult> {
  if (!hasNativeHealth()) throw new Error('Apple Health is only available in the iPhone app.');
  const access = await NativeHealth.requestBodyMeasurementAccess();
  if (!access.available) throw new Error('Apple Health is unavailable on this device.');
  await NativeHealth.enableWeightUpdates();
  setHealthWeightSyncEnabled(true);
  return syncNativeBodyWeights(userId);
}

/**
 * You's Apple Health button: the first tap asks for access and turns on
 * automatic sync; later taps sync now.
 */
export function connectOrSyncHealthWeights(userId: string, enabled: boolean): Promise<HealthWeightSyncResult> {
  return enabled ? syncNativeBodyWeights(userId) : enableNativeBodyWeightSync(userId);
}

export function healthSyncMessage(result: HealthWeightSyncResult): string {
  return result.imported > 0
    ? `Imported ${result.imported} Apple Health weight entr${result.imported === 1 ? 'y' : 'ies'}.`
    : 'Apple Health weight is up to date.';
}

export const HEALTH_SYNC_STOPPED_MESSAGE = 'Automatic weight sync stopped. Existing measurements were kept.';
