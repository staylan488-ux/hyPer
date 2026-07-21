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
    linkSegmentsToSession: (segmentIds: string[], sessionId: string) => Promise<void>;
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

const DAY_MS = 24 * 60 * 60 * 1000;

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

  // 4) apply: creates, updates, relinks, deletes
  for (const create of plan.creates) {
    const session = await ports.data.createSession(create.session);
    if (session && create.segmentIds.length > 0) {
      await ports.data.linkSegmentsToSession(create.segmentIds, session.id);
    }
  }
  for (const update of plan.updates) {
    await ports.data.updateSession(update.sessionId, update.patch);
    if (update.segmentIds.length > 0) {
      await ports.data.linkSegmentsToSession(update.segmentIds, update.sessionId);
    }
  }
  for (const relink of plan.relinks) {
    await ports.data.linkSegmentsToSession(relink.segmentIds, relink.sessionId);
  }
  for (const sessionId of plan.deletes) {
    await ports.data.deleteSession(sessionId);
  }

  return {
    fetched: records.length,
    created: plan.creates.length,
    updated: plan.updates.length,
    deleted: plan.deletes.length,
    skippedUserEdited: plan.skippedUserEdited,
  };
}
