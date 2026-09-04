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
  distribution?: 'content' | 'equal';
  className?: string;
}

/**
 * Studio segmented choices: one quiet well with a neutral selected surface.
 * Long option groups can scroll without shrinking labels or touch targets.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  distribution = 'content',
  className = '',
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const item = size === 'sm' ? 'px-2' : 'px-3';

  return (
    <div
      className={`flex gap-1 p-1 well overflow-x-auto no-scrollbar ${className}`}
      role="tablist"
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
            onClick={() => {
              if (!selected) tapHaptic();
              onChange(option.value);
            }}
            className={`relative min-h-11 min-w-11 shrink-0 rounded-[var(--radius-control)] uppercase font-medium text-[11px] tracking-[0.16em] [font-family:var(--font-sans)] transition-colors duration-200 ${distribution === 'equal' ? 'flex-1' : ''} ${item} ${
              selected ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
            }`}
          >
            <span className="relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap">{option.label}</span>
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                className="absolute inset-0 rounded-[var(--radius-control)] bg-[var(--color-surface-3)]"
                transition={springs.snappy}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
