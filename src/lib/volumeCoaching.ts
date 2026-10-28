import type { MuscleVolume } from '@/types';

// Progress's per-muscle call, shared by the web Coaching page and native Progress.

export type CoachingTone = 'amber' | 'sage' | 'berry' | 'stone';

export interface CoachingCall {
  chip: string;
  tone: CoachingTone;
  headline: string;
  priority: number;
}

/** What to do about a muscle this week; a missing landmark counts as MEV 0. */
export function buildCoachingCall(mv: MuscleVolume): CoachingCall {
  const mev = mv.landmark?.mev ?? 0;
  switch (mv.status) {
    case 'below_mev': {
      const gap = Math.max(1, Math.ceil(mev - mv.weekly_sets));
      return { chip: 'Under-stimulated', tone: 'amber', headline: `Add ~${gap} ${gap === 1 ? 'set' : 'sets'} this week`, priority: 0 };
    }
    case 'above_mrv':
      return { chip: 'Over ceiling', tone: 'berry', headline: 'Pull back — beyond recoverable volume', priority: 1 };
    case 'approaching_mrv':
      return { chip: 'Near ceiling', tone: 'berry', headline: 'Hold here — fatigue is compounding', priority: 2 };
    case 'mav':
      return { chip: 'Adaptive zone', tone: 'sage', headline: 'Hold volume — growth is compounding', priority: 3 };
    case 'mev_mav':
    default:
      return { chip: 'Effective', tone: 'sage', headline: 'Building — room to add when ready', priority: 4 };
  }
}

/** Muscles by coaching priority (under, over, near, in zone, building), then by sets. */
export function coachMuscles(volume: MuscleVolume[]): Array<{ mv: MuscleVolume; call: CoachingCall }> {
  return volume
    .map((mv) => ({ mv, call: buildCoachingCall(mv) }))
    .sort((a, b) => a.call.priority - b.call.priority || b.mv.weekly_sets - a.mv.weekly_sets);
}
