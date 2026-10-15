import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import '@/components/split/program.css';

export interface RowMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

/** A row's overflow actions: the accessible fallback for drag reorder and less frequent actions. */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    root?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      if (!root?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // Close the menu, not the sheet around it.
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      const entries = Array.from(root?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []);
      const index = entries.indexOf(document.activeElement as HTMLButtonElement);
      entries.at((index + (event.key === 'ArrowDown' ? 1 : -1)) % entries.length)?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className="metal-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal strokeWidth={1.5} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="metal-menu"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={`metal-menu-item${item.destructive ? ' is-danger' : ''}`}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus({ preventScroll: true });
                item.onSelect();
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
