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
      default: 'bg-[var(--color-surface-1)] border border-[var(--color-border)]',
      elevated: 'bg-[var(--color-surface-2)] border border-[var(--color-border)] raised',
      outlined: 'bg-transparent border border-[var(--color-border-strong)]',
      slab: 'bg-[var(--color-surface-2)] border border-[var(--color-border-soft)]',
    };

    if (!animated) {
      return (
        <div
          ref={ref}
          className={`rounded-[var(--radius-lg)] p-5 ${variants[variant]} ${className}`}
          {...props}
        >
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className={`rounded-[var(--radius-lg)] p-5 ${variants[variant]} ${className}`}
        transition={springs.smooth}
        whileTap={{ scale: 0.995 }}
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
  <h3 className={`t-label-sm ${className}`} {...props}>
    {children}
  </h3>
);

export const CardContent = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={className} {...props}>
    {children}
  </div>
);
