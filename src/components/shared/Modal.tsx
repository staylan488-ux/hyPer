import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { springs, backdrop } from '@/lib/animations';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  contentClassName?: string;
}

/** Bottom sheet on mobile, centered card on larger screens. Grab handle, safe-area aware. */
export function Modal({ isOpen, onClose, title, children, contentClassName = '' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-[2px]"
          style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === overlayRef.current && onClose()}
        >
          <motion.div
            className="w-full sm:max-w-lg bg-[var(--color-surface-1)] rounded-t-[var(--radius-xl)] sm:rounded-[var(--radius-xl)] max-h-[92dvh] border-t border-x sm:border border-[var(--color-border-strong)] flex flex-col overflow-hidden"
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={springs.smooth}
          >
            {/* grab handle */}
            <div className="flex justify-center pt-2.5 pb-0.5 sm:hidden" aria-hidden>
              <span className="w-9 h-1 rounded-full bg-[color-mix(in_srgb,var(--color-text)_18%,transparent)]" />
            </div>
            <div className="flex items-center justify-between pl-5 pr-2 sm:pl-6 pt-1.5 sm:pt-5 pb-2">
              {title ? <h2 className="t-heading">{title}</h2> : <span />}
              <motion.button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-3 hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] active:bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)] rounded-[var(--radius-md)] transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4 text-[var(--color-muted)]" />
              </motion.button>
            </div>
            <motion.div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-6 ${contentClassName}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.2 }}
            >
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
