import { type InputHTMLAttributes, forwardRef, useState } from 'react';
import { motion } from 'motion/react';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onDragOver' | 'onAnimationStart' | 'onAnimationEnd' | 'onAnimationIteration'> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', label, error, id, onFocus, onBlur, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const [isFocused, setIsFocused] = useState(false);

    return (
      <div className="w-full">
        {label && (
          <motion.label
            htmlFor={inputId}
            className="block text-[10px] font-medium tracking-[0.2em] uppercase text-[#6B6B6B] mb-1 md:mb-2"
            animate={{
              color: isFocused ? '#9A9A9A' : '#6B6B6B',
              x: isFocused ? 2 : 0,
            }}
            transition={{ duration: 0.2 }}
          >
            {label}
          </motion.label>
        )}
        <motion.input
          ref={ref}
          id={inputId}
          className={`
            w-full px-3 py-2 md:px-4 md:py-3
            bg-[#1A1A1A]
            border border-white/10
            rounded-[20px]
            text-[#E8E4DE]
            text-sm
            placeholder:text-[#6B6B6B]/60
            transition-colors duration-200
            focus:outline-none
            focus:border-white/25
            focus:bg-[#1A1A1A]
            disabled:opacity-40 disabled:cursor-not-allowed
            ${error ? 'border-[#8B6B6B]' : ''}
            ${className}
          `}
          animate={{
            boxShadow: isFocused
              ? '0 0 0 3px rgba(196, 164, 132, 0.08)'
              : '0 0 0 0px rgba(196, 164, 132, 0)',
          }}
          transition={{ duration: 0.2 }}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...props}
        />
        {error && (
          <motion.p
            className="mt-2 text-xs text-[#8B6B6B]"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {error}
          </motion.p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
