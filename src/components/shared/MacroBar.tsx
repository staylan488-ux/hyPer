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

/**
 * Macro readout — the number is the hero. Tracked-caps label, a large Fraunces
 * figure, the target quietly in mono, over a hairline rail with a lacquer target
 * tick. Lacquer appears only when the figure runs past target.
 */
export function MacroBar({ label, current, target, unit = '', size = 'md', loading, className = '' }: MacroBarProps) {
  const safeTarget = target > 0 ? target : 1;
  const ratio = current / safeTarget;
  const max = Math.max(safeTarget * 1.18, current);
  const fill = current / max;
  const notch = safeTarget / max;
  const over = current > safeTarget * 1.001;
  const railTone: StripTone = over ? 'berry' : 'chalk';

  if (loading) {
    return (
      <div className={className}>
        <div className="shimmer h-3 w-14 mb-2.5" />
        <div className="shimmer h-7 w-20 mb-2.5" />
        <div className="shimmer h-px w-full" />
      </div>
    );
  }

  if (size === 'sm') {
    return (
      <div className={className}>
        <span className="t-label-sm block mb-1.5">{label}</span>
        <div className="flex items-baseline gap-1 mb-2">
          <span className="number-medium text-[var(--color-text)]">{Math.round(current)}</span>
          <span className="t-data-sm text-[var(--color-muted)]">/ {Math.round(target)}{unit}</span>
        </div>
        <RailStrip value={fill} notch={notch} tone={railTone} size="sm" />
      </div>
    );
  }

  return (
    <div className={className}>
      <span className="t-label block mb-2">{label}</span>
      <div className="flex items-baseline gap-1.5 mb-2.5">
        <span className="number-large text-[var(--color-text)]">{Math.round(current)}</span>
        <span className="t-data text-[var(--color-muted)]">/ {Math.round(target)}{unit}</span>
      </div>
      <RailStrip value={fill} notch={notch} tone={railTone} size="md" />
      <span className="sr-only">{Math.round(ratio * 100)}% of target</span>
    </div>
  );
}
