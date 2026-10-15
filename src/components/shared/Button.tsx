import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { tapHaptic } from '@/lib/haptics';

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}

const variants = {
  primary: 'metal-btn--primary',
  secondary: 'metal-btn--secondary',
  danger: 'metal-btn--danger',
  ghost: 'metal-btn--ghost',
};

const sizes = {
  sm: 'metal-btn--sm',
  md: 'metal-btn--md',
  lg: 'metal-btn--lg',
};

/**
 * Metal actions: hairline capsules in sentence case (metal.css). A screen's
 * one primary action belongs on the command capsule (useCommandCapsule);
 * here `primary` is the ink hairline, `secondary` the quiet hairline,
 * `ghost` is unboxed and `danger` is drawn in the red accent.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, disabled, children, onClick, ...props }, ref) => {
    const isDisabled = disabled || loading;

    return (
      <motion.button
        ref={ref}
        className={`metal-btn ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.985 }}
        transition={springs.tactile}
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
