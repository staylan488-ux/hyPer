import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';

interface LandmarkRailProps {
  current: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  /** Past recoverable volume (from the volume status): marks in lacquer. */
  over?: boolean;
  /** Session-stable key: slide the marker in from zero on first appearance. */
  reveal?: string;
  className?: string;
}

/**
 * Weekly sets against the research landmarks: a hairline scale with the
 * adaptive band drawn in, MEV and MRV ticks named underneath, and an ink
 * marker for this week (lacquer only past MRV).
 */
export function LandmarkRail({ current, mev, mavLow, mavHigh, mrv, over: overStatus, reveal, className = '' }: LandmarkRailProps) {
  const firstReveal = useFirstReveal(reveal);
  const scaleMax = Math.max(mrv * 1.2, current * 1.08, 1);
  const share = (value: number) => Math.min(1, Math.max(0, value / scaleMax));
  const pos = (value: number) => `${share(value) * 100}%`;
  const over = overStatus ?? current > mrv;
  const under = current < mev;
  // Names sit centred under their ticks; MAV's is dropped when the band is
  // too close to a tick for both to fit.
  const bandCentre = (mavLow + mavHigh) / 2;
  const showMav = share(bandCentre) - share(mev) > 0.11 && share(mrv) - share(bandCentre) > 0.11;
  const ticks = [
    { key: 'mev', value: mev, label: 'MEV' },
    { key: 'mrv', value: mrv, label: 'MRV' },
  ];

  return (
    <div className={className} role="img" aria-label={`${current} sets this week. MEV ${mev}, MAV ${mavLow} to ${mavHigh}, MRV ${mrv}.`}>
      <div className="relative h-4">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--color-border)]" />
        <span
          className="absolute top-1/2 h-[3px] -translate-y-1/2 bg-[color-mix(in_srgb,var(--color-text)_28%,transparent)]"
          style={{ left: pos(mavLow), width: `calc(${pos(mavHigh)} - ${pos(mavLow)})` }}
        />
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[var(--color-border-strong)]"
            style={{ left: pos(tick.value) }}
          />
        ))}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={firstReveal ? { x: '0%' } : false}
          animate={{ x: pos(current) }}
          transition={firstReveal ? { ...springs.heavy, delay: 0.1 } : springs.settle}
        >
          <span
            className="absolute left-0 top-0 h-4 w-[2px] -translate-x-1/2"
            style={{ backgroundColor: over ? 'var(--color-accent)' : under ? 'var(--color-text-dim)' : 'var(--color-text)' }}
          />
        </motion.div>
      </div>
      <div className="relative h-4 mt-1.5 text-[10px] leading-4 tracking-[0.08em] text-[var(--color-muted)] tabular-nums" aria-hidden>
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className={`absolute top-0 whitespace-nowrap ${share(tick.value) < 0.08 ? '' : '-translate-x-1/2'}`}
            style={{ left: pos(tick.value) }}
          >
            {tick.label} {tick.value}
          </span>
        ))}
        {showMav && (
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: pos(bandCentre) }}>
            MAV
          </span>
        )}
      </div>
    </div>
  );
}
