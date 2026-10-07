import { muscleSubject } from '@/lib/muscleCopy';
import type { MuscleVolume } from '@/types';

/** Sets still needed to reach MEV: the "Add ~N" Progress shows. */
const mevDeficit = (mv: MuscleVolume) => (mv.landmark ? mv.landmark.mev - mv.weekly_sets : 0);
/** A muscle's weekly sets as a share of its MEV (1 without a positive MEV). */
const mevShare = (mv: MuscleVolume) => (mv.landmark && mv.landmark.mev > 0 ? mv.weekly_sets / mv.landmark.mev : 1);

/** Under-MEV muscles, furthest behind first: most sets still needed, then
 * the lowest share of MEV. Today's headline and Progress's rows share it. */
export function byMevDeficit(a: MuscleVolume, b: MuscleVolume): number {
  return mevDeficit(b) - mevDeficit(a) || mevShare(a) - mevShare(b);
}

/**
 * Today's one volume insight: the muscle furthest under its minimum effective
 * volume, else the one most past (or nearing) its ceiling, else one in the
 * adaptive zone. Display only: the statuses come from the volume rule.
 */
export function pickInsight(weeklyVolume: MuscleVolume[]) {
  if (!weeklyVolume || weeklyVolume.length === 0) return null;

  const subject = (mv: MuscleVolume) => muscleSubject(mv.muscle_group);

  // The muscle furthest under its minimum by the sets it still needs, as
  // Progress's rows count them ("Add ~6" before "Add ~5"); on a tie, the
  // lowest share of its MEV, so 3 of 8 comes before 1 of 6.
  const below = weeklyVolume
    .filter((mv) => mv.status === 'below_mev' && mv.landmark)
    .sort(byMevDeficit)[0];
  if (below?.landmark) {
    const gap = Math.max(1, Math.ceil(mevDeficit(below)));
    return {
      volume: below,
      landmark: below.landmark,
      headline: `${subject(below).name} ${subject(below).is} under-stimulated`,
      detail: `${below.weekly_sets} sets this week — about ${gap} more to reach your minimum effective volume.`,
    };
  }

  const over = weeklyVolume
    .filter((mv) => (mv.status === 'above_mrv' || mv.status === 'approaching_mrv') && mv.landmark)
    .sort((a, b) => b.weekly_sets - a.weekly_sets)[0];
  if (over?.landmark) {
    return {
      volume: over,
      landmark: over.landmark,
      headline:
        over.status === 'above_mrv'
          ? `${subject(over).name} ${subject(over).is} past recoverable volume`
          : `${subject(over).name} ${subject(over).is} nearing ${subject(over).its} ceiling`,
      detail:
        over.status === 'above_mrv'
          ? `${over.weekly_sets} sets this week — pull back or plan a deload.`
          : `${over.weekly_sets} sets this week — hold here rather than adding more.`,
    };
  }

  const inZone = weeklyVolume.filter((mv) => mv.status === 'mav' && mv.landmark)[0];
  if (inZone?.landmark) {
    return {
      volume: inZone,
      landmark: inZone.landmark,
      headline: `${subject(inZone).name} ${subject(inZone).is} in the adaptive zone`,
      detail: `${inZone.weekly_sets} sets this week — right where growth compounds. Hold the line.`,
    };
  }

  return null;
}
