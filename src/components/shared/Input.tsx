import { type InputHTMLAttributes, forwardRef, useState } from 'react';
import { motion } from 'motion/react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, onFocus, onBlur, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [isFocused, setIsFocused] = useState(false);

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="t-label-sm block mb-1.5">
            {label}
          </label>
        )}
        <motion.input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3.5 min-h-11 py-2
            bg-[var(--color-well)]
            rounded-[var(--radius-sm)]
            text-[var(--color-text)]
            text-sm font-medium
            placeholder:text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)]
            transition-colors duration-150
            focus:outline-none
            disabled:opacity-40 disabled:cursor-not-allowed
            ${className}
          `}
          style={{ boxShadow: 'var(--well-shadow)' }}
          animate={{
            boxShadow: error
              ? 'var(--well-shadow), 0 0 0 1.5px color-mix(in srgb, var(--color-danger) 55%, transparent)'
              : isFocused
                ? 'var(--well-shadow), 0 0 0 1.5px color-mix(in srgb, var(--color-accent) 45%, transparent)'
                : 'var(--well-shadow), 0 0 0 0px transparent',
          }}
          transition={{ duration: 0.15 }}
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
        {error && (
          <motion.p
            className="mt-1.5 text-xs text-[var(--color-danger)]"
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
