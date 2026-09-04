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

/** Compact choice control with a quiet fill and an explicit selected state. */
export function Chip({ children, selected = false, onClick, tone = 'neutral', size = 'md', className = '', disabled }: ChipProps) {
  const toneStyles = selected
    ? tone === 'amber'
      ? 'bg-[var(--color-accent)] text-[var(--color-base)] border-[var(--color-accent)]'
      : 'bg-[var(--color-text)] text-[var(--color-base)] border-[var(--color-text)]'
    : 'bg-[var(--color-well)] text-[var(--color-text-dim)] hover:text-[var(--color-text)]';

  const sizing = size === 'sm' ? 'min-h-11 px-3 text-[12px]' : 'min-h-11 px-4 text-[12px]';

  return (
    <button
      type="button"
      onClick={() => {
        tapHaptic();
        onClick?.();
      }}
      disabled={disabled}
      aria-pressed={selected}
      className={`pressable inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] border-0 font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-40 disabled:pointer-events-none ${sizing} ${toneStyles} ${className}`}
    >
      {children}
    </button>
  );
}
