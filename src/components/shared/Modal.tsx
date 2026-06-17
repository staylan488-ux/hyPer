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

/** Bottom sheet on mobile, centered panel on larger screens. Square, hairline, safe-area aware. */
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
          style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.24 }}
          onClick={(e) => e.target === overlayRef.current && onClose()}
        >
          <motion.div
            className="w-full sm:max-w-lg bg-[var(--color-surface-1)] rounded-none max-h-[92dvh] border-t border-x sm:border border-[var(--color-border-strong)] flex flex-col overflow-hidden"
            style={{ boxShadow: 'var(--sheet-shadow)' }}
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={springs.smooth}
          >
            {/* grab rule */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden" aria-hidden>
              <span className="w-10 h-px bg-[var(--color-border-strong)]" />
            </div>
            <div className="flex items-center justify-between pl-6 pr-3 pt-3 sm:pt-5 pb-3 border-b border-[var(--color-border)]">
              {title ? <h2 className="t-heading">{title}</h2> : <span />}
              <motion.button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-3 -mr-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4" strokeWidth={1.5} />
              </motion.button>
            </div>
            <motion.div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pt-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 ${contentClassName}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.08, duration: 0.24 }}
            >
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
