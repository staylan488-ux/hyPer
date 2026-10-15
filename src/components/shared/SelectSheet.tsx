import { useId, useState, type ReactNode } from 'react';
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
  ariaLabelledBy?: string;
}

/** App-native replacement for <select>: a hairline field opening a sheet of hairline option rows. */
export function SelectSheet<T extends string>({
  value,
  onChange,
  options,
  title,
  placeholder = 'Select…',
  disabled,
  className = '',
  ariaLabelledBy,
}: SelectSheetProps<T>) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-labelledby={ariaLabelledBy ? `${ariaLabelledBy} ${valueId}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`metal-input pressable w-full flex items-center justify-between gap-2 px-3.5 min-h-11 text-left disabled:opacity-40 ${className}`}
      >
        <span id={valueId} className={`text-[15px] leading-[1.35] min-w-0 break-words py-2 ${selected ? 'text-[var(--metal-ink)]' : 'text-[var(--metal-ink-3)]'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="w-4 h-4 shrink-0 text-[var(--metal-ink-2)]" strokeWidth={1.5} />
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col pb-2">
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
                className="pressable flex items-center gap-3 py-3 min-h-[52px] text-left border-t-[0.5px] border-[var(--metal-rule)]"
              >
                {option.icon && <span className="shrink-0 text-[var(--metal-ink-2)]">{option.icon}</span>}
                <span className="flex-1 min-w-0">
                  <span className={`block text-[15px] leading-[1.35] text-[var(--metal-ink)] break-words ${isSelected ? 'font-medium' : ''}`}>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block text-[12.5px] leading-[1.45] mt-0.5 text-[var(--metal-ink-2)]">{option.description}</span>
                  )}
                </span>
                {isSelected && <Check className="w-4 h-4 shrink-0 text-[var(--metal-ink)]" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      </Modal>
    </>
  );
}
