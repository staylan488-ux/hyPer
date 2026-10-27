import { commitFocusedField } from '@/lib/commitFocusedField';
import { discardSplitEdit } from '@/lib/discardSplitEdit';
import { useSplitEditStore, type CreateSplitFn, type SavedSplit } from '@/stores/splitEditStore';

/**
 * Save: commits a cell still being typed in (the iOS keypad has no Enter),
 * then creates or updates the program. An existing program with no edits
 * closes without writing it again; a new one is always created.
 */
export async function saveSplitEdit({
  createSplit,
  onSaved,
  onClose,
}: {
  createSplit: CreateSplitFn;
  onSaved: (saved: SavedSplit) => void;
  onClose: () => void;
}): Promise<void> {
  if (useSplitEditStore.getState().saving) return;
  commitFocusedField();
  const { draft, isDirty, cancelEdit, saveEdit } = useSplitEditStore.getState();
  if (!draft) return;
  if (!isDirty && !draft._isNew) {
    cancelEdit();
    onClose();
    return;
  }
  const saved = await saveEdit({ createSplit });
  if (saved) {
    onSaved(saved);
    onClose();
  }
}

/** Cancel and the sheet's close controls: asks before dropping unsaved edits. */
export async function cancelSplitEdit(onClose: () => void, confirm?: Parameters<typeof discardSplitEdit>[0]): Promise<void> {
  if (await discardSplitEdit(confirm)) onClose();
}
