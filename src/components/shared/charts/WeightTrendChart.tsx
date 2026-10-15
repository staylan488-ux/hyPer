import { useId, useMemo, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { format, parseISO } from 'date-fns';
import type { WeightTrendPoint } from '@/lib/weightTrend';
import { linearScale, monotonePath, paddedDomain, xAtIndex } from '@/lib/chartGeometry';
import { springs } from '@/lib/animations';
import { useFirstReveal } from '@/lib/motionPolicy';
import { useElementWidth, useScrub } from './useScrub';

interface WeightTrendChartProps {
  points: WeightTrendPoint[];
  /** Days of history to show, counted back from the latest point. */
  days?: number;
  height?: number;
  /** Converts kilograms to the display unit. */
  toUnit: (kg: number) => number;
  unit: string;
  /** Readout when nothing is selected. */
  summary: ReactNode;
  /** Compact sparkline: no axis labels, lighter dots. */
  compact?: boolean;
  reveal?: string;
  className?: string;
}

const PAD_Y = 10;

/**
 * Smoothed body-weight trend: the trend line draws itself in, raw weigh-ins
 * sit around it as dots (outliers hollow), and a finger scrubs day by day.
 */
export function WeightTrendChart({
  points,
  days = 60,
  height = 160,
  toUnit,
  unit,
  summary,
  compact = false,
  reveal,
  className = '',
}: WeightTrendChartProps) {
  const firstReveal = useFirstReveal(reveal);
  const gradientId = useId();
  const series = useMemo(() => points.slice(-days), [points, days]);
  const { ref, active, bind } = useScrub({ count: series.length, layout: 'point' });
  const width = useElementWidth(ref, series.length >= 2);

  const geometry = useMemo(() => {
    if (series.length < 2 || width <= 0) return null;
    const values = series.flatMap((p) => [toUnit(p.ewmaKg), ...(p.observedKg != null ? [toUnit(p.observedKg)] : [])]);
    const domain = paddedDomain(values, 0.14, unit === 'lb' ? 2 : 1);
    const y = linearScale(domain, [height - PAD_Y, PAD_Y]);
    const x = (i: number) => xAtIndex(i, width, series.length, 'point');
    const line = series.map((p, i) => ({ x: x(i), y: y(toUnit(p.ewmaKg)) }));
    const path = monotonePath(line);
    const area = `${path}L${width},${height}L0,${height}Z`;
    const dots = series.flatMap((p, i) =>
      p.observedKg == null ? [] : [{ i, x: x(i), y: y(toUnit(p.observedKg)), outlier: p.isOutlier }],
    );
    return { line, path, area, dots, domain };
  }, [series, width, height, toUnit, unit]);

  if (series.length < 2) return null;

  const selected = active !== null ? series[active] : null;
  const readout = selected ? (
    <span className="flex items-baseline justify-between gap-3">
      <span>{format(parseISO(selected.date), 'EEE, MMM d')}</span>
      <span className="flex items-baseline gap-3">
        {selected.observedKg != null && (
          <span className="text-[var(--color-text-dim)]">
            weighed {toUnit(selected.observedKg).toFixed(1)}
          </span>
        )}
        <span>
          trend {toUnit(selected.ewmaKg).toFixed(1)} {unit}
        </span>
      </span>
    </span>
  ) : (
    summary
  );

  const activePoint = active !== null && geometry ? geometry.line[active] : null;

  return (
    <div className={className}>
      <div className={`${compact ? 'min-h-[1.75rem] pb-2' : 'min-h-[2.75rem] pb-3'} flex items-end`} aria-live="polite">
        <motion.div
          key={active ?? 'summary'}
          className="t-data-sm text-[var(--color-text)] w-full"
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={springs.tactile}
        >
          {readout}
        </motion.div>
      </div>

      <div
        ref={ref}
        role="group"
        tabIndex={0}
        aria-label={`Body weight trend, last ${series.length} days. Use left and right arrows to read each day.`}
        className="relative outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-border-strong)] select-none cursor-pointer"
        style={{ height, ...bind.style }}
        onPointerDown={bind.onPointerDown}
        onPointerMove={bind.onPointerMove}
        onPointerUp={bind.onPointerUp}
        onPointerCancel={bind.onPointerCancel}
        onKeyDown={bind.onKeyDown}
      >
        {geometry && (
          <svg width={width} height={height} className="absolute inset-0 overflow-visible" aria-hidden>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-text)" stopOpacity={compact ? 0.08 : 0.1} />
                <stop offset="100%" stopColor="var(--color-text)" stopOpacity={0} />
              </linearGradient>
            </defs>

            {!compact && (
              <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--color-border-strong)" strokeWidth={1} />
            )}

            <motion.path
              d={geometry.area}
              fill={`url(#${gradientId})`}
              initial={firstReveal ? { opacity: 0 } : false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: firstReveal ? 0.5 : 0 }}
            />

            {geometry.dots.map((dot) => (
              <motion.circle
                key={dot.i}
                cx={dot.x}
                cy={dot.y}
                r={compact ? 1.5 : 2.25}
                fill={dot.outlier ? 'none' : 'var(--color-text-dim)'}
                stroke={dot.outlier ? 'var(--color-text-dim)' : 'none'}
                strokeWidth={1}
                initial={firstReveal ? { opacity: 0, scale: 0 } : false}
                animate={{ opacity: active === null || active === dot.i ? (compact ? 0.55 : 0.7) : 0.25, scale: 1 }}
                transition={firstReveal ? { ...springs.lift, delay: 0.2 + (dot.x / width) * 0.7 } : { duration: 0.15 }}
                style={{ transformOrigin: `${dot.x}px ${dot.y}px` }}
              />
            ))}

            <motion.path
              d={geometry.path}
              fill="none"
              stroke="var(--color-text)"
              strokeWidth={compact ? 1.5 : 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={firstReveal ? { pathLength: 0 } : false}
              animate={{ pathLength: 1 }}
              transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
            />

            {/* latest point marker */}
            {active === null && (
              <motion.circle
                cx={geometry.line[geometry.line.length - 1].x}
                cy={geometry.line[geometry.line.length - 1].y}
                r={compact ? 3 : 3.5}
                fill="var(--color-accent)"
                initial={firstReveal ? { scale: 0 } : false}
                animate={{ scale: 1 }}
                transition={{ ...springs.lift, delay: firstReveal ? 1.05 : 0 }}
                style={{
                  transformOrigin: `${geometry.line[geometry.line.length - 1].x}px ${geometry.line[geometry.line.length - 1].y}px`,
                }}
              />
            )}

            {activePoint && (
              <g>
                <line
                  x1={activePoint.x}
                  x2={activePoint.x}
                  y1={0}
                  y2={height}
                  stroke="var(--color-border-strong)"
                  strokeWidth={1}
                />
                <circle cx={activePoint.x} cy={activePoint.y} r={4} fill="var(--color-base)" stroke="var(--color-text)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
      </div>

      {!compact && geometry && (
        <div className="flex justify-between mt-2 t-caption" aria-hidden>
          <span>{format(parseISO(series[0].date), 'MMM d')}</span>
          <span>
            {geometry.domain[0].toFixed(0)}–{geometry.domain[1].toFixed(0)} {unit}
          </span>
          <span>{format(parseISO(series[series.length - 1].date), 'MMM d')}</span>
        </div>
      )}
    </div>
  );
}
