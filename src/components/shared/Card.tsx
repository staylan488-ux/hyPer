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
      default: 'bg-[#242424] border border-white/5',
      elevated: 'bg-[#2E2E2E] border border-white/8',
      outlined: 'bg-[#1A1A1A] border border-white/10',
      slab: 'bg-[#242424] border border-white/[0.03]',
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
        className={`rounded-[28px] p-5 transition-shadow duration-300 hover:shadow-[0_2px_20px_rgba(0,0,0,0.15)] ${variants[variant]} ${className}`}
        transition={springs.smooth}
        whileHover={{ y: -1, borderColor: 'rgba(255,255,255,0.08)' }}
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
  <h3 className={`text-[10px] font-medium tracking-[0.2em] uppercase text-[#9A9A9A] ${className}`} {...props}>
    {children}
  </h3>
);

export const CardContent = ({ className = '', children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={className} {...props}>
    {children}
  </div>
);
