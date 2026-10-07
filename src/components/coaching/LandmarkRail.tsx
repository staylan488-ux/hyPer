import { useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';
import { LEADING_SHARE, mavLabelPlacement } from '@/lib/landmarkLabels';

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
 * adaptive band drawn in, MEV, MAV and MRV named with their numbers
 * underneath, and an ink marker for this week, labelled with its value
 * above so it never reads as another tick (lacquer only past MRV).
 */
export function LandmarkRail({ current, mev, mavLow, mavHigh, mrv, over: overStatus, reveal, className = '' }: LandmarkRailProps) {
  const firstReveal = useFirstReveal(reveal);
  // The rail's own width places the band's name; the phone's ~354px until
  // it is measured.
  const railRef = useRef<HTMLDivElement>(null);
  const [rail, setRail] = useState(354);
  useLayoutEffect(() => {
    const element = railRef.current;
    if (!element) return;
    const sync = () => {
      if (element.clientWidth > 0) setRail(element.clientWidth);
    };
    sync();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scaleMax = Math.max(mrv * 1.2, current * 1.08, 1);
  const share = (value: number) => Math.min(1, Math.max(0, value / scaleMax));
  const pos = (value: number) => `${share(value) * 100}%`;
  const over = overStatus ?? current > mrv;
  const under = current < mev;
  // Names sit centred under their ticks. The band's name keeps its range,
  // sliding off the band's centre as far as it must to clear both
  // neighbours; only without room does it fall back to "MAV", or drop.
  const mavLabel = mavLabelPlacement({ mev, mavLow, mavHigh, mrv, share, rail });
  const currentShare = share(current);
  const markerTone = over ? 'var(--color-accent)' : under ? 'var(--color-text-dim)' : 'var(--color-text)';
  const ticks = [
    { key: 'mev', value: mev, label: 'MEV' },
    { key: 'mrv', value: mrv, label: 'MRV' },
  ];

  return (
    <div className={className} role="img" aria-label={`${current} sets this week. MEV ${mev}, MAV ${mavLow} to ${mavHigh}, MRV ${mrv}.`}>
      <div className="relative h-4 mt-4">
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
            style={{ backgroundColor: markerTone }}
          />
          <span
            className={`absolute left-0 -top-4 text-[11px] leading-4 font-semibold tabular-nums whitespace-nowrap ${
              currentShare < 0.04 ? '-translate-x-[1px]' : currentShare > 0.96 ? '-translate-x-full' : '-translate-x-1/2'
            }`}
            style={{ color: markerTone }}
            aria-hidden
          >
            {current}
          </span>
        </motion.div>
      </div>
      <div ref={railRef} className="relative h-4 mt-1.5 text-[10px] leading-4 tracking-[0.08em] text-[var(--color-muted)] tabular-nums" aria-hidden>
        {ticks.map((tick) => (
          <span
            key={tick.key}
            className={`absolute top-0 whitespace-nowrap ${share(tick.value) < LEADING_SHARE ? '' : '-translate-x-1/2'}`}
            style={{ left: pos(tick.value) }}
          >
            {tick.label} {tick.value}
          </span>
        ))}
        {mavLabel && (
          <span className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: mavLabel.x }}>
            {mavLabel.text}
          </span>
        )}
      </div>
    </div>
  );
}
