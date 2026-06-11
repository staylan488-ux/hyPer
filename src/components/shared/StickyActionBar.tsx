import { type ReactNode } from 'react';

interface StickyActionBarProps {
  children: ReactNode;
  /** 'sheet' = sticky inside a bottom sheet; 'page' = fixed above the bottom nav */
  context?: 'sheet' | 'page';
  className?: string;
}

/** Persistent action dock with a fade so content visibly scrolls beneath it. */
export function StickyActionBar({ children, context = 'sheet', className = '' }: StickyActionBarProps) {
  if (context === 'page') {
    return (
      <div className="fixed left-0 right-0 z-40" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className={`max-w-lg mx-auto px-5 pb-3 pt-6 bg-gradient-to-t from-[var(--color-base)] via-[color-mix(in_srgb,var(--color-base)_86%,transparent)] to-transparent ${className}`}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 pt-5 pb-1 bg-gradient-to-t from-[var(--color-surface-1)] from-60% to-transparent ${className}`}>
      {children}
    </div>
  );
}
