import { AnimatePresence, motion } from 'motion/react';
import { Check, AlertCircle } from 'lucide-react';
import { springs } from '@/lib/animations';

interface ToastProps {
  show: boolean;
  message: string;
  tone?: 'sage' | 'berry';
}

/** FOLIO toast — a solid ink bar that slides under the safe area. No pill, no glow. */
export function Toast({ show, message, tone = 'sage' }: ToastProps) {
  const Icon = tone === 'sage' ? Check : AlertCircle;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed left-1/2 z-[60] safe-area-top-offset"
          initial={{ opacity: 0, y: -16, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -12, x: '-50%' }}
          transition={springs.smooth}
        >
          <div
            className="flex items-center gap-2.5 px-4 py-3 bg-[var(--color-text)]"
            style={{ borderLeft: tone === 'berry' ? '2px solid var(--color-accent)' : undefined }}
          >
            <Icon
              className="w-3.5 h-3.5 shrink-0"
              strokeWidth={2}
              style={{ color: tone === 'berry' ? 'var(--color-accent)' : 'var(--color-base)' }}
            />
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-base)]">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
