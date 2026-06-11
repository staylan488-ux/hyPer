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

/** Numeric stepper in a milled well — big targets, mono readout. */
export function Stepper({ value, onDecrement, onIncrement, canDecrement = true, canIncrement = true, label, className = '' }: StepperProps) {
  return (
    <div className={`well flex items-center ${className}`}>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onDecrement();
        }}
        disabled={!canDecrement}
        aria-label="Decrease"
        className="pressable flex items-center justify-center min-w-11 min-h-11 text-[var(--color-text-dim)] disabled:opacity-25 disabled:pointer-events-none"
      >
        <Minus className="w-4 h-4" strokeWidth={2} />
      </button>
      <div className="flex-1 text-center py-1">
        <span className="t-data-lg text-[var(--color-text)]">{value}</span>
        {label && <span className="block t-label-sm mt-[1px]">{label}</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onIncrement();
        }}
        disabled={!canIncrement}
        aria-label="Increase"
        className="pressable flex items-center justify-center min-w-11 min-h-11 text-[var(--color-text-dim)] disabled:opacity-25 disabled:pointer-events-none"
      >
        <Plus className="w-4 h-4" strokeWidth={2} />
      </button>
    </div>
  );
}
