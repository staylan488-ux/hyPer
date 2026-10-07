import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';

/**
 * The Strip — FOLIO's calibration motif. Hairline ticks and rules that always
 * encode data: sets logged, macros filled, rest remaining, volume position.
 * Flat ink marks on a faint track — no gradient, no rounding.
 *
 * Kinetic: every fill moves by transform (scaleX / translateX), never width or
 * left. Pass `reveal` (a stable metric key) to draw the fill in from empty the
 * first time that metric appears in this session; later visits render settled.
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
  /** Session-stable key: fill the ticks in sequence on first appearance. */
  reveal?: string;
  className?: string;
}

/** Discrete tick segments: one per set / day / item. Thin ledger marks when dense. */
export function TickStrip({ total, filled, tone = 'chalk', size = 'md', live = false, reveal, className = '' }: TickStripProps) {
  const firstReveal = useFirstReveal(reveal);
  const safeTotal = Math.max(0, Math.floor(total));
  if (safeTotal === 0) return null;
  const safeFilled = Math.min(safeTotal, Math.max(0, Math.floor(filled)));
  const dense = safeTotal > 12;

  const dims = dense
    ? 'w-[2px] h-3'
    : {
        sm: 'w-3.5 h-[2px]',
        md: 'w-5 h-[2px]',
        lg: 'w-7 h-[3px]',
      }[size];
  // Dense strips stack vertical ledger marks, so their ink rises; horizontal
  // ticks draw left to right.
  const axis = dense ? 'scaleY' : 'scaleX';
  const origin = dense ? '50% 100%' : '0% 50%';
  // Keep the sequence brisk however long the strip is.
  const step = Math.min(0.045, 0.5 / Math.max(1, safeFilled));

  return (
    <div
      className={`flex items-center ${dense ? 'gap-[2px]' : 'gap-1.5'} ${className}`}
      role="img"
      aria-label={`${safeFilled} of ${safeTotal}`}
    >
      {Array.from({ length: safeTotal }, (_, i) => {
        const isFilled = i < safeFilled;
        const isLive = live && i === safeFilled;
        const inked = isFilled || isLive;
        return (
          <span
            key={i}
            className={`relative block overflow-hidden ${dims} ${isLive ? 'animate-tick-live' : ''}`}
            style={{ backgroundColor: EMPTY }}
          >
            <motion.span
              className="absolute inset-0 block"
              initial={firstReveal && inked ? { [axis]: 0 } : false}
              animate={{ [axis]: inked ? 1 : 0 }}
              transition={
                firstReveal && inked
                  ? { ...springs.settle, delay: 0.08 + i * step }
                  : springs.settle
              }
              style={{ backgroundColor: TONE[tone], transformOrigin: origin }}
            />
          </span>
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
  /** Session-stable key: fill from empty the first time this rail appears. */
  reveal?: string;
  className?: string;
}

/** Continuous rail with an optional target notch — macros, generic progress.
 * Ink tones fill the groove with a polished metal bar; over and accent
 * tones stay lacquer. */
export function RailStrip({ value, tone = 'chalk', notch, size = 'md', overTone = 'berry', reveal, className = '' }: RailStripProps) {
  const firstReveal = useFirstReveal(reveal);
  const heights = { sm: 'h-[4px]', md: 'h-[5px]', lg: 'h-[6px]' };
  const clamped = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  const over = value > 1.001;
  const fillTone = over ? overTone : tone;
  const metal = fillTone === 'chalk' || fillTone === 'sage';

  return (
    <div className={`relative ${heights[size]} overflow-visible ${className}`}>
      <div className="rail-groove absolute inset-0 overflow-hidden">
        <motion.div
          className={`absolute inset-0 ${metal ? 'rail-metal' : ''}`}
          initial={firstReveal ? { scaleX: 0 } : false}
          animate={{ scaleX: clamped }}
          transition={firstReveal ? { ...springs.heavy, bounce: 0, delay: 0.12 } : springs.settle}
          style={{
            backgroundColor: metal ? undefined : TONE[fillTone],
            transformOrigin: '0% 50%',
            transition: 'background-color 380ms var(--ease-out-quart)',
          }}
        />
      </div>
      {notch !== undefined && notch > 0 && notch <= 1 && (
        <span
          className="absolute top-1/2 -translate-y-1/2 w-px"
          style={{
            left: `${notch * 100}%`,
            height: '220%',
            // A neutral target tick at 3:1 or more. Lacquer is for live and over.
            backgroundColor: 'var(--rail-target)',
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
  /** Session-stable key: slide the marker in from zero on first appearance. */
  reveal?: string;
  className?: string;
}

/** Rail with research landmark notches and a position marker — volume coaching. */
export function VolumeRail({ current, mev, mavLow, mavHigh, mrv, reveal, className = '' }: VolumeRailProps) {
  const firstReveal = useFirstReveal(reveal);
  const scaleMax = Math.max(mrv * 1.12, current * 1.05, 1);
  const fraction = (v: number) => Math.min(1, Math.max(0, v / scaleMax));
  const pos = (v: number) => `${fraction(v) * 100}%`;

  return (
    <div className={`relative h-5 ${className}`}>
      {/* base rail */}
      <div className="rail-groove absolute top-1/2 -translate-y-1/2 inset-x-0 h-[4px]" />
      {/* MAV band — the adaptive zone */}
      <div
        className="rail-metal absolute top-1/2 -translate-y-1/2 h-[4px] rounded-full opacity-45"
        style={{
          left: pos(mavLow),
          width: `calc(${pos(mavHigh)} - ${pos(mavLow)})`,
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
      {/* current position marker: a full-width carrier translated by a share
          of its own width, so the marker moves on the compositor */}
      <motion.div
        className="absolute inset-0 pointer-events-none"
        initial={firstReveal ? { x: '0%' } : false}
        animate={{ x: pos(current) }}
        transition={firstReveal ? { ...springs.heavy, delay: 0.1 } : springs.settle}
      >
        <span
          className="absolute left-0 top-1/2 w-[3px] h-5 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{
            backgroundColor:
              current > mrv ? 'var(--color-accent)' : current < mev ? 'var(--color-text-dim)' : 'var(--color-text)',
          }}
        />
      </motion.div>
    </div>
  );
}
