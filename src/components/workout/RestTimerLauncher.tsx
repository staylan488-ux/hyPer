import { motion } from 'motion/react';
import { Timer } from 'lucide-react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

interface RestTimerLauncherProps {
  /** Start a fresh rest timer by hand (no set logged). */
  onStart: () => void;
}

/**
 * Idle affordance docked where the rest timer lives. Lets the user start a rest
 * mid-workout (e.g. between warm-ups, or just a breather) without logging a set;
 * tapping it hands off to RestTimerPill in the exact same spot, so the dock
 * never shifts.
 */
export function RestTimerLauncher({ onStart }: RestTimerLauncherProps) {
  const handleClick = () => {
    tapHaptic();
    onStart();
  };

  return (
    <motion.div
      key="rest-launcher"
      className="fixed left-0 right-0 z-40 pointer-events-none"
      style={{ bottom: 'calc(5.9rem + env(safe-area-inset-bottom, 0px))' }}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
    >
      <div className="max-w-lg mx-auto px-5 flex justify-center">
        <button
          type="button"
          onClick={handleClick}
          aria-label="Start rest timer"
          className="pressable pointer-events-auto inline-flex items-center gap-2.5 pl-2.5 pr-4 py-2.5 bg-[var(--color-surface-2)] border border-[var(--color-border-strong)] hover:bg-[var(--color-surface-3)] transition-colors"
        >
          <span className="shrink-0 w-[3px] h-4 bg-[var(--color-accent)]" aria-hidden />
          <Timer className="w-3.5 h-3.5 text-[var(--color-text-dim)]" strokeWidth={1.75} />
          <span className="t-label-sm text-[var(--color-text-dim)]">Start rest</span>
        </button>
      </div>
    </motion.div>
  );
}
