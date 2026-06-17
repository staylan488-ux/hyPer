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

/** FOLIO chip — a sharp little tag, never a pastel pill. Selected fills with ink (or lacquer). */
export function Chip({ children, selected = false, onClick, tone = 'neutral', size = 'md', className = '', disabled }: ChipProps) {
  const toneStyles = selected
    ? tone === 'amber'
      ? 'bg-[var(--color-accent)] text-[var(--color-base)] border-[var(--color-accent)]'
      : 'bg-[var(--color-text)] text-[var(--color-base)] border-[var(--color-text)]'
    : 'bg-transparent text-[var(--color-text-dim)] border-[var(--color-border-strong)] hover:text-[var(--color-text)] hover:border-[var(--color-text)]';

  const sizing = size === 'sm' ? 'min-h-8 px-3 text-xs' : 'min-h-10 px-4 text-[13px]';

  return (
    <button
      type="button"
      onClick={() => {
        tapHaptic();
        onClick?.();
      }}
      disabled={disabled}
      className={`pressable inline-flex items-center justify-center gap-1.5 rounded-none border font-medium whitespace-nowrap transition-colors duration-200 disabled:opacity-40 disabled:pointer-events-none ${sizing} ${toneStyles} ${className}`}
    >
      {children}
    </button>
  );
}
