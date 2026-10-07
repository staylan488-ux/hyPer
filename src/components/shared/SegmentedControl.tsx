import { type ReactNode, useId } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** Locks the choice while keeping the current selection fully readable. */
  disabled?: boolean;
  className?: string;
}

/**
 * Segmented choices at native metrics: a 36px capsule track with a 2px inset
 * and equal segments; the selection is a 32px thumb. Each segment keeps a
 * 44px hit area (liquid.css). Keep option groups to about five short labels.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  disabled = false,
  className = '',
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const item = size === 'sm' ? 'px-1' : 'px-2';

  return (
    <div
      className={`segmented-track well ${className}`}
      role="tablist"
      aria-disabled={disabled || undefined}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
        const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
        if (current < 0 || tabs.length === 0) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].focus();
        tabs[next].click();
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled && !selected}
            aria-disabled={disabled || undefined}
            onClick={() => {
              if (disabled) return;
              if (!selected) tapHaptic();
              onChange(option.value);
            }}
            className={`relative rounded-[var(--radius-capsule)] font-medium text-[15px] tracking-[-0.01em] [font-family:var(--font-sans)] transition-colors duration-200 ${item} ${
              selected ? 'text-[var(--color-text)]' : disabled ? 'text-[var(--color-text)] opacity-50' : 'text-[var(--color-muted)]'
            }`}
          >
            <span className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis">{option.label}</span>
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                className="material-selected absolute inset-0 rounded-[var(--radius-capsule)]"
                transition={springs.tactile}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
