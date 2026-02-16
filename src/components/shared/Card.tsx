import { type HTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'default' | 'elevated' | 'outlined' | 'slab';
  animated?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', variant = 'default', animated = true, children, ...props }, ref) => {
    const variants = {
      default: 'bg-[var(--color-surface)] border border-[var(--color-border)]',
      elevated: 'bg-[var(--color-surface-high)] border border-[var(--color-border-strong)]',
      outlined: 'bg-[var(--color-base)] border border-[var(--color-border-strong)]',
      slab: 'bg-[var(--color-surface)] border border-[var(--color-border-soft)]',
    };

    if (!animated) {
      return (
        <div
          ref={ref}
          className={`rounded-[28px] p-5 ${variants[variant]} ${className}`}
          {...props}
        >
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className={`rounded-[28px] p-5 transition-shadow duration-300 hover:shadow-[0_2px_20px_color-mix(in_srgb,var(--color-text)_16%,transparent)] hover:border-[var(--color-border-strong)] ${variants[variant]} ${className}`}
        transition={springs.smooth}
        whileHover={{ y: -1 }}
        whileTap={{ scale: 0.985 }}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

export const CardHeader = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={`mb-4 ${className}`} {...props}>
    {children}
  </div>
);

export const CardTitle = ({ className = '', children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`text-[10px] font-medium tracking-[0.2em] uppercase text-[var(--color-text-dim)] ${className}`} {...props}>
    {children}
  </h3>
);

export const CardContent = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={className} {...props}>
    {children}
  </div>
);
