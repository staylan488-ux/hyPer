import { useEffect, useState } from 'react';
import { motion, useSpring, useTransform } from 'motion/react';

interface MacroGaugeProps {
  label: string;
  current: number;
  target: number;
  unit: string;
  color?: 'default' | 'accent' | 'sage' | 'rose';
  variant?: 'compact' | 'hero';
  loading?: boolean;
}

export function MacroGauge({ label, current, target, unit, color = 'default', variant = 'compact', loading = false }: MacroGaugeProps) {
  const percentage = Math.min((current / target) * 100, 100);
  const isOver = current > target;
  const isHit = percentage >= 100;

  const strokeColors = {
    default: 'var(--color-muted)',
    accent: 'var(--color-accent)',
    sage: 'var(--color-sage)',
    rose: 'var(--color-rose)',
  };

  const textColors = {
    default: 'var(--color-text)',
    accent: 'var(--color-accent)',
    sage: 'var(--color-sage)',
    rose: 'var(--color-rose)',
  };

  // Animated count-up
  const spring = useSpring(0, { stiffness: 60, damping: 20 });
  const displayValue = useTransform(spring, (v) => Math.round(v));
  const [countValue, setCountValue] = useState(0);

  useEffect(() => {
    spring.set(current);
    const unsubscribe = displayValue.on('change', (v) => setCountValue(v));
    return unsubscribe;
  }, [current, spring, displayValue]);

  // Animated arc
  const arcSpring = useSpring(0, { stiffness: 60, damping: 20 });
  const [arcValue, setArcValue] = useState(0);

  useEffect(() => {
    arcSpring.set(percentage * 0.977);
    const unsubscribe = arcSpring.on('change', (v) => setArcValue(v));
    return unsubscribe;
  }, [percentage, arcSpring]);

  // Hero variant - big numbers with gradient bar
  if (variant === 'hero') {
    return (
      <div className="flex flex-col">
        <p className="text-[9px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">{label}</p>

        {loading ? (
          <>
            <div className="shimmer h-10 w-24 mb-3" />
            <div className="relative h-2 bg-[var(--color-surface-high)] rounded-full overflow-hidden mb-2" />
            <div className="shimmer h-3 w-16" />
          </>
        ) : (
          <>
            <motion.p
              className="number-hero mb-3 tabular-nums"
              style={{ color: textColors[color] }}
            >
              {countValue.toLocaleString()}
            </motion.p>

            {/* Gradient progress bar */}
            <div className="relative h-2 bg-[var(--color-surface-high)] rounded-full overflow-hidden mb-2">
              <motion.div
                className={`h-full ${color === 'accent' ? 'gradient-progress-accent' : color === 'sage' ? 'gradient-progress-sage' : 'bg-[var(--color-muted)]'}`}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(percentage, 100)}%` }}
                transition={{ duration: 1, ease: 'easeOut' }}
              />
            </div>

            <p className="text-xs text-[var(--color-muted)] tabular-nums">
              /{target}{unit}
            </p>
          </>
        )}
      </div>
    );
  }

  // Compact variant - original ring design
  return (
    <div className={`flex flex-col items-center p-3 rounded-[20px] bg-[var(--color-surface)] border border-[var(--color-border)] ${!loading && isHit ? 'animate-pulse-glow' : ''}`}>
      <p className="text-[9px] tracking-[0.2em] uppercase text-[var(--color-muted)] mb-2">{label}</p>

      <div className="relative h-14 w-14">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
          {/* Background track */}
          <circle
            className="text-[var(--color-surface-high)]"
            stroke="currentColor"
            strokeWidth="2.5"
            fill="none"
            r="15.5"
            cx="18"
            cy="18"
          />
          {/* Progress arc */}
          {!loading && (
            <circle
              stroke={isOver ? 'var(--color-danger)' : strokeColors[color]}
              strokeWidth="2.5"
              fill="none"
              r="15.5"
              cx="18"
              cy="18"
              strokeDasharray={`${arcValue} 100`}
              strokeLinecap="round"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {loading ? (
            <div className="shimmer h-3 w-8 rounded-full" />
          ) : (
            <span className="text-xs font-display text-[var(--color-text)] tabular-nums">
              {Math.round(percentage)}%
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="shimmer h-2.5 w-12 mt-2" />
      ) : (
        <p className="text-[10px] text-[var(--color-text-dim)] mt-2 tabular-nums">
          <motion.span className="text-[var(--color-text)]">{countValue}</motion.span>
          <span className="text-[var(--color-muted)]">/{target}{unit}</span>
        </p>
      )}
    </div>
  );
}
