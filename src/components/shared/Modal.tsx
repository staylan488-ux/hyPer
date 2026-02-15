import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { springs, backdrop } from '@/lib/animations';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

export function Modal({ isOpen, onClose, title, children }: ModalProps) {
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
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === overlayRef.current && onClose()}
        >
          <motion.div
            className="w-full sm:max-w-lg bg-[#1A1A1A] rounded-t-[36px] sm:rounded-[36px] p-4 sm:p-6 max-h-[90vh] overflow-y-auto border border-white/5"
            initial={{ opacity: 0, y: 60, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={springs.smooth}
          >
            <div className="flex items-center justify-between mb-6">
              {title && (
                <h2 className="text-xs font-medium tracking-[0.15em] uppercase text-[#E8E4DE]">
                  {title}
                </h2>
              )}
              <motion.button
                onClick={onClose}
                className="p-2 hover:bg-white/5 rounded-[12px] transition-colors"
                whileTap={{ scale: 0.9 }}
              >
                <X className="w-4 h-4 text-[#6B6B6B]" />
              </motion.button>
            </div>
            <motion.div
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
