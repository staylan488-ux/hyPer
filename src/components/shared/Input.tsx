import { type InputHTMLAttributes, forwardRef, useId } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, 'aria-describedby': describedBy, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    return (
      <div className="w-full">
        {label && <label htmlFor={inputId} className="t-label block mb-2">{label}</label>}
        <input
          ref={ref}
          id={inputId}
          className={`material-inset w-full px-3 min-h-11 py-2 border-0 rounded-[var(--radius-control)] text-[var(--color-text)] text-[1rem] font-normal [font-family:var(--font-sans)] placeholder:text-[var(--color-muted)] disabled:opacity-40 disabled:cursor-not-allowed ${className}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={[describedBy, error ? errorId : undefined].filter(Boolean).join(' ') || undefined}
          {...props}
        />
        {error && <p id={errorId} className="t-caption mt-2 text-[var(--color-accent)]" role="alert">{error}</p>}
      </div>
    );
  }
);
Input.displayName = 'Input';
