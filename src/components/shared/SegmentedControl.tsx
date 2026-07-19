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
 * FOLIO segmented control — tracked-caps tabs on a baseline hairline; the
 * active one is underscored by an ink rule that slides between options.
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
  const item = size === 'sm' ? 'pb-2.5 text-[10px] tracking-[0.18em]' : 'pb-3 text-[11px] tracking-[0.2em]';

  return (
    <div
      className={`${distribution === 'equal' ? 'grid' : 'flex gap-7'} border-b border-[var(--color-border)] ${className}`}
      style={distribution === 'equal' ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
      role="tablist"
    >
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
            className={`relative min-w-0 uppercase font-medium [font-family:var(--font-sans)] -mb-px transition-colors duration-200 ${item} ${
              selected ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
            }`}
          >
            <span className={`relative z-10 flex items-center gap-1.5 ${distribution === 'equal' ? 'justify-center' : ''}`}>{option.label}</span>
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                className="absolute left-0 right-0 bottom-0 h-[2px] bg-[var(--color-text)]"
                transition={springs.smooth}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
