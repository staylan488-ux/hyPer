import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { Modal } from './Modal';
import { Chip } from './Chip';
import { tapHaptic } from '@/lib/haptics';

/* ───────────────────────── DateField ───────────────────────── */

interface DateFieldProps {
  value: Date;
  onChange: (date: Date) => void;
  max?: Date;
  min?: Date;
  className?: string;
}

/** App-native date control: well trigger + sheet with quick picks and a month grid. */
export function DateField({ value, onChange, max, min, className = '' }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(value));

  const openSheet = () => {
    setViewMonth(startOfMonth(value));
    setOpen(true);
  };

  const days = useMemo(
    () =>
      eachDayOfInterval({
        start: startOfWeek(startOfMonth(viewMonth)),
        end: endOfWeek(endOfMonth(viewMonth)),
      }),
    [viewMonth]
  );

  const isDisabled = useCallback(
    (day: Date) =>
      (max ? isAfter(startOfDay(day), startOfDay(max)) : false) ||
      (min ? isBefore(startOfDay(day), startOfDay(min)) : false),
    [max, min]
  );

  const pick = (day: Date) => {
    onChange(day);
    setOpen(false);
  };

  const today = new Date();
  const yesterday = addDays(today, -1);

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className={`pressable well w-full flex items-center gap-2.5 px-3.5 min-h-11 text-left ${className}`}
      >
        <CalendarDays className="w-4 h-4 shrink-0 text-[var(--color-stone)]" strokeWidth={1.75} />
        <span className="text-sm font-medium text-[var(--color-text)]">
          {isToday(value) ? 'Today' : isSameDay(value, yesterday) ? 'Yesterday' : format(value, 'EEE, MMM d')}
        </span>
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Date">
        <div className="pt-1 pb-2">
          <div className="flex gap-2 mb-4">
            <Chip selected={isSameDay(value, today)} tone="amber" onClick={() => pick(today)} disabled={isDisabled(today)}>
              Today
            </Chip>
            <Chip selected={isSameDay(value, yesterday)} tone="amber" onClick={() => pick(yesterday)} disabled={isDisabled(yesterday)}>
              Yesterday
            </Chip>
          </div>

          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewMonth((m) => subMonths(m, 1))}
              className="pressable p-2.5 rounded-[var(--radius-sm)] text-[var(--color-muted)]"
              aria-label="Previous month"
            >
              <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            </button>
            <span className="t-heading">{format(viewMonth, 'MMMM yyyy')}</span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
              className="pressable p-2.5 rounded-[var(--radius-sm)] text-[var(--color-muted)]"
              aria-label="Next month"
            >
              <ChevronRight className="w-4 h-4" strokeWidth={2} />
            </button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i} className="t-label-sm text-center py-1">
                {d}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map((day) => {
              const selected = isSameDay(day, value);
              const outside = !isSameMonth(day, viewMonth);
              const disabled = isDisabled(day);
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  disabled={disabled}
                  onClick={() => pick(day)}
                  className={`relative h-10 rounded-[var(--radius-sm)] t-data-sm transition-colors ${
                    selected
                      ? 'bg-[var(--color-text)] text-[var(--color-base)] font-semibold'
                      : disabled
                        ? 'text-[color-mix(in_srgb,var(--color-muted)_45%,transparent)]'
                        : outside
                          ? 'text-[var(--color-muted)]'
                          : 'text-[var(--color-text-dim)]'
                  } ${!selected && !disabled ? 'active:bg-[var(--color-surface-2)]' : ''}`}
                >
                  {format(day, 'd')}
                  {isToday(day) && !selected && (
                    <span className="absolute left-1/2 -translate-x-1/2 bottom-1 w-1 h-1 rounded-full bg-[var(--color-accent)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </>
  );
}

/* ───────────────────────── TimeField ───────────────────────── */

const ITEM_H = 44;

function WheelColumn({
  items,
  index,
  onIndexChange,
  ariaLabel,
}: {
  items: string[];
  index: number;
  onIndexChange: (index: number) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const settling = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppress = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    suppress.current = true;
    el.scrollTop = index * ITEM_H;
    const release = setTimeout(() => {
      suppress.current = false;
    }, 120);
    return () => clearTimeout(release);
    // Only re-center when the column identity changes, not on every parent re-render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    if (suppress.current) return;
    if (settling.current) clearTimeout(settling.current);
    settling.current = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      const next = Math.min(items.length - 1, Math.max(0, Math.round(el.scrollTop / ITEM_H)));
      if (next !== index) tapHaptic();
      onIndexChange(next);
    }, 90);
  };

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      aria-label={ariaLabel}
      className="h-[220px] overflow-y-auto snap-y snap-mandatory no-scrollbar flex-1"
      style={{ scrollPaddingBlock: ITEM_H * 2 }}
    >
      <div style={{ height: ITEM_H * 2 }} />
      {items.map((item, i) => (
        <button
          key={`${item}-${i}`}
          type="button"
          onClick={() => {
            const el = ref.current;
            if (el) el.scrollTo({ top: i * ITEM_H, behavior: 'smooth' });
            onIndexChange(i);
          }}
          className={`snap-center w-full flex items-center justify-center t-data-lg transition-colors ${
            i === index ? 'text-[var(--color-text)]' : 'text-[var(--color-muted)]'
          }`}
          style={{ height: ITEM_H }}
        >
          {item}
        </button>
      ))}
      <div style={{ height: ITEM_H * 2 }} />
    </div>
  );
}

const HOURS_12 = ['12', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11'];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

function toParts(value: string): { hourIndex: number; minuteIndex: number; pm: boolean } {
  const [hRaw, mRaw] = value.split(':');
  const h = Number.parseInt(hRaw ?? '12', 10);
  const m = Number.parseInt(mRaw ?? '0', 10);
  const safeH = Number.isFinite(h) ? Math.min(23, Math.max(0, h)) : 12;
  const safeM = Number.isFinite(m) ? Math.min(59, Math.max(0, m)) : 0;
  return { hourIndex: safeH % 12, minuteIndex: safeM, pm: safeH >= 12 };
}

function toValue(hourIndex: number, minuteIndex: number, pm: boolean): string {
  const h24 = (hourIndex % 12) + (pm ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(minuteIndex).padStart(2, '0')}`;
}

function formatTimeLabel(value: string): string {
  const { hourIndex, minuteIndex, pm } = toParts(value);
  return `${HOURS_12[hourIndex]}:${String(minuteIndex).padStart(2, '0')} ${pm ? 'PM' : 'AM'}`;
}

interface TimeFieldProps {
  /** 'HH:mm' 24h string */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/** App-native time control: well trigger + sheet with a Now quick pick and snap wheels. */
export function TimeField({ value, onChange, className = '' }: TimeFieldProps) {
  const [open, setOpen] = useState(false);
  const parts = toParts(value || format(new Date(), 'HH:mm'));

  const setPart = (next: Partial<{ hourIndex: number; minuteIndex: number; pm: boolean }>) => {
    const merged = { ...parts, ...next };
    onChange(toValue(merged.hourIndex, merged.minuteIndex, merged.pm));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`pressable well w-full flex items-center gap-2.5 px-3.5 min-h-11 text-left ${className}`}
      >
        <Clock className="w-4 h-4 shrink-0 text-[var(--color-stone)]" strokeWidth={1.75} />
        <span className="t-data text-[var(--color-text)]">{value ? formatTimeLabel(value) : '—'}</span>
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Time">
        <div className="pt-1 pb-2">
          <div className="flex gap-2 mb-3">
            <Chip
              tone="amber"
              onClick={() => {
                onChange(format(new Date(), 'HH:mm'));
                setOpen(false);
              }}
            >
              Now
            </Chip>
          </div>

          <div className="relative well overflow-hidden">
            {/* selection band — hairline rules above and below, no fill */}
            <div
              className="pointer-events-none absolute left-0 right-0 top-1/2 -translate-y-1/2 border-y border-[var(--color-border-strong)]"
              style={{ height: ITEM_H }}
            />
            <div className="relative flex">
              <WheelColumn
                key={`h-${open}`}
                items={HOURS_12}
                index={parts.hourIndex}
                onIndexChange={(i) => setPart({ hourIndex: i })}
                ariaLabel="Hour"
              />
              <WheelColumn
                key={`m-${open}`}
                items={MINUTES}
                index={parts.minuteIndex}
                onIndexChange={(i) => setPart({ minuteIndex: i })}
                ariaLabel="Minute"
              />
              <WheelColumn
                key={`p-${open}`}
                items={['AM', 'PM']}
                index={parts.pm ? 1 : 0}
                onIndexChange={(i) => setPart({ pm: i === 1 })}
                ariaLabel="AM or PM"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setOpen(false)}
            className="pressable mt-4 w-full min-h-12 rounded-[var(--radius-md)] bg-[var(--button-primary-bg)] text-[var(--button-primary-fg)] text-sm font-semibold"
          >
            Done
          </button>
        </div>
      </Modal>
    </>
  );
}
