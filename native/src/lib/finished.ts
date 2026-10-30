// The summary shown on the "session complete" label, captured just before
// the workout is completed (completing clears the live workout).
import { create } from 'zustand';

import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';

import { countBeats } from './beatLastTime';
import type { SessionModel } from './sessionModel';

export type FinishedSummary = {
  dayName: string;
  finishedAt: Date;
  /** Logged or not, per set in session order: the tally on the summary label. */
  marks: boolean[];
  sets: number;
  /** Logged sets that beat the same set last time. */
  beat: number;
  volume: number;
  minutes: number;
  best: { name: string; weight: number; reps: number } | null;
};

function beats(a: { weight: number; reps: number }, b: { weight: number; reps: number }): boolean {
  if (a.weight * a.reps !== b.weight * b.reps) return a.weight * a.reps > b.weight * b.reps;
  if (a.weight !== b.weight) return a.weight > b.weight;
  return a.reps > b.reps;
}

/** `previous` is last time's numbers for the session (see usePreviousTargetsStore). */
export function summarize(session: SessionModel, previous: PreviousWorkoutSetMap = {}, finishedAt = new Date()): FinishedSummary {
  const done = session.sets.filter((set) => set.completed);
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
    finishedAt,
    marks: session.sets.map((set) => set.completed),
    sets: done.length,
    beat: countBeats(session.sets, previous),
    volume,
    minutes: Math.max(1, Math.round((finishedAt.getTime() - session.startedAt.getTime()) / 60_000)),
    best,
  };
}

export const useFinishedStore = create<{ summary: FinishedSummary | null; set: (summary: FinishedSummary) => void }>((set) => ({
  summary: null,
  set: (summary) => set({ summary }),
}));
