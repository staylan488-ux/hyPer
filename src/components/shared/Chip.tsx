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

/** Compact choice: a hairline capsule; selected fills with ink (or the red accent). */
export function Chip({ children, selected = false, onClick, tone = 'neutral', size = 'md', className = '', disabled }: ChipProps) {
  const toneStyles = selected
    ? tone === 'amber'
      ? 'is-selected bg-[var(--color-accent)] text-[var(--color-base)]'
      : 'is-selected bg-[var(--color-text)] text-[var(--color-base)]'
    : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]';

  const sizing = size === 'sm' ? 'min-h-11 px-3.5 text-[13px]' : 'min-h-11 px-4 text-[13.5px]';

  return (
    <button
      type="button"
      onClick={() => {
        tapHaptic();
        onClick?.();
      }}
      disabled={disabled}
      aria-pressed={selected}
      className={`metal-chip pressable inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-40 disabled:pointer-events-none ${sizing} ${toneStyles} ${className}`}
    >
      {children}
    </button>
  );
}
