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

/** Numeric stepper — consistent data readout with quiet filled controls. */
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
        className="pressable flex items-center justify-center min-w-12 min-h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none rounded-[var(--radius-control)] bg-[var(--color-well)]"
      >
        <Minus className="w-4 h-4" strokeWidth={1.5} />
      </button>
      <div className="flex-1 text-center py-2 flex flex-col items-center justify-center">
        <span className="t-data text-[var(--color-text)]">{value}</span>
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
        className="pressable flex items-center justify-center min-w-12 min-h-12 text-[var(--color-text)] disabled:opacity-20 disabled:pointer-events-none rounded-[var(--radius-control)] bg-[var(--color-well)]"
      >
        <Plus className="w-4 h-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
