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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center backdrop-blur-sm"
          style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === overlayRef.current && onClose()}
        >
          <motion.div
            className="w-full sm:max-w-lg bg-[var(--color-base)] rounded-t-[36px] sm:rounded-[36px] max-h-[90vh] border border-[var(--color-border)] flex flex-col overflow-hidden"
            initial={{ opacity: 0, y: 60, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={springs.smooth}
          >
            <div className="flex items-center justify-between px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 border-b border-[var(--color-border)] bg-[var(--color-base)]">
              {title && (
                <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-[var(--color-text)]">
                  {title}
                </h2>
              )}
              <motion.button
                type="button"
                onClick={onClose}
                className="p-3 hover:bg-[color-mix(in_srgb,var(--color-text)_7%,transparent)] active:bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)] rounded-[14px] transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4 text-[var(--color-muted)]" />
              </motion.button>
            </div>
            <motion.div
              className={`flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-6 pb-4 sm:pb-6 ${contentClassName}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.2 }}
            >
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
