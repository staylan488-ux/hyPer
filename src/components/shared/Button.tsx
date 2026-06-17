import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

/**
 * FOLIO button — tracked-caps grotesque, square corners, no gradient or glow.
 * primary = solid ink (lacquer on press) · secondary = ghost outline that
 * inverts · danger = lacquer outline that fills · ghost = bare tracked label.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, onClick, ...props }, ref) => {
    const baseStyles = `
      inline-flex items-center justify-center
      [font-family:var(--font-sans)] uppercase font-medium
      transition-colors duration-200
      focus:outline-none
      focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-base)]
      disabled:opacity-35 disabled:cursor-not-allowed
      rounded-none
    `;

    const variants = {
      primary: `
        bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)]
        hover:bg-[var(--button-primary-hover)]
        active:bg-[var(--button-primary-active)]
      `,
      secondary: `
        bg-transparent text-[var(--color-text)]
        border border-[var(--color-text)]
        hover:bg-[var(--color-text)] hover:text-[var(--color-base)]
      `,
      danger: `
        bg-transparent text-[var(--color-accent)]
        border border-[var(--color-accent)]
        hover:bg-[var(--color-accent)] hover:text-[var(--color-base)]
      `,
      ghost: `
        bg-transparent text-[var(--color-text-dim)]
        hover:text-[var(--color-text)]
      `,
    };

    const sizes = {
      sm: 'px-4 min-h-9 text-[10px] tracking-[0.2em] gap-2',
      md: 'px-6 min-h-11 text-[11px] tracking-[0.22em] gap-2',
      lg: 'px-7 min-h-[54px] text-[12px] tracking-[0.24em] gap-2.5',
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
