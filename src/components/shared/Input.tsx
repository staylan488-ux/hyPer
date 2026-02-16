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
          <motion.label
            htmlFor={inputId}
            className="block text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--color-muted)] mb-1 md:mb-2"
            animate={{
              color: isFocused ? 'var(--color-text-dim)' : 'var(--color-muted)',
              x: isFocused ? 2 : 0,
            }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.label>
        )}
        <motion.input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2 md:px-4 md:py-3
            bg-[var(--color-base)]
            border border-[var(--color-border-strong)]
            rounded-[20px]
            text-[var(--color-text)]
            text-sm
            placeholder:text-[color-mix(in_srgb,var(--color-muted)_70%,transparent)]
            transition-colors duration-200
            focus:outline-none
            focus:border-[var(--color-border-strong)]
            focus:bg-[var(--color-base)]
            disabled:opacity-40 disabled:cursor-not-allowed
            ${error ? 'border-[var(--color-danger)]' : ''}
            ${className}
          `}
          animate={{
            boxShadow: isFocused
              ? '0 0 0 3px color-mix(in srgb, var(--color-accent) 14%, transparent)'
              : '0 0 0 0px color-mix(in srgb, var(--color-accent) 0%, transparent)',
          }}
          transition={{ duration: 0.2 }}
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
            className="mt-2 text-xs text-[var(--color-danger)]"
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
