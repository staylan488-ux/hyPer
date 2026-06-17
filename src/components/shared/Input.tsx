import { type InputHTMLAttributes, forwardRef, useState } from 'react';
import { motion } from 'motion/react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  label?: string;
  error?: string;
}

/**
 * FOLIO input — no box. A baseline hairline that a lacquer rule draws across
 * on focus. Text sits on the page like a filled-in form field.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, onFocus, onBlur, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [isFocused, setIsFocused] = useState(false);

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="t-label-sm block mb-2">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            className={`
              w-full px-0 min-h-11 py-2
              bg-transparent border-0
              text-[var(--color-text)]
              text-[1rem] font-normal [font-family:var(--font-sans)]
              placeholder:text-[var(--color-muted)]
              focus:outline-none
              disabled:opacity-40 disabled:cursor-not-allowed
              ${className}
            `}
            onFocus={(e) => {
              setIsFocused(true);
              onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              onBlur?.(e);
            }}
            {...props}
          />
          {/* baseline track */}
          <span
            className="pointer-events-none absolute left-0 right-0 bottom-0 h-px"
            style={{ background: error ? 'var(--color-accent)' : 'var(--color-border-strong)' }}
          />
          {/* drawn rule on focus / error */}
          <motion.span
            className="pointer-events-none absolute left-0 bottom-0 h-[2px] origin-left"
            style={{ background: error ? 'var(--color-accent)' : 'var(--color-text)', right: 0 }}
            initial={false}
            animate={{ scaleX: error || isFocused ? 1 : 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
        {error && (
          <motion.p
            className="mt-2 text-xs text-[var(--color-accent)]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
