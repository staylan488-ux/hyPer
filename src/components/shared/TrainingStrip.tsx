import { motion } from 'motion/react';

/**
 * The Strip — hyPer's signature motif. A calibrated tick rail inspired by
 * plate-edge calibration marks and rack pin holes. Always encodes data:
 * sets logged, macros filled, rest remaining, or volume position.
 */

export type StripTone = 'amber' | 'sage' | 'chalk' | 'berry' | 'stone';

const TONE: Record<StripTone, string> = {
  amber: 'var(--color-accent)',
  sage: 'var(--color-sage)',
  chalk: 'var(--color-text)',
  berry: 'var(--color-danger)',
  stone: 'var(--color-stone)',
};

const EMPTY = 'color-mix(in srgb, var(--color-text) 14%, transparent)';

interface TickStripProps {
  total: number;
  filled: number;
  tone?: StripTone;
  size?: 'sm' | 'md' | 'lg';
  /** Pulse the next unfilled tick — "this one is live" */
  live?: boolean;
  className?: string;
}

/** Discrete ticks: one per set / day / item. Every 5th tick is taller, like a ruler. */
export function TickStrip({ total, filled, tone = 'amber', size = 'md', live = false, className = '' }: TickStripProps) {
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal === 0) return null;
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  const dense = safeTotal > 16;
  const heights = { sm: 8, md: 12, lg: 16 };
  const base = heights[size];

  return (
    <div
      className={`flex items-end ${dense ? 'gap-[2px]' : 'gap-[3px]'} ${className}`}
      role="img"
      aria-label={`${safeFilled} of ${safeTotal}`}
    >
      {Array.from({ length: safeTotal }, (_, i) => {
        const isFilled = i < safeFilled;
        const isLive = live && i === safeFilled;
        const tall = i % 5 === 0;
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{ backgroundColor: isFilled ? TONE[tone] : EMPTY }}
            transition={{ duration: 0.25 }}
            className={`rounded-full ${dense ? 'w-[2px]' : 'w-[3px]'} ${isLive ? 'animate-tick-live' : ''}`}
            style={{
              height: tall ? base : Math.round(base * 0.66),
              backgroundColor: isFilled ? TONE[tone] : isLive ? TONE[tone] : EMPTY,
            }}
          />
        );
      })}
    </div>
  );
}

interface RailStripProps {
  /** 0..1 (values past 1 render full and switch to the over tone) */
  value: number;
  tone?: StripTone;
  /** Marker position 0..1, e.g. "today's pace" notch */
  notch?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Tone once value exceeds 1 (default berry) */
  overTone?: StripTone;
  className?: string;
}

/** Continuous rail with an optional target notch — macros, generic progress. */
export function RailStrip({ value, tone = 'sage', notch, size = 'md', overTone = 'berry', className = '' }: RailStripProps) {
  const heights = { sm: 'h-1', md: 'h-1.5', lg: 'h-2' };
  const clamped = Math.max(0, Math.min(1, value));
  const over = value > 1.001;

  return (
    <div className={`relative ${heights[size]} rounded-full overflow-visible ${className}`} style={{ backgroundColor: EMPTY }}>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full"
        initial={false}
        animate={{ width: `${clamped * 100}%`, backgroundColor: over ? TONE[overTone] : TONE[tone] }}
        transition={{ type: 'spring', stiffness: 200, damping: 28 }}
      />
      {notch !== undefined && notch > 0 && notch <= 1 && (
        <span
          className="absolute top-1/2 -translate-y-1/2 w-px rounded-full"
          style={{
            left: `${notch * 100}%`,
            height: '160%',
            backgroundColor: 'color-mix(in srgb, var(--color-text) 45%, transparent)',
          }}
        />
      )}
    </div>
  );
}

interface VolumeRailProps {
  current: number;
  mev: number;
  mavLow: number;
  mavHigh: number;
  mrv: number;
  className?: string;
}

/** Rail with research landmark notches and a position marker — volume coaching. */
export function VolumeRail({ current, mev, mavLow, mavHigh, mrv, className = '' }: VolumeRailProps) {
  const scaleMax = Math.max(mrv * 1.12, current * 1.05, 1);
  const pos = (v: number) => `${Math.min(100, (v / scaleMax) * 100)}%`;

  return (
    <div className={`relative h-5 ${className}`}>
      {/* base rail */}
      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-1 rounded-full" style={{ backgroundColor: EMPTY }} />
      {/* MAV band — the adaptive zone */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full"
        style={{
          left: pos(mavLow),
          width: `calc(${pos(mavHigh)} - ${pos(mavLow)})`,
          backgroundColor: 'color-mix(in srgb, var(--color-sage) 38%, transparent)',
        }}
      />
      {/* landmark notches */}
      {[mev, mavLow, mavHigh, mrv].map((v, i) => (
        <span
          key={i}
          className="absolute top-1/2 -translate-y-1/2 w-px h-3 rounded-full"
          style={{ left: pos(v), backgroundColor: 'color-mix(in srgb, var(--color-text) 35%, transparent)' }}
        />
      ))}
      {/* current position marker */}
      <motion.span
        className="absolute top-1/2 w-2 h-2 rotate-45"
        initial={false}
        animate={{ left: pos(current) }}
        transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        style={{
          translateY: '-50%',
          translateX: '-50%',
          backgroundColor:
            current > mrv ? 'var(--color-danger)' : current < mev ? 'var(--color-stone)' : 'var(--color-accent)',
        }}
      />
    </div>
  );
}
