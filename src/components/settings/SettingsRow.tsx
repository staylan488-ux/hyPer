import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export function SettingsRow({
  title,
  description,
  onClick,
}: {
  title: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" data-you-focus={title} className="you-row platter-row" onClick={onClick}>
      <span className="min-w-0 flex-1">
        <span className="you-row-title">{title}</span>
        {description && <span className="you-row-description">{description}</span>}
      </span>
      <ChevronRight
        size={17}
        strokeWidth={1.75}
        className="you-row-chevron"
        aria-hidden="true"
      />
    </button>
  );
}

/** Rows grouped on one platter, divided by hairlines. */
export function SettingsGroup({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`platter platter-flush ${className}`}>{children}</div>;
}

/** A labelled group of rows, the label sitting above the platter. */
export function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="t-label mb-3">{label}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}
