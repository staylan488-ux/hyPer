import { type ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';
import { LineArt, type LineArtSubject } from './LineArt';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** Line drawing shown in place of the icon. */
  art?: LineArtSubject;
  title: string;
  body?: string;
  /** Primary action — every empty state earns one */
  action?: ReactNode;
  /** Optional preview content (e.g. ghosted example rows) */
  preview?: ReactNode;
  className?: string;
}

/** Guided empty state: states the gap, shows what fills it, offers the next step. */
export function EmptyState({ icon: Icon, art, title, body, action, preview, className = '' }: EmptyStateProps) {
  return (
    <div className={`px-5 py-7 text-center ${className}`}>
      {art ? (
        <LineArt subject={art} className="mx-auto mb-3" />
      ) : Icon && (
        <div className="mx-auto mb-4 w-11 h-11 flex items-center justify-center">
          <Icon className="w-5 h-5 text-[var(--color-text-dim)]" strokeWidth={1.5} />
        </div>
      )}
      <h3 className="t-heading mb-1.5">{title}</h3>
      {body && <p className="t-caption max-w-[260px] mx-auto">{body}</p>}
      {preview && <div className="mt-5">{preview}</div>}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
