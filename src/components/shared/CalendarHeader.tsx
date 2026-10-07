import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface CalendarPage {
  label: string;
  onClick: () => void;
}

interface CalendarHeaderProps {
  /** The visible month ("October", or "October 2025" outside this year). */
  label: string;
  /** Spoken name of the month (always with its year). */
  ariaLabel: string;
  /** Makes the month a button (e.g. Fuel's month jump). It looks the same. */
  onLabel?: () => void;
  previous: CalendarPage;
  next: CalendarPage;
  /** Slides the month in from the paging direction (-1 back, 1 forward). */
  direction?: number;
  className?: string;
}

/**
 * The one calendar header, shared by Fuel's week strip and History's month:
 * the month in sentence case on the leading guide, and two paging chevrons
 * whose 44pt keys sit 52pt apart, the last glyph ending on the trailing guide.
 */
export function CalendarHeader({ label, ariaLabel, onLabel, previous, next, direction = 0, className = '' }: CalendarHeaderProps) {
  const slide = {
    initial: { opacity: 0, x: direction * 12 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: direction * -12 },
    transition: { duration: 0.18 },
  };
  return (
    <div className={`calendar-head ${className}`}>
      <AnimatePresence mode="wait" initial={false}>
        {onLabel ? (
          <motion.button key={label} type="button" className="calendar-head-title" aria-label={ariaLabel} onClick={onLabel} {...slide}>
            {label}
          </motion.button>
        ) : (
          <motion.h3 key={label} className="calendar-head-title" aria-label={ariaLabel} {...slide}>
            {label}
          </motion.h3>
        )}
      </AnimatePresence>
      <div className="calendar-head-nav">
        <button type="button" className="calendar-nav-key" aria-label={previous.label} onClick={previous.onClick}>
          <ChevronLeft className="w-[18px] h-[18px]" strokeWidth={1.6} aria-hidden />
        </button>
        <button type="button" className="calendar-nav-key" aria-label={next.label} onClick={next.onClick}>
          <ChevronRight className="w-[18px] h-[18px]" strokeWidth={1.6} aria-hidden />
        </button>
      </div>
    </div>
  );
}
