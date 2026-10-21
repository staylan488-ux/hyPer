import { type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { tapHaptic } from '@/lib/haptics';

/**
 * Metal primitives. Compose screens from these instead of new boxes:
 * sections are separated by hairlines and space; figures are Fraunces; the
 * one primary action goes on the command capsule (useCommandCapsule).
 */

export function Eyebrow({ children, live = false, className = '' }: { children: ReactNode; live?: boolean; className?: string }) {
  return (
    <p className={`metal-eyebrow ${className}`}>
      {live && <span className="metal-live-dot" aria-hidden />}
      {children}
    </p>
  );
}

/** Fraunces 30px section title with an optional Geist note on its baseline. */
export function MetalTitle({ children, note, as: Tag = 'h1', className = '' }: { children: ReactNode; note?: ReactNode; as?: 'h1' | 'h2'; className?: string }) {
  return (
    <Tag className={`metal-title ${className}`}>
      <span>{children}</span>
      {note && <small>{note}</small>}
    </Tag>
  );
}

export interface SegmentProgress {
  total: number;
  on: number;
  /** Index of the live segment (red), if any. */
  now?: number;
  /** Fewer, wider segments (e.g. sessions in a week). */
  wide?: boolean;
}

/** Full-width segmented hairline; long runs are capped so segments stay legible. */
export function SegmentedHairline({ total, on, now, wide = false, max = 30, label }: SegmentProgress & { max?: number; label?: string }) {
  const count = Math.max(1, Math.min(total, max));
  const scale = total > count ? count / total : 1;
  const filled = Math.round(on * scale);
  const live = now === undefined ? -1 : Math.min(count - 1, Math.floor(now * scale));
  return (
    <div className={`metal-segs${wide ? ' is-wide' : ''}`} role="img" aria-label={label ?? `${on} of ${total}`}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={index < filled ? 'is-on' : index === live ? 'is-now' : undefined} />
      ))}
    </div>
  );
}

/**
 * One huge Fraunces figure (~104px) per screen state, its caption on the
 * baseline, and a full-width segmented hairline beneath.
 */
export function HeroFigure({ value, of, caption, segments, className = '' }: {
  value: ReactNode;
  /** Muted denominator ("/17"). */
  of?: ReactNode;
  caption?: ReactNode;
  segments?: SegmentProgress & { label?: string };
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="metal-hero">
        <span className="metal-num">{value}{of !== undefined && <i>/{of}</i>}</span>
        {caption && <span className="metal-hero-caption">{caption}</span>}
      </div>
      {segments && <SegmentedHairline {...segments} />}
    </div>
  );
}

/** A 56px Fraunces figure with its unit (e.g. kcal left). */
export function BigFigure({ children, unit }: { children: ReactNode; unit?: ReactNode }) {
  return (
    <div className="metal-big">
      <span className="metal-num">{children}</span>
      {unit && <span className="metal-unit">{unit}</span>}
    </div>
  );
}

/** A section: a hairline, then an eyebrow head with optional right-hand detail. */
export function MetalSection({ label, right, children, className = '', as: Tag = 'section' }: {
  label: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
  className?: string;
  as?: 'section' | 'nav' | 'div';
}) {
  return (
    <Tag className={`metal-section ${className}`}>
      <div className="metal-section-head">
        <Eyebrow>{label}</Eyebrow>
        {right && <div className="metal-section-head-right">{right}</div>}
      </div>
      {children}
    </Tag>
  );
}

const Plus = () => (
  <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" aria-hidden><path d="M6 1.5v9M1.5 6h9" /></svg>
);
export const Chevron = ({ className = '' }: { className?: string }) => (
  <svg className={className} viewBox="0 0 7 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M1 1l5 5-5 5" /></svg>
);

/** Quiet hairline text button: a link with `to`, otherwise a button. */
export function LineButton({ children, to, onClick, plus = false, className = '' }: {
  children: ReactNode;
  to?: string;
  onClick?: () => void;
  plus?: boolean;
  className?: string;
}) {
  const content = <>{plus && <Plus />}{children}</>;
  const handle = () => { tapHaptic(); onClick?.(); };
  return to
    ? <Link to={to} className={`metal-line-btn ${className}`} onClick={handle}>{content}</Link>
    : <button type="button" className={`metal-line-btn ${className}`} onClick={handle}>{content}</button>;
}

export interface EntryItem {
  label: string;
  to: string;
}

/** The Progress / Program / History style row: equal capsules with a chevron. */
export function EntryRow({ items, className = '', label }: { items: EntryItem[]; className?: string; label?: string }) {
  return (
    <nav className={`metal-entries ${className}`} aria-label={label}>
      {items.map((item) => (
        <Link key={item.to} to={item.to} className="metal-entry" onClick={() => tapHaptic()}>
          {item.label}
          <Chevron />
        </Link>
      ))}
    </nav>
  );
}

/** Hairline list row: title, detail and value, optionally a link or button. */
export function HairlineRow({ title, detail, value, to, onClick, chevron }: {
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  to?: string;
  onClick?: () => void;
  chevron?: boolean;
}) {
  const body = (
    <>
      <span className="min-w-0">
        <span className="metal-row-title">{title}</span>
        {detail && <span className="metal-row-detail">{detail}</span>}
      </span>
      {value !== undefined && <span className="metal-row-value">{value}</span>}
      {(chevron ?? Boolean(to || onClick)) && <Chevron className="metal-row-chevron" />}
    </>
  );
  if (to) return <Link to={to} className="metal-row" onClick={() => tapHaptic()}>{body}</Link>;
  if (onClick) return <button type="button" className="metal-row" onClick={() => { tapHaptic(); onClick(); }}>{body}</button>;
  return <div className="metal-row">{body}</div>;
}

export function HairlineList({ children, className = '', label }: { children: ReactNode; className?: string; label?: string }) {
  return <div role="list" aria-label={label} className={`metal-list ${className}`}>{children}</div>;
}

/** A thin labelled bar: "Eaten 460 / 2,600". */
export function MetalRail({ label, value, target, unit = '', extra }: {
  label: ReactNode;
  value: number;
  target: number;
  unit?: string;
  extra?: ReactNode;
}) {
  const ratio = target > 0 ? value / target : 0;
  return (
    <div>
      <div className="metal-rail-label">
        <span className="flex items-center gap-2">{label}{extra}</span>
        <span><b>{Math.round(value).toLocaleString()}</b> / {Math.round(target).toLocaleString()}{unit}</span>
      </div>
      <div className="metal-rail-track" aria-hidden>
        <div className={`metal-rail-fill${ratio > 1 ? ' is-over' : ''}`} style={{ transform: `scaleX(${Math.max(0, Math.min(1, ratio))})` }} />
      </div>
      <span className="sr-only">{Math.round(ratio * 100)}% of target</span>
    </div>
  );
}

export interface ScopeItem {
  label: string;
  to: string;
  /** Extra path prefixes that count as this scope (the `to` path always does). */
  match?: string[];
}

/**
 * Scope bar: a segmented row of routes that share one tab, so sibling
 * screens read as one place (Train: Session · Program · History). The
 * selected capsule follows the current route; it never owns state.
 */
export function ScopeBar({ items, label, className = '' }: { items: ScopeItem[]; label: string; className?: string }) {
  const { pathname } = useLocation();
  const isOn = (item: ScopeItem) => {
    const paths = [item.to, ...(item.match ?? [])];
    return paths.some((path) => (path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`)));
  };
  // The most specific match wins when one scope's path prefixes another's.
  const current = items.filter(isOn).sort((a, b) => b.to.length - a.to.length)[0];
  return (
    <nav className={`metal-scope metal-segmented ${className}`} aria-label={label}>
      {items.map((item) => {
        const selected = item === current;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={selected ? 'page' : undefined}
            className={`metal-segment metal-scope-item${selected ? ' is-on' : ''}`}
            onClick={() => { if (!selected) tapHaptic(); }}
          >
            {selected && <span className="metal-segment-pill" aria-hidden />}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** The Train tab's scope: its session, the program behind it, and the history it leaves. */
export function TrainScope({ className = '' }: { className?: string }) {
  return (
    <ScopeBar
      label="Train"
      className={className}
      items={[
        { label: 'Session', to: '/train', match: ['/workout'] },
        { label: 'Program', to: '/train/program', match: ['/splits', '/train/templates'] },
        { label: 'History', to: '/history' },
      ]}
    />
  );
}
