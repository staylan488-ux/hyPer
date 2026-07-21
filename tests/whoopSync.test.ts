import { describe, expect, it } from 'vitest';

import { runWhoopSync, type WhoopSyncPorts } from '@/lib/whoopSync';
import type { WhoopWorkoutRecord } from '@/lib/whoopImport';
import type {
  ActivitySegment,
  ActivitySegmentInput,
  ActivitySession,
  ActivitySessionInput,
} from '@/types';

const NOW = new Date('2026-07-08T12:00:00.000Z');
const T0 = Date.parse('2026-07-07T14:00:00.000Z');

function isoAt(offsetSeconds: number): string {
  return new Date(T0 + offsetSeconds * 1000).toISOString();
}

function lapRecord(n: number, opts: { scored?: boolean } = {}): WhoopWorkoutRecord {
  const start = (n - 1) * (130 + 85);
  const scored = opts.scored ?? true;
  return {
    id: `wf-lap-${n}`,
    sport_name: 'running',
    start: isoAt(start),
    end: isoAt(start + 130),
    timezone_offset: '+00:00',
    score_state: scored ? 'SCORED' : 'PENDING_SCORE',
    score: scored
      ? { strain: 6, average_heart_rate: 170, max_heart_rate: 185, kilojoule: 130, distance_meter: 500 }
      : null,
  };
}

const tennisRecord: WhoopWorkoutRecord = {
  id: 'wf-tennis',
  sport_name: 'tennis',
  start: isoAt(4 * 3600),
  end: isoAt(4 * 3600 + 75 * 60),
  timezone_offset: '+00:00',
  score_state: 'SCORED',
  score: { strain: 10.1, average_heart_rate: 132, max_heart_rate: 168, kilojoule: 2170 },
};

// in-memory stand-in for the store's Supabase-backed data port, honouring the
// same upsert-by-(source, external_id) semantics as the real table
class FakeData {
  segments: ActivitySegment[] = [];
  sessions: ActivitySession[] = [];
  private seq = 0;

  ports(): WhoopSyncPorts['data'] {
    return {
      upsertSegments: async (inputs: ActivitySegmentInput[]) => {
        return inputs.map((input) => {
          const existing = this.segments.find(
            (s) => s.source === input.source && s.external_id === input.external_id,
          );
          if (existing) {
            // like the store, the conflict update must never touch session_id
            const metrics = { ...input };
            delete metrics.session_id;
            Object.assign(existing, metrics);
            return existing;
          }
          const created: ActivitySegment = {
            id: `seg-${++this.seq}`,
            user_id: 'user-1',
            session_id: input.session_id ?? null,
            source: input.source,
            external_id: input.external_id,
            sport: input.sport ?? null,
            started_at: input.started_at,
            ended_at: input.ended_at,
            duration_seconds: input.duration_seconds ?? null,
            strain: input.strain ?? null,
            avg_hr: input.avg_hr ?? null,
            max_hr: input.max_hr ?? null,
            energy_kcal: input.energy_kcal ?? null,
            distance_m: input.distance_m ?? null,
            raw: input.raw ?? null,
            created_at: input.started_at,
            updated_at: input.started_at,
          };
          this.segments.push(created);
          return created;
        });
      },
      fetchWhoopSegmentsInWindow: async (fromIso, toIso) =>
        this.segments.filter(
          (s) => s.source === 'whoop' && s.started_at >= fromIso && s.started_at <= toIso,
        ),
      fetchSessionsInWindow: async (fromIso, toIso) =>
        this.sessions.filter(
          (s) => (s.started_at ?? '') >= fromIso && (s.started_at ?? '') <= toIso,
        ),
      fetchSessionsByIds: async (ids: string[]) =>
        this.sessions.filter((s) => ids.includes(s.id)),
      createSession: async (input: ActivitySessionInput) => {
        const created: ActivitySession = {
          id: `sess-${++this.seq}`,
          user_id: 'user-1',
          activity_type: input.activity_type,
          title: input.title ?? null,
          date: input.date,
          started_at: input.started_at ?? null,
          ended_at: input.ended_at ?? null,
          duration_seconds: input.duration_seconds ?? null,
          source: input.source ?? 'manual',
          notes: input.notes ?? null,
          strain: input.strain ?? null,
          avg_hr: input.avg_hr ?? null,
          max_hr: input.max_hr ?? null,
          energy_kcal: input.energy_kcal ?? null,
          distance_m: input.distance_m ?? null,
          auto_grouped: input.auto_grouped ?? false,
          user_edited: input.user_edited ?? false,
          dismissed_at: input.dismissed_at ?? null,
          created_at: NOW.toISOString(),
          updated_at: NOW.toISOString(),
        };
        this.sessions.push(created);
        return created;
      },
      updateSession: async (sessionId, patch) => {
        const session = this.sessions.find((s) => s.id === sessionId);
        if (!session) return null;
        Object.assign(session, patch);
        return session;
      },
      deleteSession: async (sessionId) => {
        this.sessions = this.sessions.filter((s) => s.id !== sessionId);
        this.segments.forEach((s) => {
          if (s.session_id === sessionId) s.session_id = null;
        });
      },
      linkSegmentsToSession: async (segmentIds, sessionId) => {
        this.segments.forEach((s) => {
          if (segmentIds.includes(s.id)) s.session_id = sessionId;
        });
      },
    };
  }
}

function makePorts(data: FakeData, batches: WhoopWorkoutRecord[][]): WhoopSyncPorts {
  let call = 0;
  return {
    fetchBatch: async () => {
      const records = batches[Math.min(call, batches.length - 1)];
      call += 1;
      return { records, nextToken: null };
    },
    data: data.ports(),
    now: () => NOW,
  };
}

describe('runWhoopSync', () => {
  it('imports a first batch: laps merge into one interval session, tennis stays separate', async () => {
    const data = new FakeData();
    const laps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => lapRecord(n));
    const ports = makePorts(data, [[...laps, tennisRecord]]);

    const result = await runWhoopSync(ports, {});

    expect(result.fetched).toBe(9);
    expect(result.created).toBe(2);
    expect(result.updated).toBe(0);

    const interval = data.sessions.find((s) => s.activity_type === 'interval_run');
    const tennis = data.sessions.find((s) => s.activity_type === 'tennis');
    expect(interval).toBeDefined();
    expect(tennis).toBeDefined();
    expect(interval?.duration_seconds).toBe(8 * 130);
    expect(interval?.distance_m).toBe(4000);

    const linkedLaps = data.segments.filter((s) => s.session_id === interval?.id);
    expect(linkedLaps).toHaveLength(8);
  });

  it('is idempotent for duplicate deliveries', async () => {
    const data = new FakeData();
    const batch = [1, 2, 3].map((n) => lapRecord(n));
    const ports = makePorts(data, [batch, batch]);

    const first = await runWhoopSync(ports, {});
    const second = await runWhoopSync(ports, {});

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.deleted).toBe(0);
    expect(data.sessions).toHaveLength(1);
    expect(data.segments).toHaveLength(3);
  });

  it('grows the SAME session when a late lap arrives', async () => {
    const data = new FakeData();
    const eight = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => lapRecord(n));
    const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => lapRecord(n));
    const ports = makePorts(data, [eight, nine]);

    await runWhoopSync(ports, {});
    const sessionId = data.sessions[0].id;
    const result = await runWhoopSync(ports, {});

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe(sessionId);
    expect(data.sessions[0].duration_seconds).toBe(9 * 130);
    expect(data.segments.filter((s) => s.session_id === sessionId)).toHaveLength(9);
  });

  it('back-fills PENDING_SCORE records on a later sync', async () => {
    const data = new FakeData();
    const pending = [lapRecord(1), lapRecord(2, { scored: false })];
    const scored = [lapRecord(1), lapRecord(2)];
    const ports = makePorts(data, [pending, scored]);

    await runWhoopSync(ports, {});
    const before = data.segments.find((s) => s.external_id === 'wf-lap-2');
    expect(before?.strain).toBeNull();

    const result = await runWhoopSync(ports, {});
    const after = data.segments.find((s) => s.external_id === 'wf-lap-2');

    expect(after?.strain).toBe(6);
    expect(result.updated).toBe(1); // session aggregates absorbed the back-fill
    expect(data.sessions[0].distance_m).toBe(1000);
  });

  it('respects user deletions across re-syncs', async () => {
    const data = new FakeData();
    const batch = [1, 2, 3].map((n) => lapRecord(n));
    const ports = makePorts(data, [batch, batch]);

    await runWhoopSync(ports, {});
    // user soft-dismisses the imported session
    data.sessions[0].dismissed_at = NOW.toISOString();

    const result = await runWhoopSync(ports, {});

    expect(result.created).toBe(0);
    expect(result.deleted).toBe(0);
    expect(result.skippedUserEdited).toBe(1);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].dismissed_at).not.toBeNull();
  });

  it('enriches an existing GPS session end-to-end instead of duplicating it', async () => {
    const data = new FakeData();
    // a run tracked in-app: session + its own gps segment already saved
    const gpsSession = (await data.ports().createSession({
      activity_type: 'run',
      title: null,
      date: '2026-07-07',
      started_at: isoAt(0),
      ended_at: isoAt(30 * 60),
      duration_seconds: 30 * 60,
      source: 'gps',
      distance_m: 6100,
    }))!;
    await data.ports().upsertSegments([
      {
        source: 'gps',
        external_id: 'gps:runX:1',
        started_at: isoAt(0),
        ended_at: isoAt(30 * 60),
        duration_seconds: 30 * 60,
        distance_m: 6100,
      },
    ]);
    data.segments[0].session_id = gpsSession.id;

    // whoop recorded the same 30 minutes
    const whoopRecord: WhoopWorkoutRecord = {
      id: 'wf-same-run',
      sport_name: 'running',
      start: isoAt(-60),
      end: isoAt(29 * 60),
      timezone_offset: '+00:00',
      score_state: 'SCORED',
      score: { strain: 11.3, average_heart_rate: 168, max_heart_rate: 190, kilojoule: 1850, distance_meter: null },
    };
    const ports = makePorts(data, [[whoopRecord], [whoopRecord]]);

    const first = await runWhoopSync(ports, {});

    expect(first.created).toBe(0);
    expect(first.updated).toBe(1);
    expect(data.sessions).toHaveLength(1); // no duplicate event
    const session = data.sessions[0];
    expect(session.source).toBe('gps');
    expect(session.strain).toBe(11.3);
    expect(session.avg_hr).toBe(168);
    expect(session.distance_m).toBe(6100); // GPS distance untouched
    expect(session.duration_seconds).toBe(30 * 60); // times untouched
    const whoopSegment = data.segments.find((s) => s.external_id === 'wf-same-run');
    expect(whoopSegment?.session_id).toBe(session.id);

    // re-sync is a no-op
    const second = await runWhoopSync(ports, {});
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(data.sessions).toHaveLength(1);
  });

  it('paginates until the transport stops returning nextToken', async () => {
    const data = new FakeData();
    let call = 0;
    const ports: WhoopSyncPorts = {
      fetchBatch: async () => {
        call += 1;
        if (call === 1) return { records: [lapRecord(1)], nextToken: 'page-2' };
        return { records: [lapRecord(2)], nextToken: null };
      },
      data: data.ports(),
      now: () => NOW,
    };

    const result = await runWhoopSync(ports, {});

    expect(call).toBe(2);
    expect(result.fetched).toBe(2);
    expect(data.segments).toHaveLength(2);
  });

  it('keeps segments on a host session that started just before the window (straddle)', async () => {
    const data = new FakeData();
    // Host GPS session started BEFORE the reconciliation window...
    data.sessions.push({
      id: 'host-gps',
      user_id: 'user-1',
      activity_type: 'run',
      title: 'Morning run',
      date: '2026-07-07',
      started_at: '2026-07-07T12:30:00.000Z',
      ended_at: '2026-07-07T14:10:00.000Z',
      duration_seconds: 6000,
      source: 'gps',
      notes: null,
      strain: null,
      avg_hr: null,
      max_hr: null,
      energy_kcal: null,
      distance_m: null,
      auto_grouped: false,
      user_edited: false,
      dismissed_at: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });
    // ...owning a WHOOP segment whose start (T0 = 14:00) is INSIDE the window.
    data.segments.push({
      id: 'seg-host',
      user_id: 'user-1',
      session_id: 'host-gps',
      source: 'whoop',
      external_id: 'wf-lap-1',
      sport: 'running',
      started_at: isoAt(0),
      ended_at: isoAt(130),
      duration_seconds: 130,
      strain: 6,
      avg_hr: 170,
      max_hr: 185,
      energy_kcal: null,
      distance_m: 500,
      raw: null,
      created_at: isoAt(0),
      updated_at: isoAt(0),
    });

    // sinceIso chosen so fetchStart (sinceMs - 7d) = 2026-07-07T13:00Z: the host
    // (12:30) sits before it, the segment (14:00) inside it.
    const ports = makePorts(data, [[]]);
    const result = await runWhoopSync(ports, { sinceIso: '2026-07-14T13:00:00.000Z' });

    // No duplicate session, and the segment stays on its real owner.
    expect(result.created).toBe(0);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].id).toBe('host-gps');
    expect(data.segments.find((s) => s.external_id === 'wf-lap-1')?.session_id).toBe('host-gps');
  });
});
