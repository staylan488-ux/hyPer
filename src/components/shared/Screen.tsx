import { type ReactNode } from 'react';
import { motion } from 'motion/react';

interface ScreenProps {
  children: ReactNode;
  className?: string;
  /** Disable the bottom-nav clearance padding (e.g. when a sticky bar handles it) */
  bare?: boolean;
}

/** Standard page wrapper: generous gutter, top spacing, bottom-nav clearance, entry fade. */
export function Screen({ children, className = '', bare = false }: ScreenProps) {
  return (
    <motion.div
      className={`px-6 pt-7 ${bare ? '' : 'pb-nav'} ${className}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

interface TopBarProps {
  /** Small caps eyebrow above the title */
  eyebrow?: string;
  title: ReactNode;
  /** Right-aligned slot for actions */
  action?: ReactNode;
  /** Sub-line under the title */
  subtitle?: ReactNode;
  className?: string;
}

export function TopBar({ eyebrow, title, action, subtitle, className = '' }: TopBarProps) {
  return (
    <header className={`mb-7 ${className}`}>
      <div className="flex items-end justify-between gap-3 border-b border-[var(--color-text)] pb-3">
        <div className="min-w-0">
          {eyebrow && <p className="t-label-sm mb-2">{eyebrow}</p>}
          <h1 className="t-title">{title}</h1>
        </div>
        {action && <div className="shrink-0 pb-0.5">{action}</div>}
      </div>
      {subtitle && <div className="t-caption mt-3">{subtitle}</div>}
    </header>
  );
}
