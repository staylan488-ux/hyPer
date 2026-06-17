import { motion } from 'motion/react';

/**
 * The Strip — FOLIO's calibration motif. Hairline ticks and rules that always
 * encode data: sets logged, macros filled, rest remaining, volume position.
 * Flat ink marks on a faint track — no glow, no gradient, no rounding.
 */

export type StripTone = 'amber' | 'sage' | 'chalk' | 'berry' | 'stone';

const TONE: Record<StripTone, string> = {
  amber: 'var(--color-accent)',
  sage: 'var(--color-text)',
  chalk: 'var(--color-text)',
  berry: 'var(--color-accent)',
  stone: 'var(--color-text-dim)',
};

const EMPTY = 'var(--strip-track)';

interface TickStripProps {
  total: number;
  filled: number;
  tone?: StripTone;
  size?: 'sm' | 'md' | 'lg';
  /** Mark the next unfilled tick — "this one is live" */
  live?: boolean;
  className?: string;
}

/** Discrete tick segments: one per set / day / item. Thin ledger marks when dense. */
export function TickStrip({ total, filled, tone = 'chalk', size = 'md', live = false, className = '' }: TickStripProps) {
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal === 0) return null;
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  const dense = safeTotal > 12;

  if (dense) {
    return (
      <div className={`flex items-center gap-[2px] ${className}`} role="img" aria-label={`${safeFilled} of ${safeTotal}`}>
        {Array.from({ length: safeTotal }, (_, i) => {
          const isFilled = i < safeFilled;
          const isLive = live && i === safeFilled;
          return (
            <span
              key={i}
              className={`w-[2px] h-3 ${isLive ? 'animate-tick-live' : ''}`}
              style={{ backgroundColor: isFilled || isLive ? TONE[tone] : EMPTY }}
            />
          );
        })}
      </div>
    );
  }

  const dims = {
    sm: 'w-3.5 h-[2px]',
    md: 'w-5 h-[2px]',
    lg: 'w-7 h-[3px]',
  }[size];

  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="img" aria-label={`${safeFilled} of ${safeTotal}`}>
      {Array.from({ length: safeTotal }, (_, i) => {
        const isFilled = i < safeFilled;
        const isLive = live && i === safeFilled;
        return (
          <motion.span
            key={i}
            initial={false}
            animate={{ backgroundColor: isFilled || isLive ? TONE[tone] : EMPTY }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={`${dims} ${isLive ? 'animate-tick-live' : ''}`}
            style={{ backgroundColor: isFilled || isLive ? TONE[tone] : EMPTY }}
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
  /** Marker position 0..1, e.g. target line */
  notch?: number;
  size?: 'sm' | 'md' | 'lg';
  /** Tone once value exceeds 1 (default accent) */
  overTone?: StripTone;
  className?: string;
}

/** Continuous rail with an optional target notch — macros, generic progress. */
export function RailStrip({ value, tone = 'chalk', notch, size = 'md', overTone = 'berry', className = '' }: RailStripProps) {
  const heights = { sm: 'h-[2px]', md: 'h-[3px]', lg: 'h-1' };
  const clamped = Math.max(0, Math.min(1, value));
  const over = value > 1.001;

  return (
    <div className={`relative ${heights[size]} overflow-visible ${className}`} style={{ backgroundColor: EMPTY }}>
      <motion.div
        className="absolute inset-y-0 left-0"
        initial={false}
        animate={{ width: `${clamped * 100}%`, backgroundColor: over ? TONE[overTone] : TONE[tone] }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{ backgroundColor: over ? TONE[overTone] : TONE[tone] }}
      />
      {notch !== undefined && notch > 0 && notch <= 1 && (
        <span
          className="absolute top-1/2 -translate-y-1/2 w-px"
          style={{
            left: `${notch * 100}%`,
            height: '260%',
            backgroundColor: 'var(--color-accent)',
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
      <div className="absolute top-1/2 -translate-y-1/2 inset-x-0 h-px" style={{ backgroundColor: EMPTY }} />
      {/* MAV band — the adaptive zone */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-[3px]"
        style={{
          left: pos(mavLow),
          width: `calc(${pos(mavHigh)} - ${pos(mavLow)})`,
          backgroundColor: 'color-mix(in srgb, var(--color-text) 30%, transparent)',
        }}
      />
      {/* landmark notches */}
      {[mev, mavLow, mavHigh, mrv].map((v, i) => (
        <span
          key={i}
          className="absolute top-1/2 -translate-y-1/2 w-px h-3"
          style={{ left: pos(v), backgroundColor: 'color-mix(in srgb, var(--color-text) 32%, transparent)' }}
        />
      ))}
      {/* current position marker */}
      <motion.span
        className="absolute top-1/2 w-[2px] h-5"
        initial={false}
        animate={{ left: pos(current) }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        style={{
          translateY: '-50%',
          translateX: '-50%',
          backgroundColor:
            current > mrv ? 'var(--color-accent)' : current < mev ? 'var(--color-text-dim)' : 'var(--color-text)',
        }}
      />
    </div>
  );
}
