import { useEffect, useRef } from 'react';
import { emitBurstFrom } from '@/lib/fx';
import { celebrationHaptic } from '@/lib/haptics';
import { claimSealCelebration, isTargetMet, type SealMacro } from '@/lib/targetSeal';

interface TargetSealOptions {
  macro: SealMacro;
  current: number;
  target: number;
  /** YYYY-MM-DD of the day being shown. */
  dayKey: string;
  /** Only the live day celebrates; past days just show the mark. */
  live: boolean;
}

/**
 * Whether a day's macro target is met, plus the once-a-day celebration: a
 * success haptic and an ink burst from the mark after its rail has filled.
 */
export function useTargetSeal({ macro, current, target, dayKey, live }: TargetSealOptions) {
  const met = isTargetMet(macro, current, target);
  const anchorRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!met || !live) return;
    // Claim inside the timer so an effect replay cannot spend the moment.
    const timer = window.setTimeout(() => {
      if (!claimSealCelebration(dayKey, macro)) return;
      celebrationHaptic();
      emitBurstFrom(anchorRef.current, { palette: macro === 'protein' ? 'ink' : 'lacquer', count: 42, power: 0.85 });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [met, live, dayKey, macro]);

  return { met, anchorRef };
}

