import { type ReactNode } from 'react';

interface StickyActionBarProps {
  children: ReactNode;
  /** 'sheet' = sticky inside a bottom sheet; 'page' = fixed above the bottom nav */
  context?: 'sheet' | 'page';
  className?: string;
}

/** A material command surface; sheet footers use a readable opaque fallback. */
export function StickyActionBar({ children, context = 'sheet', className = '' }: StickyActionBarProps) {
  if (context === 'page') {
    return (
      <div className="fixed left-0 right-0 z-40" style={{ bottom: 'max(var(--app-keyboard-inset, 0px), calc(5.75rem + var(--app-safe-bottom)))' }}>
        <div className={`material-toolbar material-page-actions max-w-lg mx-auto px-6 pb-3 pt-4 ${className}`}>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={`material-toolbar sticky bottom-0 -mx-6 px-6 pt-4 pb-1 ${className}`}>
      {children}
    </div>
  );
}
