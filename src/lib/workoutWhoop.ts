/**
 * Attaching WHOOP physiology to a lifting workout.
 *
 * A lifting session and the WHOOP record of it are the same event seen twice,
 * the same relationship a GPS run has with its WHOOP record - but workouts live
 * in their own table, with no strain, heart rate or energy of their own, and
 * they never appear in the activity merge picker. This bridges that gap.
 *
 * The awkward part is time. A workout row stores only a DATE, so matching has
 * to be reconstructed from the set timestamps, which is where the real
 * start and finish live.
 *
 * Pure - no I/O, no clock reads.
 */

import type { ActivitySession, Workout } from '@/types';

export interface TimeWindow {
  startMs: number;
  endMs: number;
}

/** Fraction of the shorter window that must overlap to call it the same session. */
export const WORKOUT_MATCH_OVERLAP = 0.35;

/** Ignore a candidate shorter than this; a stray 2-minute record is noise. */
const MIN_CANDIDATE_MS = 5 * 60 * 1000;

function parse(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When the lifting actually happened.
 *
 * Built from completed set timestamps, because `workouts.date` is a calendar
 * day and would overlap every WHOOP record that day. `created_at` and
 * `completed_at` widen the window when they are present but never narrow it:
 * a set logged after the workout was marked complete still counts.
 */
export function workoutTimeWindow(workout: Workout): TimeWindow | null {
  const stamps: number[] = [];
  for (const set of workout.sets ?? []) {
    const at = parse(set.completed_at);
    if (at != null) stamps.push(at);
  }
  const created = parse(workout.created_at);
  const completed = parse(workout.completed_at);
  if (created != null) stamps.push(created);
  if (completed != null) stamps.push(completed);

  if (stamps.length === 0) return null;
  const startMs = Math.min(...stamps);
  const endMs = Math.max(...stamps);
  // a single timestamp is a point, not a window; treat it as a nominal hour
  // centred on itself rather than refusing to match at all
  if (endMs === startMs) {
    return { startMs: startMs - 30 * 60 * 1000, endMs: endMs + 30 * 60 * 1000 };
  }
  return { startMs, endMs };
}

function overlapRatioOfShorter(a: TimeWindow, b: TimeWindow): number {
  const overlap = Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs);
  if (overlap <= 0) return 0;
  const shorter = Math.min(a.endMs - a.startMs, b.endMs - b.startMs);
  return shorter > 0 ? overlap / shorter : 0;
}

export interface WhoopMatch {
  session: ActivitySession;
  overlapRatio: number;
}

/**
 * The WHOOP record that best covers this workout.
 *
 * Excludes only sessions already attached elsewhere. `dismissed_at` is the
 * tombstone re-sync respects, so a dismissed record has been claimed by another
 * workout and must not be double-counted.
 *
 * `user_edited` is deliberately NOT excluded. It is set by merging or renaming
 * an activity, and excluding it made every merged WHOOP record permanently
 * invisible here - which is most of them, since merging duplicate WHOOP records
 * is a normal thing to do. Attaching is an explicit button press, so there is no
 * risk of quietly absorbing a record the user curated.
 */
export function findWhoopMatchForWorkout(
  workout: Workout,
  sessions: ActivitySession[],
): WhoopMatch | null {
  return searchWhoopForWorkout(workout, sessions).match;
}

/** Why a search came up empty, so the UI can say something useful. */
export type WhoopSearchReason =
  | 'match'
  | 'no_window'
  | 'no_whoop_activities'
  | 'all_already_attached'
  | 'no_overlap';

export interface WhoopSearchResult {
  match: WhoopMatch | null;
  reason: WhoopSearchReason;
  /** WHOOP records on the day, before any filtering. */
  whoopCount: number;
  /** The best overlap seen, even if it fell short. */
  bestRatio: number;
}

export function searchWhoopForWorkout(
  workout: Workout,
  sessions: ActivitySession[],
): WhoopSearchResult {
  const window = workoutTimeWindow(workout);
  const whoop = sessions.filter((session) => session.source === 'whoop');
  if (!window) {
    return { match: null, reason: 'no_window', whoopCount: whoop.length, bestRatio: 0 };
  }
  if (whoop.length === 0) {
    return { match: null, reason: 'no_whoop_activities', whoopCount: 0, bestRatio: 0 };
  }

  let best: WhoopMatch | null = null;
  let bestRatio = 0;
  let unclaimed = 0;

  for (const session of whoop) {
    if (session.dismissed_at) continue;
    unclaimed += 1;

    const start = parse(session.started_at);
    const end = parse(session.ended_at);
    if (start == null || end == null || end <= start) continue;
    if (end - start < MIN_CANDIDATE_MS) continue;

    const ratio = overlapRatioOfShorter(window, { startMs: start, endMs: end });
    if (ratio > bestRatio) bestRatio = ratio;
    if (ratio >= WORKOUT_MATCH_OVERLAP && (!best || ratio > best.overlapRatio)) {
      best = { session, overlapRatio: ratio };
    }
  }

  if (best) return { match: best, reason: 'match', whoopCount: whoop.length, bestRatio };
  if (unclaimed === 0) {
    return { match: null, reason: 'all_already_attached', whoopCount: whoop.length, bestRatio };
  }
  return { match: null, reason: 'no_overlap', whoopCount: whoop.length, bestRatio };
}

/**
 * Whether an activity carries anything worth attaching. A merged activity keeps
 * the physiology of everything it absorbed, so it qualifies just as a raw WHOOP
 * record does.
 */
export function activityHasStats(session: ActivitySession): boolean {
  return session.strain != null
    || session.avg_hr != null
    || session.max_hr != null
    || session.energy_kcal != null;
}

/** The physiology copied onto the workout. Nothing is summed or derived. */
export interface WorkoutWhoopStats {
  strain: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  energy_kcal: number | null;
  whoop_session_id: string | null;
}

export function whoopStatsFor(session: ActivitySession): WorkoutWhoopStats {
  return {
    strain: session.strain ?? null,
    avg_hr: session.avg_hr ?? null,
    max_hr: session.max_hr ?? null,
    energy_kcal: session.energy_kcal ?? null,
    whoop_session_id: session.id,
  };
}

/** Clearing them again, so attaching is reversible rather than one-way. */
export const CLEARED_WHOOP_STATS: WorkoutWhoopStats = {
  strain: null,
  avg_hr: null,
  max_hr: null,
  energy_kcal: null,
  whoop_session_id: null,
};

export function workoutHasWhoopStats(workout: Workout): boolean {
  return workout.strain != null
    || workout.avg_hr != null
    || workout.max_hr != null
    || workout.energy_kcal != null;
}
