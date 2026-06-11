import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, onClick, ...props }, ref) => {
    const baseStyles = `
      inline-flex items-center justify-center
      [font-family:var(--font-display)] uppercase tracking-[0.16em] font-medium
      transition-colors duration-150
      focus:outline-none
      focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-base)]
      disabled:opacity-40 disabled:cursor-not-allowed
      rounded-[var(--radius-md)]
    `;

    const variants = {
      primary: `
        [background:var(--grad-amber)] text-[var(--button-primary-fg)]
        font-semibold
        hover:brightness-105
        active:brightness-95
        shadow-[var(--glow-amber),0_1px_0_rgba(255,255,255,0.25)_inset]
      `,
      secondary: `
        bg-[var(--color-surface-2)] text-[var(--color-text)]
        border border-[var(--color-border-strong)]
        hover:bg-[var(--color-surface-3)]
        active:bg-[color-mix(in_srgb,var(--color-surface-3)_88%,var(--color-base)_12%)]
      `,
      danger: `
        bg-[var(--color-danger)] text-[#FCF6F2]
        hover:bg-[color-mix(in_srgb,var(--color-danger)_90%,var(--color-text)_10%)]
        active:bg-[color-mix(in_srgb,var(--color-danger)_82%,var(--color-base)_18%)]
      `,
      ghost: `
        bg-transparent text-[var(--color-text-dim)]
        hover:text-[var(--color-text)] hover:bg-[color-mix(in_srgb,var(--color-text)_6%,transparent)]
        active:text-[var(--color-text)] active:bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]
      `,
    };

    const sizes = {
      sm: 'px-3.5 min-h-9 text-[10px] gap-1.5',
      md: 'px-5 min-h-11 text-[12px] gap-2',
      lg: 'px-6 min-h-[52px] text-[13px] gap-2.5',
    };

    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.98 }}
        transition={springs.snappy}
        onClick={(event) => {
          if (!isDisabled) tapHaptic();
          onClick?.(event);
        }}
        {...props}
      >
        {loading && (
          <span className="mr-1 flex gap-1">
            {[0, 0.2, 0.4].map((delay) => (
              <motion.span
                key={delay}
                className="w-1.5 h-1.5 rounded-full bg-current"
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
