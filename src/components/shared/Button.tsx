import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/** Studio actions: solid primary, quiet filled secondary, unboxed contextual. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, onClick, ...props }, ref) => {
    const baseStyles = `
      inline-flex items-center justify-center
      [font-family:var(--font-sans)] uppercase font-medium
      transition-colors duration-200
      focus:outline-none
      focus-visible:ring-2 focus-visible:ring-[var(--color-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-base)]
      disabled:opacity-35 disabled:cursor-not-allowed
      rounded-[var(--radius-control)]
    `;

    const variants = {
      primary: `
        bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)]
        hover:bg-[var(--button-primary-hover)]
        active:bg-[var(--button-primary-active)]
      `,
      secondary: `
        bg-[var(--color-well)] text-[var(--color-text)]
        hover:bg-[var(--color-surface-3)]
      `,
      danger: `
        bg-[var(--button-danger-bg)] text-[var(--button-danger-fg)]
        hover:bg-[var(--button-danger-hover)]
      `,
      ghost: `
        bg-transparent text-[var(--color-text-dim)]
        hover:text-[var(--color-text)]
      `,
    };

    const sizes = {
      sm: 'px-4 min-h-11 text-[11px] tracking-[0.16em] gap-2',
      md: 'px-4 min-h-[45px] text-[11px] tracking-[0.16em] gap-2',
      lg: 'px-4 min-h-[51px] text-[11px] tracking-[0.16em] gap-2',
    };

    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.985 }}
        transition={springs.snappy}
        onClick={(event) => {
          if (!isDisabled) tapHaptic();
          onClick?.(event);
        }}
        {...props}
      >
        {loading && (
          <span className="mr-1 flex gap-1">
            {[0, 0.18, 0.36].map((delay) => (
              <motion.span
                key={delay}
                className="w-1 h-1 rounded-full bg-current"
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay }}
              />
            ))}
          </span>
        )}
        {children}
      </motion.button>
    );
  }
);

Button.displayName = 'Button';
