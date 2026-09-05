import { AnimatePresence, motion } from 'motion/react';
import { Check, AlertCircle } from 'lucide-react';
import { springs } from '@/lib/animations';

interface ToastProps {
  show: boolean;
  message: string;
  tone?: 'sage' | 'berry';
}

/** Compact feedback in the same material as the app's foreground controls. */
export function Toast({ show, message, tone = 'sage' }: ToastProps) {
  const Icon = tone === 'sage' ? Check : AlertCircle;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed left-1/2 z-[60] safe-area-top-offset max-w-[calc(100%-2rem)] w-max"
          role="status"
          initial={{ opacity: 0, y: -16, x: '-50%' }}
          animate={{ opacity: 1, y: 0, x: '-50%' }}
          exit={{ opacity: 0, y: -12, x: '-50%' }}
          transition={springs.smooth}
        >
          <div
            className="material-toast flex items-center gap-2.5 px-4 py-3"
          >
            <Icon
              className="w-3.5 h-3.5 shrink-0"
              strokeWidth={2}
              style={{ color: tone === 'berry' ? 'var(--color-accent)' : 'var(--color-text)' }}
            />
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--color-text)]">{message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
