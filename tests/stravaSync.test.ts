import { describe, expect, it } from 'vitest';

import { runStravaSync, type StravaSyncPorts } from '@/lib/stravaSync';
import type { StravaActivityRecord } from '@/lib/stravaImport';
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

function runActivity(id: string, opts: { startOffset?: number; elapsed?: number; distance?: number } = {}): StravaActivityRecord {
  const startOffset = opts.startOffset ?? 0;
  return {
    id,
    name: 'Morning Run',
    sport_type: 'Run',
    start_date: isoAt(startOffset),
    utc_offset: 0,
    elapsed_time: opts.elapsed ?? 1800,
    moving_time: opts.elapsed ?? 1800,
    distance: opts.distance ?? 6000,
    average_heartrate: 158,
    max_heartrate: 176,
  };
}

class FakeData {
  segments: ActivitySegment[] = [];
  sessions: ActivitySession[] = [];
  private seq = 0;

  ports(): StravaSyncPorts['data'] {
    return {
      upsertSegments: async (inputs: ActivitySegmentInput[]) => {
        return inputs.map((input) => {
          const existing = this.segments.find(
            (s) => s.source === input.source && s.external_id === input.external_id,
          );
          if (existing) {
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
      fetchStravaSegmentsInWindow: async (fromIso, toIso) =>
        this.segments.filter((s) => s.source === 'strava' && s.started_at >= fromIso && s.started_at <= toIso),
      fetchSessionsInWindow: async (fromIso, toIso) =>
        this.sessions.filter((s) => (s.started_at ?? '') >= fromIso && (s.started_at ?? '') <= toIso),
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
      relinkSessionSegments: async (fromSessionId, toSessionId) => {
        this.segments.forEach((s) => {
          if (s.session_id === fromSessionId) s.session_id = toSessionId;
        });
      },
    };
  }
}

function makePorts(data: FakeData, batches: StravaActivityRecord[][]): StravaSyncPorts {
  let call = 0;
  return {
    fetchBatch: async () => {
      const records = batches[Math.min(call, batches.length - 1)];
      call += 1;
      return { records, nextPage: null };
    },
    data: data.ports(),
    now: () => NOW,
  };
}

describe('runStravaSync', () => {
  it('imports activities as sessions and is idempotent on re-sync', async () => {
    const data = new FakeData();
    const batch = [runActivity('a1'), runActivity('a2', { startOffset: 3600 })];
    const ports = makePorts(data, [batch, batch]);

    const first = await runStravaSync(ports, {});
    expect(first.created).toBe(2);
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.every((s) => s.source === 'strava')).toBe(true);

    const second = await runStravaSync(ports, {});
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(data.sessions).toHaveLength(2);
  });

  it('absorbs an overlapping auto WHOOP session into the new Strava run', async () => {
    const data = new FakeData();

    // WHOOP already auto-imported the run and linked a whoop segment to it
    const whoopSession: ActivitySession = {
      id: 'whoop-1',
      user_id: 'user-1',
      activity_type: 'run',
      title: null,
      date: '2026-07-07',
      started_at: isoAt(-60),
      ended_at: isoAt(1790),
      duration_seconds: 1800,
      source: 'whoop',
      notes: null,
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
      distance_m: null,
      auto_grouped: true,
      user_edited: false,
      dismissed_at: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    };
    data.sessions.push(whoopSession);
    data.segments.push({
      id: 'whoop-seg',
      user_id: 'user-1',
      session_id: 'whoop-1',
      source: 'whoop',
      external_id: 'w-run',
      sport: 'running',
      started_at: isoAt(-60),
      ended_at: isoAt(1790),
      duration_seconds: 1800,
      strain: 11.3,
      avg_hr: 168,
      max_hr: 190,
      energy_kcal: 442,
      distance_m: null,
      raw: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });

    const ports = makePorts(data, [[runActivity('a1')]]);
    const result = await runStravaSync(ports, {});

    expect(result.created).toBe(1);
    expect(result.absorbed).toBe(1);
    // only ONE session remains — the Strava run — and the WHOOP one is gone
    expect(data.sessions).toHaveLength(1);
    const survivor = data.sessions[0];
    expect(survivor.source).toBe('strava');
    expect(survivor.distance_m).toBe(6000); // strava distance kept
    expect(survivor.strain).toBe(11.3); // whoop strain absorbed
    expect(survivor.energy_kcal).toBe(442);
    // the whoop segment now points at the strava session
    expect(data.segments.find((s) => s.external_id === 'w-run')?.session_id).toBe(survivor.id);
    // strava avg_hr already present, so it stays (fill-only absorption)
    expect(survivor.avg_hr).toBe(158);
  });

  it('does not absorb a non-overlapping WHOOP session', async () => {
    const data = new FakeData();
    data.sessions.push({
      id: 'whoop-far',
      user_id: 'user-1',
      activity_type: 'run',
      title: null,
      date: '2026-07-07',
      started_at: isoAt(10 * 3600),
      ended_at: isoAt(10 * 3600 + 1800),
      duration_seconds: 1800,
      source: 'whoop',
      notes: null,
      strain: 9,
      avg_hr: 150,
      max_hr: 170,
      energy_kcal: 300,
      distance_m: null,
      auto_grouped: true,
      user_edited: false,
      dismissed_at: null,
      created_at: NOW.toISOString(),
      updated_at: NOW.toISOString(),
    });

    const ports = makePorts(data, [[runActivity('a1')]]);
    const result = await runStravaSync(ports, {});

    expect(result.created).toBe(1);
    expect(result.absorbed).toBe(0);
    expect(data.sessions).toHaveLength(2);
  });
});
