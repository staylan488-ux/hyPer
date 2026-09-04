import { useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Modal } from './Modal';

export interface SelectSheetOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
}

interface SelectSheetProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SelectSheetOption<T>[];
  title: string;
  /** Placeholder when value matches no option */
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/** App-native replacement for <select>: a well-styled trigger opening a bottom sheet of options. */
export function SelectSheet<T extends string>({
  value,
  onChange,
  options,
  title,
  placeholder = 'Select…',
  disabled,
  className = '',
}: SelectSheetProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`pressable well w-full flex items-center justify-between gap-2 px-3.5 min-h-11 text-left disabled:opacity-40 ${className}`}
      >
        <span className={`t-body min-w-0 break-words py-2 ${selected ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-[var(--color-muted)]" strokeWidth={2} />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-1 pt-1 pb-2">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isSelected}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`pressable flex items-center gap-3 px-3.5 py-3 min-h-11 rounded-[var(--radius-control)] text-left ${
                  isSelected
                    ? 'bg-[var(--color-well)]'
                    : 'bg-transparent'
                }`}
              >
                {option.icon && <span className="shrink-0 text-[var(--color-stone)]">{option.icon}</span>}
                <span className="flex-1 min-w-0">
                  <span className={`block t-body ${isSelected ? 'text-[var(--color-text)]' : 'text-[var(--color-text-dim)]'}`}>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block t-caption mt-0.5">{option.description}</span>
                  )}
                </span>
                {isSelected && <Check className="w-4 h-4 shrink-0 text-[var(--color-accent)]" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
