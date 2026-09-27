import { type HTMLAttributes, forwardRef } from 'react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';

interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  variant?: 'default' | 'elevated' | 'outlined' | 'slab';
  animated?: boolean;
}

/** Readable content surfaces stay solid beneath the app's glass controls. */
export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className = '', variant = 'default', animated = true, children, ...props }, ref) => {
    const variants = {
      default: 'material-surface',
      elevated: 'material-surface',
      outlined: 'material-surface',
      slab: 'material-surface bg-[var(--color-surface-2)]',
    };

    if (!animated) {
      return (
        <div
          ref={ref}
          className={`p-5 ${variants[variant]} ${className}`}
          {...props}
        >
          {children}
        </div>
      );
    }

    return (
      <motion.div
        ref={ref}
        className={`p-5 ${variants[variant]} ${className}`}
        transition={springs.settle}
        whileTap={props.onClick ? { scale: 0.995 } : undefined}
        {...props}
      >
        {children}
      </motion.div>
    );
  }
);

Card.displayName = 'Card';

export const CardTitle = ({ className = '', children, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={`t-label-sm ${className}`} {...props}>
    {children}
  </h3>
);
