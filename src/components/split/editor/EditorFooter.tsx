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
    <div
      className="material-toolbar sticky z-20 -mx-6 rounded-t-[20px] pb-[max(1.25rem,env(safe-area-inset-bottom))]"
      style={{ bottom: 'calc(0px - max(1.25rem, env(safe-area-inset-bottom)))' }}
    >
      <div className="w-full max-w-lg mx-auto px-6 py-4 space-y-2">
        <AnimatePresence>
          {undo && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex items-center justify-between gap-3"
              role="status"
            >
              <span className="t-caption text-[var(--color-text)] min-w-0 break-words">{undo.label}</span>
              <button
                type="button"
                className="pressable studio-row-action shrink-0 min-h-11 flex items-center gap-1.5 t-label text-[var(--color-text)]"
                onClick={undoRemoval}
              >
                <RotateCcw className="w-3.5 h-3.5" strokeWidth={1.75} aria-hidden />
                Undo
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p className="t-caption text-[var(--color-accent)] text-center" role="alert">{error}</p>
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
