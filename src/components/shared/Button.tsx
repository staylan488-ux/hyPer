import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, ...props }, ref) => {
    const baseStyles = `
      inline-flex items-center justify-center
      font-medium transition-all duration-200
      focus:outline-none
      disabled:opacity-40 disabled:cursor-not-allowed
      uppercase tracking-wider text-xs
    `;

    const variants = {
      primary: `
        bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)]
        hover:bg-[var(--button-primary-hover)]
        active:bg-[var(--button-primary-active)]
        rounded-[28px]
      `,
      secondary: `
        bg-[var(--color-surface-high)] text-[var(--color-text)]
        border border-[var(--color-border-strong)]
        hover:bg-[color-mix(in_srgb,var(--color-surface-high)_90%,var(--color-text)_10%)] hover:border-[var(--color-border-strong)]
        active:bg-[color-mix(in_srgb,var(--color-surface-high)_86%,var(--color-text)_14%)] active:border-[var(--color-border-strong)]
        rounded-[28px]
      `,
      danger: `
        bg-[var(--color-danger)] text-[var(--color-text)]
        hover:bg-[color-mix(in_srgb,var(--color-danger)_88%,var(--color-base)_12%)]
        active:bg-[color-mix(in_srgb,var(--color-danger)_82%,var(--color-base)_18%)]
        rounded-[28px]
      `,
      ghost: `
        bg-transparent text-[var(--color-text-dim)]
        hover:text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)]
        active:text-[var(--color-text)] active:bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]
        rounded-[20px]
      `,
    };

    const sizes = {
      sm: 'px-4 py-2 text-[10px]',
      md: 'px-6 py-3 text-xs',
      lg: 'px-8 py-4 text-xs',
    };

    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.96, y: 1 }}
        whileHover={isDisabled ? undefined : { scale: 1.01 }}
        transition={springs.snappy}
        {...props}
      >
        {loading && (
          <span className="mr-2 flex gap-1">
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-current"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-current"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
            />
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-current"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
            />
          </span>
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
