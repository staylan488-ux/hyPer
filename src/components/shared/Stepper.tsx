import { Minus, Plus } from 'lucide-react';
import { tapHaptic } from '@/lib/haptics';

interface StepperProps {
  value: number | string;
  onDecrement: () => void;
  onIncrement: () => void;
  canDecrement?: boolean;
  canIncrement?: boolean;
  /** Rendered under the value, e.g. "sets" */
  label?: string;
  className?: string;
}

/** Numeric stepper — hairline-ruled row, serif readout flanked by ink controls. */
export function Stepper({ value, onDecrement, onIncrement, canDecrement = true, canIncrement = true, label, className = '' }: StepperProps) {
  return (
    <div className={`flex items-stretch border-y border-[var(--color-border-strong)] ${className}`}>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onDecrement();
        }}
        disabled={!canDecrement}
        aria-label="Decrease"
        className="pressable flex items-center justify-center min-w-12 min-h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none border-r border-[var(--color-border)]"
      >
        <Minus className="w-4 h-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1 text-center py-2 flex flex-col items-center justify-center">
        <span className="t-data-lg text-[var(--color-text)]">{value}</span>
        {label && <span className="block t-label-sm mt-0.5">{label}</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onIncrement();
        }}
        disabled={!canIncrement}
        aria-label="Increase"
        className="pressable flex items-center justify-center min-w-12 min-h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none border-l border-[var(--color-border)]"
      >
        <Plus className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
