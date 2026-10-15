import { commitFocusedField } from '@/lib/commitFocusedField';
import { requestConfirm } from '@/lib/confirmDialog';
import { useSplitEditStore } from '@/stores/splitEditStore';

/**
 * Both Cancel and the sheet's close controls must include a focused cell.
 * Unsaved edits are only dropped after an in-app confirmation; discarding
 * also forgets the device copy, while closing an untouched draft keeps a copy
 * the user has not decided on yet.
 */
export async function discardSplitEdit(): Promise<boolean> {
  if (useSplitEditStore.getState().saving) return false;
  commitFocusedField();
  const { isDirty, draft } = useSplitEditStore.getState();
  if (!isDirty) {
    useSplitEditStore.getState().cancelEdit();
    return true;
  }
  const confirmed = await requestConfirm({
    title: draft?._isNew ? 'Discard new program?' : 'Discard changes?',
    message: draft?._isNew
      ? 'This program has not been created yet. Discarding removes it from this device.'
      : 'Your unsaved edits to this program will be lost.',
    confirmLabel: 'Discard',
    cancelLabel: 'Keep editing',
    destructive: true,
  });
  // A save started meanwhile, or the draft changed hands: leave it alone.
  if (!confirmed || useSplitEditStore.getState().saving || useSplitEditStore.getState().draft !== draft) return false;
  useSplitEditStore.getState().discardEdit();
  return true;
}
