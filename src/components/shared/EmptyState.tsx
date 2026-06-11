import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { springs } from '@/lib/animations';
import { TickStrip } from './TrainingStrip';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  body?: string;
  /** Primary action — every empty state earns one */
  action?: ReactNode;
  /** Optional preview content (e.g. ghosted example rows) */
  preview?: ReactNode;
  className?: string;
}

/** Guided empty state: states the gap, shows what fills it, offers the next step. */
export function EmptyState({ icon: Icon, title, body, action, preview, className = '' }: EmptyStateProps) {
  return (
    <motion.div
      className={`rounded-[var(--radius-lg)] bg-[var(--color-surface-1)] hairline px-5 py-7 text-center ${className}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springs.smooth}
    >
      {Icon && (
        <div className="mx-auto mb-4 w-12 h-12 rounded-full well flex items-center justify-center">
          <Icon className="w-5 h-5 text-[var(--color-stone)]" strokeWidth={1.75} />
        </div>
      )}
      <h3 className="t-heading mb-1.5">{title}</h3>
      {body && <p className="t-caption max-w-[260px] mx-auto">{body}</p>}
      {preview && <div className="mt-5">{preview}</div>}
      {!preview && (
        <div className="mt-5 flex justify-center opacity-50" aria-hidden>
          <TickStrip total={10} filled={0} tone="stone" size="sm" />
        </div>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </motion.div>
  );
}
