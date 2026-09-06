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
    <button type="button" data-you-focus={title} className="you-row" onClick={onClick}>
      <span className="min-w-0 flex-1">
        <span className="you-row-title">{title}</span>
        {description && <span className="you-row-description">{description}</span>}
      </span>
      <ChevronRight
        size={17}
        className="shrink-0 text-[var(--color-text-dim)]"
        aria-hidden="true"
      />
    </button>
  );
}

export function SettingsSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="t-label-sm mb-2">{label}</h2>
      {children}
    </section>
  );
}
