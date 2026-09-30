import { type ReactNode } from 'react';

interface ScreenProps {
  children: ReactNode;
  className?: string;
  /** Disable the bottom-nav clearance padding (e.g. when a sticky bar handles it) */
  bare?: boolean;
}

/**
 * Standard page wrapper: generous gutter, top spacing, bottom-nav clearance.
 * The shell owns scroll restoration and stationary safe-area insets.
 */
export function Screen({ children, className = '', bare = false }: ScreenProps) {
  return (
    <div className={`px-6 pt-7 ${bare ? '' : 'pb-nav'} ${className}`}>
      {children}
    </div>
  );
}
