import { AnimatePresence, motion } from 'motion/react';
import { Check, AlertCircle } from 'lucide-react';
import { springs } from '@/lib/animations';

interface ToastProps {
  show: boolean;
  message: string;
  tone?: 'sage' | 'berry';
}

/** Lightweight status toast — slides in under the safe area, never blocks input. */
export function Toast({ show, message, tone = 'sage' }: ToastProps) {
  const Icon = tone === 'sage' ? Check : AlertCircle;
  const color = tone === 'sage' ? 'var(--color-sage)' : 'var(--color-danger)';

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
          <div className="flex items-center gap-2 pl-3 pr-4 py-2.5 rounded-full bg-[var(--color-surface-2)] hairline-strong raised">
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
            >
              <Icon className="w-3 h-3" strokeWidth={3} style={{ color }} />
            </span>
            <span className="text-[13px] font-semibold text-[var(--color-text)]">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
