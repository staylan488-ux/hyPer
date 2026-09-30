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
          custom_type: input.custom_type ?? null,
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
      custom_type: null,
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

function sessionFixture(overrides: Partial<ActivitySession> & { id: string }): ActivitySession {
  return {
    user_id: 'user-1',
    activity_type: 'run',
    custom_type: null,
    title: null,
    date: '2026-07-07',
    started_at: isoAt(0),
    ended_at: isoAt(30 * 60),
    duration_seconds: 30 * 60,
    source: 'whoop',
    notes: null,
    strain: null,
    avg_hr: null,
    max_hr: null,
    energy_kcal: null,
    distance_m: null,
    auto_grouped: true,
    user_edited: false,
    dismissed_at: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function segmentFixture(overrides: Partial<ActivitySegment> & { id: string }): ActivitySegment {
  return {
    user_id: 'user-1',
    session_id: null,
    source: 'whoop',
    external_id: `wf-${overrides.id}`,
    sport: 'running',
    started_at: isoAt(0),
    ended_at: isoAt(30 * 60),
    duration_seconds: 30 * 60,
    strain: 8,
    avg_hr: 150,
    max_hr: 175,
    energy_kcal: 300,
    distance_m: null,
    raw: null,
    created_at: isoAt(0),
    updated_at: isoAt(0),
    ...overrides,
  };
}

function withData(
  ports: WhoopSyncPorts,
  overrides: Partial<WhoopSyncPorts['data']>,
): WhoopSyncPorts {
  return { ...ports, data: { ...ports.data, ...overrides } };
}

const readError = () => Promise.reject(new Error('network request failed'));

function linkSnapshot(data: FakeData) {
  return data.segments.map((s) => [s.id, s.session_id]);
}

describe('runWhoopSync when a port fails', () => {
  it('rejects without deleting anything when the segment window read fails', async () => {
    const data = new FakeData();
    await runWhoopSync(makePorts(data, [[1, 2, 3].map((n) => lapRecord(n))]), {});
    const sessionsBefore = structuredClone(data.sessions);
    const linksBefore = linkSnapshot(data);

    const ports = withData(makePorts(data, [[]]), { fetchWhoopSegmentsInWindow: readError });

    await expect(runWhoopSync(ports, {})).rejects.toThrow('network request failed');
    expect(data.sessions).toEqual(sessionsBefore);
    expect(linkSnapshot(data)).toEqual(linksBefore);
  });

  it('rejects without creating or relinking when the session window read fails', async () => {
    const data = new FakeData();
    // a GPS run WHOOP already enriched, and a dismissed WHOOP tombstone
    data.sessions.push(
      sessionFixture({ id: 'gps-host', source: 'gps', auto_grouped: false, strain: 8 }),
      sessionFixture({
        id: 'dismissed',
        started_at: isoAt(5 * 3600),
        ended_at: isoAt(5 * 3600 + 1800),
        dismissed_at: NOW.toISOString(),
      }),
    );
    data.segments.push(
      segmentFixture({ id: 'seg-gps', session_id: 'gps-host' }),
      segmentFixture({
        id: 'seg-dismissed',
        session_id: 'dismissed',
        started_at: isoAt(5 * 3600),
        ended_at: isoAt(5 * 3600 + 1800),
      }),
    );
    const sessionsBefore = structuredClone(data.sessions);

    const ports = withData(makePorts(data, [[]]), { fetchSessionsInWindow: readError });

    await expect(runWhoopSync(ports, {})).rejects.toThrow('network request failed');
    expect(data.sessions).toEqual(sessionsBefore);
    expect(data.segments.find((s) => s.id === 'seg-gps')?.session_id).toBe('gps-host');
    expect(data.segments.find((s) => s.id === 'seg-dismissed')?.session_id).toBe('dismissed');
  });

  it('rejects and leaves a straddling host its segments when the by-id read fails', async () => {
    const data = new FakeData();
    data.sessions.push(sessionFixture({
      id: 'host-gps',
      source: 'gps',
      auto_grouped: false,
      started_at: '2026-07-07T12:30:00.000Z',
      ended_at: '2026-07-07T14:10:00.000Z',
    }));
    data.segments.push(segmentFixture({ id: 'seg-host', session_id: 'host-gps', ended_at: isoAt(130) }));

    const ports = withData(makePorts(data, [[]]), { fetchSessionsByIds: readError });

    await expect(runWhoopSync(ports, { sinceIso: '2026-07-14T13:00:00.000Z' }))
      .rejects.toThrow('network request failed');
    expect(data.sessions.map((s) => s.id)).toEqual(['host-gps']);
    expect(data.segments.find((s) => s.id === 'seg-host')?.session_id).toBe('host-gps');
  });

  it('converges on the next healthy sync after a link fails mid-apply', async () => {
    const data = new FakeData();
    const laps = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => lapRecord(n));
    const healthy = data.ports();
    let linkCalls = 0;
    const flaky = withData(makePorts(data, [[...laps, tennisRecord]]), {
      linkSegmentsToSession: async (segmentIds, sessionId) => {
        linkCalls += 1;
        if (linkCalls === 2) throw new Error('link failed');
        await healthy.linkSegmentsToSession(segmentIds, sessionId);
      },
    });

    await expect(runWhoopSync(flaky, {})).rejects.toThrow('link failed');

    await runWhoopSync(makePorts(data, [[...laps, tennisRecord]]), {});

    expect(data.sessions.map((s) => s.activity_type).sort()).toEqual(['interval_run', 'tennis']);
    for (const session of data.sessions) {
      expect(data.segments.some((s) => s.session_id === session.id)).toBe(true);
    }
    expect(data.segments.every((s) => s.session_id != null)).toBe(true);
    const interval = data.sessions.find((s) => s.activity_type === 'interval_run');
    expect(data.segments.filter((s) => s.session_id === interval?.id)).toHaveLength(8);
  });

  it('never deletes sessions when the segment window comes back empty', async () => {
    const data = new FakeData();
    data.sessions.push(sessionFixture({ id: 'auto-whoop' }));
    const ports = withData(makePorts(data, [[]]), { fetchWhoopSegmentsInWindow: async () => [] });

    const result = await runWhoopSync(ports, {});

    expect(result.deleted).toBe(0);
    expect(data.sessions.map((s) => s.id)).toEqual(['auto-whoop']);
  });
});

// one standalone WHOOP activity every 3 hours from T0, far enough apart to never
// cluster; slots 0-7 fall before NOW
function soloRecord(slot: number): WhoopWorkoutRecord {
  return {
    ...tennisRecord,
    id: `wf-solo-${slot}`,
    start: isoAt(slot * 3 * 3600),
    end: isoAt(slot * 3 * 3600 + 45 * 60),
  };
}

describe('runWhoopSync apply phase', () => {
  it('counts only sessions that were actually created and recreates the rest next sync', async () => {
    const data = new FakeData();
    const laps = [1, 2, 3].map((n) => lapRecord(n));
    const healthy = data.ports();
    const ports = withData(makePorts(data, [[...laps, tennisRecord]]), {
      createSession: async (input) => (input.activity_type === 'tennis' ? null : healthy.createSession(input)),
    });

    const first = await runWhoopSync(ports, {});

    expect(first.created).toBe(1);
    expect(data.sessions.map((s) => s.activity_type)).toEqual(['interval_run']);

    const second = await runWhoopSync(makePorts(data, [[...laps, tennisRecord]]), {});

    expect(second.created).toBe(1);
    expect(data.sessions.map((s) => s.activity_type).sort()).toEqual(['interval_run', 'tennis']);
    expect(data.segments.every((s) => s.session_id != null)).toBe(true);
  });

  it('applies many creates with at most four writes in flight and links each to its own session', async () => {
    const data = new FakeData();
    const healthy = data.ports();
    let inFlight = 0;
    let peak = 0;
    const track = async <T>(write: () => Promise<T>): Promise<T> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      try {
        return await write();
      } finally {
        inFlight -= 1;
      }
    };
    const records = [0, 1, 2, 3, 4, 5, 6, 7].map(soloRecord);
    const ports = withData(makePorts(data, [records]), {
      createSession: (input) => track(() => healthy.createSession(input)),
    });

    const result = await runWhoopSync(ports, {});

    expect(result.created).toBe(8);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(data.sessions).toHaveLength(8);
    for (const record of records) {
      const segment = data.segments.find((s) => s.external_id === record.id);
      const session = data.sessions.find((s) => s.id === segment?.session_id);
      expect(session?.started_at).toBe(record.start);
    }
    expect(new Set(data.segments.map((s) => s.session_id)).size).toBe(8);
  });

  it('starts no new write after one fails and finishes in-flight ones before rejecting', async () => {
    const data = new FakeData();
    const healthy = data.ports();
    let started = 0;
    let settled = 0;
    const records = [0, 1, 2, 3, 4, 5, 6, 7].map(soloRecord);
    const ports = withData(makePorts(data, [records]), {
      createSession: async (input) => {
        started += 1;
        const call = started;
        await new Promise((resolve) => setTimeout(resolve, call === 1 ? 0 : 5));
        settled += 1;
        if (call === 1) throw new Error('insert failed');
        return healthy.createSession(input);
      },
    });

    await expect(runWhoopSync(ports, {})).rejects.toThrow('insert failed');
    const startedAtRejection = started;
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(startedAtRejection).toBeLessThanOrEqual(4);
    expect(started).toBe(startedAtRejection);
    expect(settled).toBe(started);
  });

  it('still rejects when a delete fails', async () => {
    const data = new FakeData();
    const laps = [1, 2, 3].map((n) => lapRecord(n));
    await runWhoopSync(makePorts(data, [laps]), {});
    data.sessions.push(sessionFixture({ id: 'stale-auto', started_at: isoAt(6 * 3600), ended_at: isoAt(7 * 3600) }));

    const ports = withData(makePorts(data, [laps]), {
      deleteSession: () => Promise.reject(new Error('delete failed')),
    });

    await expect(runWhoopSync(ports, {})).rejects.toThrow('delete failed');
    expect(data.sessions.map((s) => s.id)).toContain('stale-auto');
  });

  it('runs every delete after all creates, updates and links', async () => {
    const data = new FakeData();
    const laps = [1, 2, 3].map((n) => lapRecord(n));
    await runWhoopSync(makePorts(data, [laps]), {});
    data.sessions.push(
      sessionFixture({ id: 'stale-a', started_at: isoAt(8 * 3600), ended_at: isoAt(9 * 3600) }),
      sessionFixture({ id: 'stale-b', started_at: isoAt(10 * 3600), ended_at: isoAt(11 * 3600) }),
    );

    const healthy = data.ports();
    const calls: string[] = [];
    const ports = withData(makePorts(data, [[...laps, lapRecord(4), soloRecord(1), soloRecord(2)]]), {
      createSession: async (input) => {
        calls.push('create');
        return healthy.createSession(input);
      },
      updateSession: async (id, patch) => {
        calls.push('update');
        return healthy.updateSession(id, patch);
      },
      linkSegmentsToSession: async (ids, sessionId) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        calls.push('link');
        return healthy.linkSegmentsToSession(ids, sessionId);
      },
      deleteSession: async (id) => {
        calls.push('delete');
        return healthy.deleteSession(id);
      },
    });

    const result = await runWhoopSync(ports, {});

    expect(result).toMatchObject({ created: 2, updated: 1, deleted: 2 });
    const firstDelete = calls.indexOf('delete');
    expect(firstDelete).toBeGreaterThan(calls.lastIndexOf('link'));
    expect(firstDelete).toBeGreaterThan(calls.lastIndexOf('update'));
    expect(firstDelete).toBeGreaterThan(calls.lastIndexOf('create'));
    expect(calls.lastIndexOf('create')).toBeLessThan(calls.indexOf('update'));
    expect(data.sessions.map((s) => s.id)).not.toContain('stale-a');
  });

  it('leaves a failed link out of the count without failing the sync, and repairs it next time', async () => {
    const data = new FakeData();
    const healthy = data.ports();
    const flaky = withData(makePorts(data, [[soloRecord(0), soloRecord(1)]]), {
      linkSegmentsToSession: async (ids, sessionId) => {
        if (ids.some((id) => data.segments.find((s) => s.id === id)?.external_id === 'wf-solo-1')) return false;
        return healthy.linkSegmentsToSession(ids, sessionId);
      },
    });

    const first = await runWhoopSync(flaky, {});

    expect(first.created).toBe(1);
    expect(data.sessions).toHaveLength(2); // one inserted but unlinked

    const second = await runWhoopSync(makePorts(data, [[soloRecord(0), soloRecord(1)]]), {});

    expect(second).toMatchObject({ created: 1, deleted: 1 });
    expect(data.sessions).toHaveLength(2);
    expect(data.segments.every((s) => s.session_id != null)).toBe(true);
  });
});
