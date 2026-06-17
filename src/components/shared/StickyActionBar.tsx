import { type ReactNode } from 'react';

interface StickyActionBarProps {
  children: ReactNode;
  /** 'sheet' = sticky inside a bottom sheet; 'page' = fixed above the bottom nav */
  context?: 'sheet' | 'page';
  className?: string;
}

/** Persistent action dock — solid paper with a hairline rule, no gradient scrim. */
export function StickyActionBar({ children, context = 'sheet', className = '' }: StickyActionBarProps) {
  if (context === 'page') {
    return (
      <div className="fixed left-0 right-0 z-40" style={{ bottom: 'calc(4.25rem + env(safe-area-inset-bottom, 0px))' }}>
        <div className={`max-w-lg mx-auto px-6 pb-3 pt-4 bg-[var(--color-base)] border-t border-[var(--color-border-strong)] ${className}`}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`sticky bottom-0 -mx-6 px-6 pt-4 pb-1 bg-[var(--color-surface-1)] border-t border-[var(--color-border)] ${className}`}>
      {children}
    </div>
  );
}
