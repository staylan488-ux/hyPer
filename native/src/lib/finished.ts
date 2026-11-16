// The summary shown on the "session complete" label, captured just before
// the workout is completed (completing clears the live workout).
import { create } from 'zustand';

import { findNewRecords, type MovementRecords, type NewRecord } from '@/lib/movementHistory';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import type { MovementHistoryMap } from '@/lib/setTargets';
import { getWorkoutDurationMs } from '@/lib/workoutSessions';

import { countBeats } from './beatLastTime';
import type { SessionModel } from './sessionModel';
import { countTargets, sessionTargets } from './setTargets';

export type FinishedSummary = {
  dayName: string;
  startedAt: Date;
  finishedAt: Date;
  /** Logged or not, per set in session order: the tally on the summary label. */
  marks: boolean[];
  sets: number;
  /** Logged sets that beat the same set last time. */
  beat: number;
  /** Logged sets that had a target, and how many reached it (hit or beat). */
  targets?: { hit: number; total: number };
  volume: number;
  minutes: number;
  best: { name: string; weight: number; reps: number } | null;
  /** Movements that set a record (one each), against their history before this workout. */
  records: NewRecord[];
};

function beats(a: { weight: number; reps: number }, b: { weight: number; reps: number }): boolean {
  if (a.weight * a.reps !== b.weight * b.reps) return a.weight * a.reps > b.weight * b.reps;
  if (a.weight !== b.weight) return a.weight > b.weight;
  return a.reps > b.reps;
}

/**
 * `previous` is last time's numbers for the session and `history` each
 * movement's recent sessions (see usePreviousTargetsStore); `prior` each
 * movement's records before it (see usePriorRecordsStore).
 */
export function summarize(
  session: SessionModel,
  previous: PreviousWorkoutSetMap = {},
  finishedAt = new Date(),
  prior: Readonly<Record<string, MovementRecords | undefined>> = {},
  history: MovementHistoryMap = {},
): FinishedSummary {
  const done = session.sets.filter((set) => set.completed);
  // Start to the last logged set, as the workout is saved, so the receipt agrees with the record and History.
  const lastLogged = Math.max(...done.map((set) => (set.completed_at ? Date.parse(set.completed_at) : NaN)).filter(Number.isFinite));
  const end = Number.isFinite(lastLogged) ? new Date(lastLogged) : finishedAt;
  // A start that cannot be read never stops the finish: the receipt then shows the finish time.
  const startedAt = Number.isNaN(session.startedAt.getTime()) ? null : session.startedAt;
  const duration = startedAt ? getWorkoutDurationMs({ created_at: startedAt.toISOString(), completed_at: end.toISOString() }) : null;
  let best: FinishedSummary['best'] = null;
  let volume = 0;
  for (const set of done) {
    const weight = Number(set.weight ?? 0);
    const reps = Number(set.reps ?? 0);
    volume += weight * reps;
    // The heaviest work first; a bodyweight session (weight 0) picks its most reps.
    if (weight === 0 && reps === 0) continue;
    if (!best || beats({ weight, reps }, best)) {
      best = { name: set.exercise?.name ?? 'Set', weight, reps };
    }
  }
  return {
    dayName: session.dayName,
    startedAt: startedAt ?? finishedAt,
    finishedAt,
    marks: session.sets.map((set) => set.completed),
    sets: done.length,
    beat: countBeats(session.sets, previous),
    targets: countTargets(session, sessionTargets(session, history)),
    volume,
    minutes: Math.max(1, Math.round((duration ?? 0) / 60_000)),
    best,
    records: findNewRecords(done, prior),
  };
}

/**
 * The label's last line: "session 2 of 4 this week", or "session 5 this week"
 * once the week's plan is passed. `weekCount` is null until it loads.
 */
export function savedLine(weekCount: number | null, planned: number | null): string {
  if (weekCount === null || Math.max(planned ?? 0, weekCount) <= 0) return 'Saved to History';
  const of = planned && weekCount <= planned ? ` of ${planned}` : '';
  return `Saved to History · session ${weekCount}${of} this week`;
}

export const useFinishedStore = create<{ summary: FinishedSummary | null; set: (summary: FinishedSummary) => void }>((set) => ({
  summary: null,
  set: (summary) => set({ summary }),
}));
