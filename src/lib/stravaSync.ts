// Strava sync orchestrator, mirroring whoopSync: injected transport + data
// ports so the identical pipeline runs against fixtures in /preview, fakes in
// tests, and the strava-sync Edge Function in production. After creating a
// session it checks for an auto-imported WHOOP session covering the same time
// window and absorbs it — segments relink, metrics fill, duplicate disappears.
import { groupStravaSegments, normalizeStravaActivity, type StravaActivityRecord } from '@/lib/stravaImport';
import { findAbsorbableWhoopSession } from '@/lib/whoopImport';
import type {
  ActivitySegment,
  ActivitySegmentInput,
  ActivitySession,
  ActivitySessionInput,
} from '@/types';

export interface StravaFetchBatchParams {
  start: string;
  end: string;
  page: number;
}

export interface StravaFetchBatchResult {
  records: StravaActivityRecord[];
  nextPage?: number | null;
}

export interface StravaSyncPorts {
  fetchBatch: (params: StravaFetchBatchParams) => Promise<StravaFetchBatchResult>;
  data: {
    upsertSegments: (inputs: ActivitySegmentInput[]) => Promise<ActivitySegment[]>;
    fetchStravaSegmentsInWindow: (fromIso: string, toIso: string) => Promise<ActivitySegment[]>;
    // ALL sources, including dismissed/user-edited (tombstones + absorption)
    fetchSessionsInWindow: (fromIso: string, toIso: string) => Promise<ActivitySession[]>;
    createSession: (input: ActivitySessionInput) => Promise<ActivitySession | null>;
    updateSession: (sessionId: string, patch: Partial<ActivitySessionInput>) => Promise<ActivitySession | null>;
    deleteSession: (sessionId: string) => Promise<void>;
    linkSegmentsToSession: (segmentIds: string[], sessionId: string) => Promise<void>;
    // re-point every segment of one session at another (whoop absorption)
    relinkSessionSegments: (fromSessionId: string, toSessionId: string) => Promise<void>;
  };
  now?: () => Date;
}

export interface StravaSyncResult {
  fetched: number;
  created: number;
  updated: number;
  absorbed: number;
  skippedUserEdited: number;
}

export const STRAVA_SYNC_OVERLAP_DAYS = 7;
export const STRAVA_SYNC_DEFAULT_LOOKBACK_DAYS = 30;
export const STRAVA_SYNC_PAGE_CAP = 10;

const DAY_MS = 24 * 60 * 60 * 1000;

// fill-only metric copy: the absorbed whoop session supplies whatever the
// strava recording lacks (typically strain + kcal, HR when phone-recorded)
function absorptionPatch(
  host: ActivitySession,
  absorbed: ActivitySession,
): Partial<ActivitySessionInput> | null {
  const patch: Partial<ActivitySessionInput> = {};
  const keys = ['strain', 'avg_hr', 'max_hr', 'energy_kcal'] as const;
  for (const key of keys) {
    if (host[key] == null && absorbed[key] != null) patch[key] = absorbed[key];
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function runStravaSync(
  ports: StravaSyncPorts,
  opts: { sinceIso?: string | null } = {},
): Promise<StravaSyncResult> {
  const now = ports.now ? ports.now() : new Date();
  const sinceMs = opts.sinceIso ? Date.parse(opts.sinceIso) : NaN;
  const fetchStartMs = Number.isNaN(sinceMs)
    ? now.getTime() - STRAVA_SYNC_DEFAULT_LOOKBACK_DAYS * DAY_MS
    : sinceMs - STRAVA_SYNC_OVERLAP_DAYS * DAY_MS;
  const fetchStart = new Date(fetchStartMs).toISOString();
  const fetchEnd = now.toISOString();

  // 1) pull raw activities (page-numbered pagination)
  const records: StravaActivityRecord[] = [];
  let page: number | null = 1;
  for (let i = 0; i < STRAVA_SYNC_PAGE_CAP && page != null; i++) {
    const batch = await ports.fetchBatch({ start: fetchStart, end: fetchEnd, page });
    records.push(...batch.records);
    page = batch.nextPage ?? null;
  }

  // 2) idempotent segment upsert
  if (records.length > 0) {
    await ports.data.upsertSegments(records.map(normalizeStravaActivity));
  }

  // 3) read back and reconcile
  const [segments, sessions] = await Promise.all([
    ports.data.fetchStravaSegmentsInWindow(fetchStart, fetchEnd),
    ports.data.fetchSessionsInWindow(fetchStart, fetchEnd),
  ]);
  const plan = groupStravaSegments(segments, sessions);

  // 4) apply
  let absorbed = 0;
  for (const create of plan.creates) {
    const session = await ports.data.createSession(create.session);
    if (!session) continue;
    if (create.segmentIds.length > 0) {
      await ports.data.linkSegmentsToSession(create.segmentIds, session.id);
    }

    // WHOOP already imported this same effort? absorb its event into the
    // Strava recording so the calendar keeps exactly one
    if (session.started_at && session.ended_at) {
      const duplicate = findAbsorbableWhoopSession(session.started_at, session.ended_at, sessions);
      if (duplicate) {
        await ports.data.relinkSessionSegments(duplicate.id, session.id);
        const patch = absorptionPatch(session, duplicate);
        if (patch) await ports.data.updateSession(session.id, patch);
        await ports.data.deleteSession(duplicate.id);
        absorbed += 1;
      }
    }
  }
  for (const update of plan.updates) {
    await ports.data.updateSession(update.sessionId, update.patch);
  }

  return {
    fetched: records.length,
    created: plan.creates.length,
    updated: plan.updates.length,
    absorbed,
    skippedUserEdited: plan.skippedUserEdited,
  };
}
