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

/** Numeric stepper: a Fraunces readout between two hairline circles. */
export function Stepper({ value, onDecrement, onIncrement, canDecrement = true, canIncrement = true, label, className = '' }: StepperProps) {
  return (
    <div className={`flex items-stretch gap-3 ${className}`}>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onDecrement();
        }}
        disabled={!canDecrement}
        aria-label="Decrease"
        className="metal-step-btn pressable flex items-center justify-center w-12 h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none"
      >
        <Minus className="w-4 h-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1 text-center py-2 flex flex-col items-center justify-center">
        <span className="metal-step-value">{value}</span>
        {label && <span className="block t-label-sm mt-1.5">{label}</span>}
      </div>
      <button
        type="button"
        onClick={() => {
          tapHaptic();
          onIncrement();
        }}
        disabled={!canIncrement}
        aria-label="Increase"
        className="metal-step-btn pressable flex items-center justify-center w-12 h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none"
      >
        <Plus className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
