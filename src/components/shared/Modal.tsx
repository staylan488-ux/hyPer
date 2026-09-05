import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, type PanInfo } from 'motion/react';
import { springs, backdrop } from '@/lib/animations';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  contentClassName?: string;
}

const openSheets: HTMLElement[] = [];
let previousBodyOverflow = '';
const backgroundInert = new Map<HTMLElement, boolean>();
let backgroundObserver: MutationObserver | undefined;

function isolateSheets() {
  for (const child of Array.from(document.body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    if (!backgroundInert.has(child)) backgroundInert.set(child, child.inert);
    child.inert = openSheets.some((sheet) => child.contains(sheet))
      ? backgroundInert.get(child) ?? false
      : true;
  }
}

/** An anchored sheet with a shared keyboard and focus boundary. */
export function Modal({ isOpen, onClose, title, children, contentClassName = '' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useEffectEvent(onClose);
  // Sheet drag is a thumb gesture — phones only (below sm the sheet is docked)
  const [sheetDrag] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen || !dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (openSheets.length === 0) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    const lowerSheet = openSheets.at(-1);
    if (lowerSheet) lowerSheet.inert = true;
    openSheets.push(dialog);
    isolateSheets();
    if (!backgroundObserver) {
      backgroundObserver = new MutationObserver(isolateSheets);
      backgroundObserver.observe(document.body, { childList: true });
    }
    dialog.focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (openSheets.at(-1) !== dialog) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        const targets = Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'))
          .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
        const first = targets[0];
        const last = targets.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      const wasTop = openSheets.at(-1) === dialog;
      const index = openSheets.indexOf(dialog);
      if (index !== -1) openSheets.splice(index, 1);
      const remaining = openSheets.at(-1);
      if (remaining) { remaining.inert = false; isolateSheets(); }
      else {
        document.body.style.overflow = previousBodyOverflow;
        backgroundObserver?.disconnect();
        backgroundObserver = undefined;
        for (const [element, inert] of backgroundInert) element.inert = inert;
        backgroundInert.clear();
      }
      if (wasTop && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    // Flick or pull past the threshold dismisses; otherwise it springs home
    if (info.offset.y > 90 || info.velocity.y > 600) onClose();
  };

  const startSheetDrag = (e: React.PointerEvent) => {
    // Buttons inside the header stay tappable — no drag from them
    if ((e.target as HTMLElement).closest('button')) return;
    dragControls.start(e);
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={overlayRef}
          className="studio-sheet-overlay fixed left-0 right-0 z-50 flex items-end sm:items-center justify-center"
          style={{ backgroundColor: 'var(--overlay-backdrop)' }}
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{ duration: 0.24 }}
          onClick={(e) => e.target === overlayRef.current && onClose()}
        >
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : "Dialog"}
            tabIndex={-1}
            className="studio-sheet w-full sm:max-w-lg flex flex-col overflow-hidden outline-none"
            style={{ boxShadow: 'var(--sheet-shadow)' }}
            initial={{ opacity: 0, y: 80 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={springs.smooth}
            drag={sheetDrag ? 'y' : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={handleDragEnd}
          >
            {/* grab rule — the sheet's drag handle on phones */}
            <div
              className={`flex justify-center pt-3 pb-1 sm:hidden ${sheetDrag ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
              aria-hidden
              onPointerDown={sheetDrag ? startSheetDrag : undefined}
            >
              <span className="material-sheet-handle" />
            </div>
            <div
              className={`material-sheet-header flex items-center justify-between pl-6 pr-5 pt-3 sm:pt-5 pb-3 ${sheetDrag ? 'touch-none cursor-grab active:cursor-grabbing' : ''}`}
              onPointerDown={sheetDrag ? startSheetDrag : undefined}
            >
              {title ? <h2 id={titleId} className="t-heading">{title}</h2> : <span />}
              <motion.button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="material-sheet-close p-3 -mr-1 text-[var(--color-muted)] hover:text-[var(--color-text)] transition-colors"
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
    </AnimatePresence>,
    document.body
  );
}
