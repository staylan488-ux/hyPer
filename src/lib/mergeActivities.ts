import type { ActivitySession, ActivitySessionInput } from '@/types';

export interface MergePlan {
  /** session that survives and absorbs the others */
  keepId: string;
  /** sessions to remove once their segments have been re-pointed */
  absorbIds: string[];
  /** fields to write onto the surviving session */
  patch: Partial<ActivitySessionInput>;
}

function earliestStart(session: ActivitySession): number {
  const parsed = Date.parse(session.started_at ?? '');
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function latestEnd(session: ActivitySession): number {
  const parsed = Date.parse(session.ended_at ?? '');
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function sumDefined(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? present.reduce((total, value) => total + value, 0) : null;
}

function maxDefined(values: Array<number | null>): number | null {
  const present = values.filter((value): value is number => value != null);
  return present.length > 0 ? Math.max(...present) : null;
}

/**
 * Combines same-day sessions that were really one activity — most often WHOOP
 * splitting a single swim into two records.
 *
 * The earliest session survives so its start time stays truthful. Additive
 * metrics sum, max HR takes the max, and average HR is weighted by each
 * session's duration rather than naively averaged, which would over-weight a
 * two-minute fragment against a fifty-minute effort. Strain is deliberately
 * NOT summed: WHOOP's strain is a logarithmic daily-load score, so adding two
 * values would invent a number WHOOP never produced — the largest is kept.
 */
export function planActivityMerge(sessions: ActivitySession[]): MergePlan | null {
  if (sessions.length < 2) return null;

  const days = new Set(sessions.map((session) => session.date));
  if (days.size !== 1) return null;

  const ordered = [...sessions].sort((a, b) => earliestStart(a) - earliestStart(b));
  const keep = ordered[0];
  const absorbed = ordered.slice(1);

  const starts = ordered.map(earliestStart).filter(Number.isFinite);
  const ends = ordered.map(latestEnd).filter((value) => Number.isFinite(value));
  const startedAt = starts.length > 0 ? new Date(Math.min(...starts)).toISOString() : keep.started_at;
  const endedAt = ends.length > 0 ? new Date(Math.max(...ends)).toISOString() : keep.ended_at;

  const durations = ordered.map((session) => session.duration_seconds);
  const hrWeighted = ordered.reduce(
    (total, session) => (session.avg_hr != null
      ? total + session.avg_hr * Math.max(1, session.duration_seconds ?? 1)
      : total),
    0,
  );
  const hrWeight = ordered.reduce(
    (total, session) => (session.avg_hr != null ? total + Math.max(1, session.duration_seconds ?? 1) : total),
    0,
  );

  // a merge is a user decision; mark it so a later WHOOP sync cannot split it
  // back apart or reshape it
  const patch: Partial<ActivitySessionInput> = {
    started_at: startedAt,
    ended_at: endedAt,
    duration_seconds: sumDefined(durations),
    distance_m: sumDefined(ordered.map((session) => session.distance_m)),
    energy_kcal: sumDefined(ordered.map((session) => session.energy_kcal)),
    max_hr: maxDefined(ordered.map((session) => session.max_hr)),
    avg_hr: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null,
    strain: maxDefined(ordered.map((session) => session.strain)),
    user_edited: true,
  };

  // keep a name if any of them had one
  const title = ordered.map((session) => session.title?.trim()).find(Boolean);
  if (title) patch.title = title;
  const customType = ordered.map((session) => session.custom_type?.trim()).find(Boolean);
  if (customType && keep.activity_type === 'other') patch.custom_type = customType;

  return { keepId: keep.id, absorbIds: absorbed.map((session) => session.id), patch };
}
