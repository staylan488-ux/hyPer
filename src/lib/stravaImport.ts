// Strava import engine: normalizes raw Strava activities into activity
// segments and reconciles calendar sessions. Pure module (no Supabase, no
// React) so the identical pipeline runs against fixtures in /preview and in
// unit tests. Unlike WHOOP there is no lap-clustering problem — one Strava
// activity is already one event — so reconciliation is per-activity:
// membership first, otherwise create. WHOOP metrics enrich these sessions via
// the whoop grouping engine's host branch; the reverse (Strava importing a run
// WHOOP already created) is handled by absorption in the sync orchestrator.
import type { GroupingPlan } from '@/lib/whoopImport';
import type {
  ActivitySegment,
  ActivitySegmentInput,
  ActivitySession,
  ActivitySessionInput,
  ActivityType,
} from '@/types';

/* ── Strava payload (subset consumed; SummaryActivity) ── */

export interface StravaActivityRecord {
  id: number | string;
  name?: string | null;
  sport_type?: string | null;
  type?: string | null; // legacy field, fallback when sport_type is absent
  start_date: string; // UTC ISO
  utc_offset?: number | null; // seconds
  elapsed_time: number; // seconds
  moving_time?: number | null; // seconds
  distance?: number | null; // meters
  average_heartrate?: number | null;
  max_heartrate?: number | null;
}

const STRAVA_SPORT_TO_ACTIVITY: Record<string, ActivityType> = {
  run: 'run',
  trailrun: 'run',
  virtualrun: 'run',
  ride: 'bike_ride',
  virtualride: 'bike_ride',
  mountainbikeride: 'bike_ride',
  gravelride: 'bike_ride',
  ebikeride: 'bike_ride',
  swim: 'swimming',
  rockclimbing: 'climbing',
  tennis: 'tennis',
  pickleball: 'pickleball',
  squash: 'squash',
  golf: 'golf',
};

export function mapStravaSport(sportType?: string | null): ActivityType {
  if (!sportType) return 'other';
  const key = sportType.trim().toLowerCase().replace(/[\s_-]+/g, '');
  return STRAVA_SPORT_TO_ACTIVITY[key] ?? 'other';
}

// calendar date at the activity's own utc offset (start_date_local is NOT
// used: Strava serves it with a misleading trailing Z)
export function stravaLocalDateKey(startIso: string, utcOffsetSeconds?: number | null): string {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return '';

  const shifted = new Date(startMs + (utcOffsetSeconds ?? 0) * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function normalizeStravaActivity(record: StravaActivityRecord): ActivitySegmentInput {
  const startMs = Date.parse(record.start_date);
  const endIso = Number.isNaN(startMs)
    ? record.start_date
    : new Date(startMs + Math.max(0, record.elapsed_time) * 1000).toISOString();

  return {
    source: 'strava',
    external_id: String(record.id),
    sport: record.sport_type ?? record.type ?? null,
    started_at: record.start_date,
    ended_at: endIso,
    // moving time is the honest duration; elapsed includes stopped time
    duration_seconds: record.moving_time ?? record.elapsed_time ?? null,
    avg_hr: record.average_heartrate != null ? Math.round(record.average_heartrate) : null,
    max_hr: record.max_heartrate != null ? Math.round(record.max_heartrate) : null,
    distance_m: record.distance ?? null,
    raw: record as unknown as Record<string, unknown>,
  };
}

function buildSessionDraft(segment: ActivitySegment): ActivitySessionInput {
  const record = (segment.raw ?? {}) as Partial<StravaActivityRecord>;
  const title = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : null;

  return {
    activity_type: mapStravaSport(segment.sport),
    title,
    date: stravaLocalDateKey(segment.started_at, typeof record.utc_offset === 'number' ? record.utc_offset : 0),
    started_at: segment.started_at,
    ended_at: segment.ended_at,
    duration_seconds: segment.duration_seconds,
    source: 'strava',
    avg_hr: segment.avg_hr,
    max_hr: segment.max_hr,
    distance_m: segment.distance_m,
    auto_grouped: true,
  };
}

function timestampsEqual(a?: string | null, b?: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Date.parse(a) === Date.parse(b);
}

// core fields the import owns; HR only when Strava actually recorded it, so a
// WHOOP enrichment that filled the gap survives re-imports
function buildStravaPatch(
  session: ActivitySession,
  draft: ActivitySessionInput,
): Partial<ActivitySessionInput> | null {
  const patch: Partial<ActivitySessionInput> = {};

  if (session.activity_type !== draft.activity_type) patch.activity_type = draft.activity_type;
  if (session.date !== draft.date) patch.date = draft.date;
  if (!timestampsEqual(session.started_at, draft.started_at)) patch.started_at = draft.started_at;
  if (!timestampsEqual(session.ended_at, draft.ended_at)) patch.ended_at = draft.ended_at;
  if (session.duration_seconds !== (draft.duration_seconds ?? null)) patch.duration_seconds = draft.duration_seconds;
  if (session.distance_m !== (draft.distance_m ?? null)) patch.distance_m = draft.distance_m;
  if (draft.avg_hr != null && session.avg_hr !== draft.avg_hr) patch.avg_hr = draft.avg_hr;
  if (draft.max_hr != null && session.max_hr !== draft.max_hr) patch.max_hr = draft.max_hr;

  return Object.keys(patch).length > 0 ? patch : null;
}

// per-activity reconciliation into the shared GroupingPlan shape (no orphan
// deletion for strava: activities deleted upstream are left on the calendar)
export function groupStravaSegments(
  segments: ActivitySegment[],
  existingSessions: ActivitySession[],
): GroupingPlan {
  const plan: GroupingPlan = { creates: [], updates: [], relinks: [], deletes: [], skippedUserEdited: 0 };
  const sessionsById = new Map(existingSessions.map((s) => [s.id, s]));

  for (const segment of segments) {
    if (segment.source !== 'strava') continue;
    const draft = buildSessionDraft(segment);

    const session = segment.session_id ? sessionsById.get(segment.session_id) : null;
    if (session) {
      if (session.user_edited || session.dismissed_at) {
        plan.skippedUserEdited += 1;
        continue;
      }
      const patch = buildStravaPatch(session, draft);
      if (patch) plan.updates.push({ sessionId: session.id, patch, segmentIds: [] });
      continue;
    }

    plan.creates.push({ session: draft, segmentIds: [segment.id] });
  }

  return plan;
}
