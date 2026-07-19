// WHOOP import engine: normalizes raw WHOOP v2 workout records into activity
// segments and groups segments into calendar sessions. Pure module — no
// Supabase, no React — so the exact production pipeline runs against fixtures
// in the /preview sandbox and in unit tests.
//
// Grouping intent: WHOOP records one workout per hard effort, so an interval
// session of 8 fast laps arrives as 8 separate records. Consecutive short
// running records with small gaps are clustered into ONE hyPer split session;
// everything else maps 1:1.
import { aggregateSegments } from '@/lib/activityMetrics';
import type {
  ActivitySegment,
  ActivitySegmentInput,
  ActivitySession,
  ActivitySessionInput,
  ActivityType,
} from '@/types';

/* ── WHOOP v2 payload (subset consumed) ── */

export interface WhoopWorkoutScore {
  strain?: number | null;
  average_heart_rate?: number | null;
  max_heart_rate?: number | null;
  kilojoule?: number | null;
  distance_meter?: number | null;
}

export interface WhoopWorkoutRecord {
  id: string;
  sport_name?: string | null;
  start: string;
  end: string;
  timezone_offset?: string | null;
  score_state?: 'SCORED' | 'PENDING_SCORE' | 'UNSCORABLE' | string | null;
  score?: WhoopWorkoutScore | null;
}

/* ── Tunable grouping constants (exported for field tuning + tests) ── */

// consecutive running records merge into one session when the rest gap between
// them is at most this long
export const LAP_MERGE_GAP_S = 360;
// records longer than this are real runs, never treated as laps of a session
export const LAP_MAX_DURATION_S = 900;
export const KJ_TO_KCAL = 0.239006;

/* ── Sport mapping ── */

const WHOOP_SPORT_TO_ACTIVITY: Record<string, ActivityType> = {
  running: 'run',
  trail_running: 'run',
  track_and_field: 'run',
  cycling: 'bike_ride',
  mountain_biking: 'bike_ride',
  spin: 'bike_ride',
  swimming: 'swimming',
  rock_climbing: 'climbing',
  climbing: 'climbing',
  bouldering: 'climbing',
  tennis: 'tennis',
  pickleball: 'pickleball',
  squash: 'squash',
  golf: 'golf',
};

export function mapWhoopSport(sportName?: string | null): ActivityType {
  if (!sportName) return 'other';
  const key = sportName.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return WHOOP_SPORT_TO_ACTIVITY[key] ?? 'other';
}

/* ── Normalization ── */

function parseOffsetMinutes(offset?: string | null): number {
  if (!offset) return 0;
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset.trim());
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// calendar date at the workout's OWN utc offset — a 23:30 run in -07:00 must
// land on the runner's local date, not the browser's
export function whoopLocalDateKey(startIso: string, timezoneOffset?: string | null): string {
  const startMs = Date.parse(startIso);
  if (Number.isNaN(startMs)) return '';

  const shifted = new Date(startMs + parseOffsetMinutes(timezoneOffset) * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// PENDING_SCORE records import without metrics; the idempotent upsert-by-
// external_id back-fills them once WHOOP finishes scoring
export function normalizeWhoopWorkout(record: WhoopWorkoutRecord): ActivitySegmentInput {
  const startMs = Date.parse(record.start);
  const endMs = Date.parse(record.end);
  const durationSeconds =
    Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs
      ? null
      : Math.round((endMs - startMs) / 1000);
  const score = record.score_state === 'SCORED' ? record.score : null;

  return {
    source: 'whoop',
    external_id: record.id,
    sport: record.sport_name ?? null,
    started_at: record.start,
    ended_at: record.end,
    duration_seconds: durationSeconds,
    strain: score?.strain ?? null,
    avg_hr: score?.average_heart_rate ?? null,
    max_hr: score?.max_heart_rate ?? null,
    energy_kcal: score?.kilojoule != null ? Math.round(score.kilojoule * KJ_TO_KCAL * 10) / 10 : null,
    distance_m: score?.distance_meter ?? null,
    raw: record as unknown as Record<string, unknown>,
  };
}

export function getSegmentTimezoneOffset(segment: Pick<ActivitySegment, 'raw'>): string | null {
  const offset = segment.raw?.timezone_offset;
  return typeof offset === 'string' ? offset : null;
}

/* ── Grouping ── */

export interface GroupingPlan {
  creates: Array<{ session: ActivitySessionInput; segmentIds: string[] }>;
  updates: Array<{ sessionId: string; patch: Partial<ActivitySessionInput>; segmentIds: string[] }>;
  // segments pointed at a user_edited or dismissed session: relink only, never patch
  relinks: Array<{ sessionId: string; segmentIds: string[] }>;
  // orphaned auto-grouped sessions no cluster claims anymore
  deletes: string[];
  skippedUserEdited: number;
}

function segmentDuration(segment: ActivitySegment): number {
  if (segment.duration_seconds != null) return segment.duration_seconds;
  const ms = Date.parse(segment.ended_at) - Date.parse(segment.started_at);
  return Number.isNaN(ms) ? 0 : Math.max(0, Math.round(ms / 1000));
}

function isLapLike(segment: ActivitySegment): boolean {
  return mapWhoopSport(segment.sport) === 'run' && segmentDuration(segment) <= LAP_MAX_DURATION_S;
}

function clusterSegments(segments: ActivitySegment[]): ActivitySegment[][] {
  const sorted = [...segments].sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const clusters: ActivitySegment[][] = [];

  for (const segment of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && isLapLike(segment) && isLapLike(current[current.length - 1])) {
      const prev = current[current.length - 1];
      const gapS = (Date.parse(segment.started_at) - Date.parse(prev.ended_at)) / 1000;
      if (gapS >= 0 && gapS <= LAP_MERGE_GAP_S) {
        current.push(segment);
        continue;
      }
    }
    clusters.push([segment]);
  }

  return clusters;
}

function classifyCluster(cluster: ActivitySegment[]): ActivityType {
  if (cluster.length === 1) return mapWhoopSport(cluster[0].sport);
  return 'interval_run';
}

function buildSessionDraft(cluster: ActivitySegment[]): ActivitySessionInput {
  const aggregates = aggregateSegments(cluster);
  const first = cluster[0];
  const last = cluster[cluster.length - 1];

  return {
    activity_type: classifyCluster(cluster),
    title: null,
    date: whoopLocalDateKey(first.started_at, getSegmentTimezoneOffset(first)),
    started_at: first.started_at,
    ended_at: last.ended_at,
    duration_seconds: aggregates.duration_seconds,
    source: 'whoop',
    strain: aggregates.strain,
    avg_hr: aggregates.avg_hr,
    max_hr: aggregates.max_hr,
    energy_kcal: aggregates.energy_kcal,
    distance_m: aggregates.distance_m,
    auto_grouped: true,
  };
}

function timestampsEqual(a?: string | null, b?: string | null): boolean {
  if (a == null || b == null) return a == null && b == null;
  return Date.parse(a) === Date.parse(b);
}

function sessionMatchesDraft(session: ActivitySession, draft: ActivitySessionInput): boolean {
  return (
    session.activity_type === draft.activity_type &&
    session.date === draft.date &&
    timestampsEqual(session.started_at, draft.started_at) &&
    timestampsEqual(session.ended_at, draft.ended_at) &&
    session.duration_seconds === (draft.duration_seconds ?? null) &&
    session.strain === (draft.strain ?? null) &&
    session.avg_hr === (draft.avg_hr ?? null) &&
    session.max_hr === (draft.max_hr ?? null) &&
    session.energy_kcal === (draft.energy_kcal ?? null) &&
    session.distance_m === (draft.distance_m ?? null)
  );
}

/* ── Cross-source merge: WHOOP metrics onto runs recorded elsewhere ── */

// a WHOOP workout and a GPS/manual or legacy-imported session are the same event
// when their time ranges overlap by at least this share of the shorter one
export const OVERLAP_MERGE_RATIO = 0.6;

export function overlapRatioOfShorter(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): number {
  const overlap = Math.min(aEndMs, bEndMs) - Math.max(aStartMs, bStartMs);
  const shorter = Math.min(aEndMs - aStartMs, bEndMs - bStartMs);
  if (overlap <= 0 || shorter <= 0) return 0;
  return overlap / shorter;
}

function sessionWindow(session: ActivitySession): { startMs: number; endMs: number } | null {
  if (!session.started_at || !session.ended_at) return null;
  const startMs = Date.parse(session.started_at);
  const endMs = Date.parse(session.ended_at);
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) return null;
  return { startMs, endMs };
}

// best time-overlapping non-whoop session a whoop cluster should enrich
// instead of duplicating (the user's own recording is the primary event)
function findEnrichmentHost(
  cluster: ActivitySegment[],
  sessions: ActivitySession[],
  claimed: Set<string>,
): ActivitySession | null {
  const clusterStart = Date.parse(cluster[0].started_at);
  const clusterEnd = Date.parse(cluster[cluster.length - 1].ended_at);
  if (Number.isNaN(clusterStart) || Number.isNaN(clusterEnd)) return null;

  let best: ActivitySession | null = null;
  let bestRatio = 0;
  for (const session of sessions) {
    if (session.source === 'whoop' || session.dismissed_at || claimed.has(session.id)) continue;
    const window = sessionWindow(session);
    if (!window) continue;
    const ratio = overlapRatioOfShorter(clusterStart, clusterEnd, window.startMs, window.endMs);
    if (ratio >= OVERLAP_MERGE_RATIO && ratio > bestRatio) {
      best = session;
      bestRatio = ratio;
    }
  }
  return best;
}

// metrics-only patch for an enrichment host: whoop supplies strain/HR/kcal but
// must never touch the host's type, times, or GPS distance. user-edited hosts
// only get nulls filled, never overwritten
function buildEnrichmentPatch(
  host: ActivitySession,
  draft: ActivitySessionInput,
): Partial<ActivitySessionInput> | null {
  const fillOnly = host.user_edited;
  const patch: Partial<ActivitySessionInput> = {};
  const metricKeys = ['strain', 'avg_hr', 'max_hr', 'energy_kcal'] as const;

  for (const key of metricKeys) {
    const incoming = draft[key] ?? null;
    if (incoming == null) continue;
    if (fillOnly && host[key] != null) continue;
    if (host[key] !== incoming) patch[key] = incoming;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

// after saving a GPS run: the auto-imported WHOOP session for the same
// window (if any) should be absorbed into the new recording
export function findAbsorbableWhoopSession(
  startIso: string,
  endIso: string,
  sessions: ActivitySession[],
): ActivitySession | null {
  const startMs = Date.parse(startIso);
  const endMs = Date.parse(endIso);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;

  let best: ActivitySession | null = null;
  let bestRatio = 0;
  for (const session of sessions) {
    if (session.source !== 'whoop' || !session.auto_grouped || session.user_edited) continue;
    const window = sessionWindow(session);
    if (!window) continue;
    const ratio = overlapRatioOfShorter(startMs, endMs, window.startMs, window.endMs);
    if (ratio >= OVERLAP_MERGE_RATIO && ratio > bestRatio) {
      best = session;
      bestRatio = ratio;
    }
  }
  return best;
}

// membership-based reconciliation: a cluster maps to whichever existing session
// its segments already reference (majority wins), so a late-arriving lap
// updates the same session instead of duplicating it. Clusters with no
// membership try time-overlap enrichment of a non-whoop session before
// creating anything new.
export function groupSegments(
  segments: ActivitySegment[],
  existingSessions: ActivitySession[],
): GroupingPlan {
  const plan: GroupingPlan = { creates: [], updates: [], relinks: [], deletes: [], skippedUserEdited: 0 };
  const whoopSegments = segments.filter((s) => s.source === 'whoop');
  const sessionsById = new Map(existingSessions.map((s) => [s.id, s]));
  const claimedSessionIds = new Set<string>();

  const enrich = (host: ActivitySession, cluster: ActivitySegment[], draft: ActivitySessionInput) => {
    claimedSessionIds.add(host.id);
    const unlinked = cluster.filter((s) => s.session_id !== host.id).map((s) => s.id);
    const patch = buildEnrichmentPatch(host, draft);
    if (patch) {
      plan.updates.push({ sessionId: host.id, patch, segmentIds: unlinked });
    } else if (unlinked.length > 0) {
      plan.relinks.push({ sessionId: host.id, segmentIds: unlinked });
    }
  };

  for (const cluster of clusterSegments(whoopSegments)) {
    // majority vote over the cluster's existing session links
    const votes = new Map<string, number>();
    for (const segment of cluster) {
      if (segment.session_id && sessionsById.has(segment.session_id) && !claimedSessionIds.has(segment.session_id)) {
        votes.set(segment.session_id, (votes.get(segment.session_id) ?? 0) + 1);
      }
    }
    const target = [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const draft = buildSessionDraft(cluster);

    if (!target) {
      const host = findEnrichmentHost(cluster, existingSessions, claimedSessionIds);
      if (host) {
        enrich(host, cluster, draft);
        continue;
      }
      plan.creates.push({ session: draft, segmentIds: cluster.map((s) => s.id) });
      continue;
    }

    claimedSessionIds.add(target);
    const session = sessionsById.get(target)!;
    const unlinked = cluster.filter((s) => s.session_id !== target).map((s) => s.id);

    if (session.user_edited || session.dismissed_at) {
      // tombstone/user edits win: keep segments attached so re-sync never
      // recreates the session, but change nothing about it
      plan.skippedUserEdited += 1;
      if (unlinked.length > 0) plan.relinks.push({ sessionId: target, segmentIds: unlinked });
      continue;
    }

    if (session.source !== 'whoop') {
      // the cluster's segments live inside a GPS/manual or legacy-imported
      // session: metrics-only enrichment, never reshape the host
      claimedSessionIds.delete(session.id); // enrich() re-adds
      enrich(session, cluster, draft);
      continue;
    }

    if (sessionMatchesDraft(session, draft) && unlinked.length === 0) continue;

    plan.updates.push({
      sessionId: target,
      patch: {
        activity_type: draft.activity_type,
        date: draft.date,
        started_at: draft.started_at,
        ended_at: draft.ended_at,
        duration_seconds: draft.duration_seconds,
        strain: draft.strain,
        avg_hr: draft.avg_hr,
        max_hr: draft.max_hr,
        energy_kcal: draft.energy_kcal,
        distance_m: draft.distance_m,
      },
      segmentIds: unlinked,
    });
  }

  // auto-grouped sessions no cluster claims anymore are stale duplicates
  for (const session of existingSessions) {
    if (
      session.source === 'whoop' &&
      session.auto_grouped &&
      !session.user_edited &&
      !session.dismissed_at &&
      !claimedSessionIds.has(session.id)
    ) {
      plan.deletes.push(session.id);
    }
  }

  return plan;
}
