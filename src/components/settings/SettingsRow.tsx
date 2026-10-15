import type { ReactNode } from 'react';
import { Chevron } from '@/components/metal';

/** A Metal hairline row that navigates: title, detail and a 7×12 chevron. */
export function SettingsRow({
  title,
  description,
  value,
  onClick,
}: {
  title: string;
  description?: string;
  value?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" data-you-focus={title} className="metal-row you-row" onClick={onClick}>
      <span className="min-w-0 flex-1">
        <span className="metal-row-title">{title}</span>
        {description && <span className="metal-row-detail">{description}</span>}
      </span>
      {value !== undefined && <span className="metal-row-value">{value}</span>}
      <Chevron className="metal-row-chevron" />
    </button>
  );
}

/**
 * A Metal section (hairline, 30px above, eyebrow head) whose label stays a
 * real heading, so settings remain navigable by heading.
 */
export function SettingsSection({ label, right, children, className = '' }: {
  label: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`metal-section ${className}`}>
      <div className="metal-section-head">
        <h2 className="metal-eyebrow">{label}</h2>
        {right && <div className="metal-section-head-right">{right}</div>}
      </div>
      <div className="you-list">{children}</div>
    </section>
  );
}
