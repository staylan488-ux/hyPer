import { useId, type ReactNode } from 'react';
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

/** Flat, matte columns: ink for data, lacquer only for an emphasised bar. */
const INK_FILL = 'color-mix(in srgb, var(--color-text) 82%, var(--color-base))';
const ACCENT_FILL = 'var(--color-accent)';

/**
 * Editorial bar chart: flat ink columns on a hairline baseline. Bars
 * grow by scaleY on first appearance; a finger scrubs across them with one
 * detent per bar, a quiet band marks the selected column and the readout line
 * above follows.
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
  const lensId = useId();
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
        className={`relative flex items-end border-b border-[var(--color-border)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-strong)] focus-visible:rounded-[6px] select-none ${scrubbing ? 'cursor-grabbing' : 'cursor-pointer'}`}
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
            className="absolute inset-x-0 z-[1] border-t border-dashed border-[var(--color-border-strong)] pointer-events-none"
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
              {isActive && (
                <motion.div
                  aria-hidden
                  layoutId={lensId}
                  className="absolute inset-y-0 inset-x-[8%] pointer-events-none"
                  style={{ background: 'color-mix(in srgb, var(--color-text) 5%, transparent)' }}
                  transition={springs.tactile}
                />
              )}
              {d.caption !== undefined && (
                <motion.span
                  aria-hidden
                  className={`relative t-data-sm tabular-nums whitespace-nowrap mb-1.5 ${d.emphasis ? 'text-[var(--color-accent)]' : d.value > 0 ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}
                  initial={firstReveal ? { opacity: 0 } : false}
                  animate={{ opacity: selecting && !isActive ? 0.35 : 1 }}
                  transition={firstReveal ? { duration: 0.3, delay: 0.3 + i * 0.04 } : { duration: 0.18 }}
                >
                  {d.caption}
                </motion.span>
              )}
              <div className="relative w-[58%] max-w-[30px] min-w-[3px] shrink-0" style={{ height: fraction * barArea }}>
                <motion.div
                  aria-hidden
                  className="absolute inset-0 rounded-t-[3px]"
                  initial={firstReveal ? { scaleY: 0 } : false}
                  animate={{ scaleY: 1, opacity: selecting && !isActive ? 0.28 : 1 }}
                  transition={
                    firstReveal
                      ? { scaleY: { ...springs.heavy, delay: 0.06 + i * 0.045 }, opacity: { duration: 0.18 } }
                      : { opacity: { duration: 0.18 } }
                  }
                  style={{
                    transformOrigin: '50% 100%',
                    background: d.emphasis ? ACCENT_FILL : INK_FILL,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex mt-2.5" aria-hidden>
        {data.map((d, i) => (
          <span
            key={d.key}
            className={`flex-1 min-w-0 text-center text-[11px] leading-[1.3] tracking-[0.01em] tabular-nums whitespace-nowrap transition-colors duration-150 ${active === i ? 'text-[var(--color-text)] font-medium' : 'text-[var(--color-muted)]'}`}
          >
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
