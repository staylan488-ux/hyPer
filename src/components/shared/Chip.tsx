import { type ReactNode } from 'react';
import { tapHaptic } from '@/lib/haptics';

interface ChipProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  tone?: 'amber' | 'sage' | 'neutral';
  size?: 'sm' | 'md';
  className?: string;
  disabled?: boolean;
}

/** Small tactile pill — quick picks, meal tags, presets. */
export function Chip({ children, selected = false, onClick, tone = 'neutral', size = 'md', className = '', disabled }: ChipProps) {
  const toneStyles = selected
    ? tone === 'amber'
      ? 'bg-accent-tint-strong text-[var(--color-accent)] border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
      : tone === 'sage'
        ? 'bg-sage-tint-strong text-[var(--color-sage)] border-[color-mix(in_srgb,var(--color-sage)_40%,transparent)]'
        : 'bg-[var(--color-surface-3)] text-[var(--color-text)] border-[var(--color-border-strong)]'
    : 'bg-[var(--color-surface-2)] text-[var(--color-text-dim)] border-[var(--color-border)]';

  const sizing = size === 'sm' ? 'min-h-8 px-3 text-xs' : 'min-h-10 px-3.5 text-[13px]';

  return (
    <button
      type="button"
      onClick={() => {
        tapHaptic();
        onClick?.();
      }}
      disabled={disabled}
      className={`pressable inline-flex items-center justify-center gap-1.5 rounded-full border font-medium whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none ${sizing} ${toneStyles} ${className}`}
    >
      {children}
    </button>
  );
}
