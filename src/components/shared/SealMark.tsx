import { Check } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { springs } from '@/lib/animations';

/** The stamp beside a met target: a lacquer disc with an ink-paper check. */
export function SealMark({ show, label, anchorRef }: { show: boolean; label: string; anchorRef?: React.Ref<HTMLSpanElement> }) {
  return (
    <span ref={anchorRef} className="inline-flex w-4 h-4 align-[-2px]">
      <AnimatePresence>
        {show && (
          <motion.span
            className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-[var(--color-accent)] text-[var(--color-base)]"
            initial={{ scale: 0, rotate: -40 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ ...springs.lift, delay: 0.35 }}
            role="img"
            aria-label={label}
          >
            <Check size={10} strokeWidth={3} aria-hidden />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
