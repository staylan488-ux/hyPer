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
  className?: string;
}

/** Inset segmented switch — sits in a milled well, selection slides as a raised chalk plate. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
}: SegmentedControlProps<T>) {
  const groupId = useId();
  const pad = size === 'sm' ? 'p-0.5' : 'p-1';
  const item = size === 'sm' ? 'min-h-8 px-2.5 text-xs' : 'min-h-10 px-3 text-[13px]';

  return (
    <div className={`well flex ${pad} ${className}`} role="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (!selected) tapHaptic();
              onChange(option.value);
            }}
            className={`relative flex-1 flex items-center justify-center gap-1.5 font-semibold rounded-[8px] transition-colors duration-150 ${item} ${
              selected ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
            }`}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                className="absolute inset-0 rounded-[8px] bg-[var(--color-surface-3)] hairline"
                transition={springs.smooth}
                style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.25)' }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
