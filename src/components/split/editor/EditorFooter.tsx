import { AnimatePresence, motion } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/shared';
import { useSplitEditStore } from '@/stores/splitEditStore';

/** The sheet's sticky bar: Undo for the latest removal, save errors, Cancel and Save. */
export function EditorFooter({
  isNew,
  onCancel,
  onSave,
}: {
  isNew: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const saving = useSplitEditStore((s) => s.saving);
  const error = useSplitEditStore((s) => s.error);
  const undo = useSplitEditStore((s) => s.undo);
  const undoRemoval = useSplitEditStore((s) => s.undoRemoval);

  return (
    <div className="metal-sheet-bar">
      <div className="w-full max-w-lg mx-auto space-y-2">
        <AnimatePresence>
          {undo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-3"
              role="status"
            >
              <span className="text-[13px] leading-[1.4] text-[var(--metal-ink)] min-w-0 break-words">{undo.label}</span>
              <button
                type="button"
                className="metal-text-btn shrink-0 text-[14px] gap-1.5"
                onClick={undoRemoval}
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                Undo
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="text-[13px] leading-[1.4] text-[var(--metal-red)] text-center" role="alert">{error}</p>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" size="md" className="flex-1" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" size="md" className="flex-1" onClick={onSave} loading={saving} disabled={saving}>
            {isNew ? 'Create program' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
