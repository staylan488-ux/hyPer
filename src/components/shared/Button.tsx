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
        bg-[#E8E4DE] text-[#1A1A1A]
        hover:bg-[#D4CFC7]
        rounded-[28px]
      `,
      secondary: `
        bg-[#2E2E2E] text-[#E8E4DE]
        border border-white/10
        hover:bg-[#383838] hover:border-white/20
        rounded-[28px]
      `,
      danger: `
        bg-[#8B6B6B] text-[#E8E4DE]
        hover:bg-[#7A5A5A]
        rounded-[28px]
      `,
      ghost: `
        bg-transparent text-[#9A9A9A]
        hover:text-[#E8E4DE] hover:bg-white/5
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
