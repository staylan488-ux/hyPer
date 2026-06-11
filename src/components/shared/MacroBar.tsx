import { RailStrip, type StripTone } from './TrainingStrip';

interface MacroBarProps {
  label: string;
  current: number;
  target: number;
  unit?: string;
  tone?: StripTone;
  size?: 'sm' | 'md';
  loading?: boolean;
  className?: string;
}

/** Macro readout: label + tabular numbers over a target rail. Replaces donut gauges. */
export function MacroBar({ label, current, target, unit = '', tone = 'sage', size = 'md', loading, className = '' }: MacroBarProps) {
  const safeTarget = target > 0 ? target : 1;
  const ratio = current / safeTarget;

  if (loading) {
    return (
      <div className={className}>
        <div className="shimmer h-3.5 w-16 mb-2" />
        <div className="shimmer h-1.5 w-full" />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-baseline justify-between mb-1.5 gap-2">
        <span className={size === 'sm' ? 't-label-sm' : 't-label'}>{label}</span>
        <span className={`${size === 'sm' ? 't-data-sm' : 't-data'} text-[var(--color-text)]`}>
          {Math.round(current)}
          <span className="text-[var(--color-muted)]"> / {Math.round(target)}{unit}</span>
        </span>
      </div>
      <RailStrip value={ratio} tone={tone} size={size === 'sm' ? 'sm' : 'md'} />
    </div>
  );
}
