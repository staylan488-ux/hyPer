// WHOOP sync orchestrator: pull raw workout records through an injected
// transport, upsert them as activity segments, then reconcile calendar
// sessions with the grouping engine. Ports are injected so the identical
// pipeline runs against the fixture transport in /preview, a fake in unit
// tests, and the whoop-sync Edge Function in production.
import { groupSegments, normalizeWhoopWorkout, type WhoopWorkoutRecord } from '@/lib/whoopImport';
import type {
  ActivitySegment,
  ActivitySegmentInput,
  ActivitySession,
  ActivitySessionInput,
} from '@/types';

export interface WhoopFetchBatchParams {
  start: string;
  end: string;
  nextToken?: string | null;
}

export interface WhoopFetchBatchResult {
  records: WhoopWorkoutRecord[];
  nextToken?: string | null;
}

export interface WhoopSyncPorts {
  fetchBatch: (params: WhoopFetchBatchParams) => Promise<WhoopFetchBatchResult>;
  data: {
    upsertSegments: (inputs: ActivitySegmentInput[]) => Promise<ActivitySegment[]>;
    // window reads must INCLUDE dismissed/user-edited sessions so tombstones
    // hold, and ALL sources so whoop metrics can enrich GPS/manual hosts and
    // any legacy imported activity
    fetchWhoopSegmentsInWindow: (fromIso: string, toIso: string) => Promise<ActivitySegment[]>;
    fetchSessionsInWindow: (fromIso: string, toIso: string) => Promise<ActivitySession[]>;
    // fetch specific sessions by id — pulls host sessions that started before
    // the window but own segments inside it (a workout straddling fetchStart)
    fetchSessionsByIds: (ids: string[]) => Promise<ActivitySession[]>;
    createSession: (input: ActivitySessionInput) => Promise<ActivitySession | null>;
    updateSession: (sessionId: string, patch: Partial<ActivitySessionInput>) => Promise<ActivitySession | null>;
    deleteSession: (sessionId: string) => Promise<void>;
    // false = the link write failed (logged by the port); the item is left out
    // of the result counts and the next sync repairs it
    linkSegmentsToSession: (segmentIds: string[], sessionId: string) => Promise<boolean | void>;
  };
  now?: () => Date;
}

export interface WhoopSyncResult {
  fetched: number;
  created: number;
  updated: number;
  deleted: number;
  skippedUserEdited: number;
}

// re-read window reaches back past the fetch start so late/edited WHOOP records
// and previously imported laps reconcile into the same sessions
export const SYNC_OVERLAP_DAYS = 7;
// first sync (no prior watermark) looks back this far
export const SYNC_DEFAULT_LOOKBACK_DAYS = 30;
// safety cap; WHOOP pages are capped at 25 records
export const SYNC_PAGE_CAP = 10;
// writes in flight at once within one apply phase
export const SYNC_APPLY_CONCURRENCY = 4;

const DAY_MS = 24 * 60 * 60 * 1000;

// Runs fn over items with at most `limit` in flight. After a failure no new
// item starts, and the rejection is raised only once in-flight items settle,
// so nothing keeps writing after the sync has reported failure.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (errors.length === 0 && next < items.length) {
      const index = next++;
      try {
        results[index] = await fn(items[index]);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (errors.length > 0) throw errors[0];
  return results;
}

export async function runWhoopSync(
  ports: WhoopSyncPorts,
  opts: { sinceIso?: string | null } = {},
): Promise<WhoopSyncResult> {
  const now = ports.now ? ports.now() : new Date();
  const sinceMs = opts.sinceIso ? Date.parse(opts.sinceIso) : NaN;
  const fetchStartMs = Number.isNaN(sinceMs)
    ? now.getTime() - SYNC_DEFAULT_LOOKBACK_DAYS * DAY_MS
    : sinceMs - SYNC_OVERLAP_DAYS * DAY_MS;
  const fetchStart = new Date(fetchStartMs).toISOString();
  const fetchEnd = now.toISOString();

  // 1) pull raw records (paginated)
  const records: WhoopWorkoutRecord[] = [];
  let nextToken: string | null | undefined;
  for (let page = 0; page < SYNC_PAGE_CAP; page++) {
    const batch = await ports.fetchBatch({ start: fetchStart, end: fetchEnd, nextToken });
    records.push(...batch.records);
    nextToken = batch.nextToken;
    if (!nextToken) break;
  }

  // 2) idempotent segment upsert
  if (records.length > 0) {
    await ports.data.upsertSegments(records.map(normalizeWhoopWorkout));
  }

  // 3) read back the reconciliation window and build the grouping plan
  const [segments, windowSessions] = await Promise.all([
    ports.data.fetchWhoopSegmentsInWindow(fetchStart, fetchEnd),
    ports.data.fetchSessionsInWindow(fetchStart, fetchEnd),
  ]);

  // A host session that started BEFORE the window can still own segments inside
  // it (a workout straddling fetchStart). Pull those hosts by id so grouping
  // sees them — otherwise their in-window segments look orphaned and get
  // relinked to a duplicate new session, stealing them from the real owner.
  const windowSessionIds = new Set(windowSessions.map((session) => session.id));
  const straddlingIds = [...new Set(
    segments
      .map((segment) => segment.session_id)
      .filter((id): id is string => id != null && !windowSessionIds.has(id)),
  )];
  const straddlingSessions = straddlingIds.length > 0
    ? await ports.data.fetchSessionsByIds(straddlingIds)
    : [];
  const sessions = [...windowSessions, ...straddlingSessions];

  const plan = groupSegments(segments, sessions);

  // 4) apply: creates, updates, relinks, deletes. Phases stay strictly in this
  // order (deletes last: segment links are ON DELETE SET NULL); only items
  // within one phase run in parallel. groupSegments' clusters are disjoint, so
  // concurrent items never share a segment, and only relinks (plain segment
  // re-points) can share a target session. Counts come from writes that
  // actually landed, not from the plan.
  const created = await mapLimit(plan.creates, SYNC_APPLY_CONCURRENCY, async (create) => {
    const session = await ports.data.createSession(create.session);
    if (!session) return false;
    if (create.segmentIds.length === 0) return true;
    return (await ports.data.linkSegmentsToSession(create.segmentIds, session.id)) !== false;
  });
  const updated = await mapLimit(plan.updates, SYNC_APPLY_CONCURRENCY, async (update) => {
    const session = await ports.data.updateSession(update.sessionId, update.patch);
    const linked = update.segmentIds.length === 0
      || (await ports.data.linkSegmentsToSession(update.segmentIds, update.sessionId)) !== false;
    return session != null && linked;
  });
  await mapLimit(plan.relinks, SYNC_APPLY_CONCURRENCY, (relink) =>
    ports.data.linkSegmentsToSession(relink.segmentIds, relink.sessionId));
  // Nothing ever deletes activity_segments, so an empty segment window beside
  // auto-grouped WHOOP sessions can only mean a failed or empty read, never a
  // real WHOOP change. Deleting on that evidence would drop real activities.
  const deletes = segments.length > 0 ? plan.deletes : [];
  await mapLimit(deletes, SYNC_APPLY_CONCURRENCY, (sessionId) => ports.data.deleteSession(sessionId));

  return {
    fetched: records.length,
    created: created.filter(Boolean).length,
    updated: updated.filter(Boolean).length,
    deleted: deletes.length,
    skippedUserEdited: plan.skippedUserEdited,
  };
}
