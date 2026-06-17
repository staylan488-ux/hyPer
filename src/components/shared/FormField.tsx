import { type ReactNode } from 'react';

interface FormFieldProps {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
  className?: string;
}

/** Label + control wrapper with consistent spacing and error/hint slots. */
export function FormField({ label, children, hint, error, className = '' }: FormFieldProps) {
  return (
    <div className={`w-full ${className}`}>
      <span className="t-label-sm block mb-2">{label}</span>
      {children}
      {error ? (
        <p className="mt-2 text-xs text-[var(--color-accent)]">{error}</p>
      ) : hint ? (
        <p className="mt-2 text-xs text-[var(--color-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}
