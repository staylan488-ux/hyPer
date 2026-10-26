// The summary shown on the "session complete" label, captured just before
// the workout is completed (completing clears the live workout).
import { create } from 'zustand';

import type { SessionModel } from './session';

export type FinishedSummary = {
  dayName: string;
  finishedAt: Date;
  /** Logged or not, per set in session order: the tally on the summary label. */
  marks: boolean[];
  sets: number;
  volume: number;
  minutes: number;
  best: { name: string; weight: number; reps: number } | null;
};

export function summarize(session: SessionModel, finishedAt = new Date()): FinishedSummary {
  const done = session.sets.filter((set) => set.completed);
  let best: FinishedSummary['best'] = null;
  let volume = 0;
  for (const set of done) {
    const weight = Number(set.weight ?? 0);
    const reps = Number(set.reps ?? 0);
    volume += weight * reps;
    if (!best || weight * reps > best.weight * best.reps) {
      best = { name: set.exercise?.name ?? 'Set', weight, reps };
    }
  }
  return {
    dayName: session.dayName,
    finishedAt,
    marks: session.sets.map((set) => set.completed),
    sets: done.length,
    volume,
    minutes: Math.max(1, Math.round((finishedAt.getTime() - session.startedAt.getTime()) / 60_000)),
    best,
  };
}

export const useFinishedStore = create<{ summary: FinishedSummary | null; set: (summary: FinishedSummary) => void }>((set) => ({
  summary: null,
  set: (summary) => set({ summary }),
}));
