import { type ReactNode } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';
import { useScrub } from './useScrub';

export interface BarDatum {
  key: string;
  /** Axis label under the bar. */
  label: string;
  value: number;
  /** Ink the bar in Lacquer (peak week, fastest lap). */
  emphasis?: boolean;
  /** What the readout says while this bar is selected. */
  readout: ReactNode;
  /** Spoken description of the bar. */
  ariaLabel: string;
  /** Optional figure printed above the bar. */
  caption?: ReactNode;
}

interface BarChartProps {
  data: BarDatum[];
  /** Height of the bar field in px. */
  height?: number;
  /** Top of the value axis; defaults to the largest value. */
  max?: number;
  /** Dashed target line, in value units. */
  target?: number;
  /** Readout shown when nothing is selected. */
  summary: ReactNode;
  /** Session-stable key: grow the bars in on first appearance. */
  reveal?: string;
  /** Accessible name for the chart as a whole. */
  label: string;
  /** Minimum visible bar height for non-zero values, px. */
  minBar?: number;
  className?: string;
}

/**
 * Editorial bar chart: flat ink columns on a hairline baseline. Bars grow by
 * scaleY on first appearance; a finger scrubs across them with one detent per
 * bar and the readout line above follows.
 */
export function BarChart({
  data,
  height = 96,
  max,
  target,
  summary,
  reveal,
  label,
  minBar = 3,
  className = '',
}: BarChartProps) {
  const firstReveal = useFirstReveal(reveal);
  const { ref, active, scrubbing, bind } = useScrub({ count: data.length, layout: 'band' });
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), target ?? 0, Number.EPSILON);
  const selecting = active !== null;
  // Captions sit above their bar inside the field, so reserve their line.
  const barArea = data.some((d) => d.caption !== undefined) ? Math.max(24, height - 24) : height;

  return (
    <div className={className}>
      <div className="min-h-[2.75rem] flex items-end pb-3" aria-live="polite">
        <motion.div
          key={active ?? 'summary'}
          className="t-data-sm text-[var(--color-text)] w-full"
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.tactile}
        >
          {active !== null ? data[active]?.readout : summary}
        </motion.div>
      </div>

      <div
        ref={ref}
        role="group"
        aria-label={`${label}. Use left and right arrows to read each bar.`}
        tabIndex={0}
        className={`relative flex items-end gap-px border-b border-[var(--color-border-strong)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-strong)] select-none ${scrubbing ? 'cursor-grabbing' : 'cursor-pointer'}`}
        style={{ height, ...bind.style }}
        onPointerDown={bind.onPointerDown}
        onPointerMove={bind.onPointerMove}
        onPointerUp={bind.onPointerUp}
        onPointerCancel={bind.onPointerCancel}
        onKeyDown={bind.onKeyDown}
      >
        {target !== undefined && target > 0 && (
          <div
            aria-hidden
            className="absolute inset-x-0 border-t border-dashed border-[var(--color-border-strong)] pointer-events-none"
            style={{ bottom: Math.min(1, target / top) * barArea }}
          />
        )}
        {data.map((d, i) => {
          const fraction = d.value > 0 ? Math.max(minBar / barArea, Math.min(1, d.value / top)) : 0;
          const isActive = active === i;
          return (
            <div
              key={d.key}
              aria-label={d.ariaLabel}
              role="img"
              className="relative flex-1 h-full flex flex-col justify-end items-center"
            >
              {d.caption !== undefined && (
                <motion.span
                  aria-hidden
                  className={`t-data-sm tabular-nums mb-1.5 ${d.emphasis ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'}`}
                  initial={firstReveal ? { opacity: 0 } : false}
                  animate={{ opacity: selecting && !isActive ? 0.35 : 1 }}
                  transition={firstReveal ? { duration: 0.3, delay: 0.3 + i * 0.04 } : { duration: 0.18 }}
                >
                  {d.caption}
                </motion.span>
              )}
              <div className="relative w-full shrink-0" style={{ height: fraction * barArea }}>
                <motion.div
                  aria-hidden
                  className="absolute inset-0"
                  initial={firstReveal ? { scaleY: 0 } : false}
                  animate={{ scaleY: 1, opacity: selecting && !isActive ? 0.28 : 1 }}
                  transition={
                    firstReveal
                      ? { scaleY: { ...springs.heavy, delay: 0.06 + i * 0.045 }, opacity: { duration: 0.18 } }
                      : { opacity: { duration: 0.18 } }
                  }
                  style={{
                    transformOrigin: '50% 100%',
                    backgroundColor: d.emphasis ? 'var(--color-accent)' : 'var(--color-text)',
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-px mt-2" aria-hidden>
        {data.map((d, i) => (
          <span
            key={d.key}
            className={`flex-1 text-center t-caption transition-colors duration-150 ${active === i ? 'text-[var(--color-text)]' : ''}`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
