import { commitFocusedField } from '@/lib/commitFocusedField';
import { useSplitEditStore } from '@/stores/splitEditStore';

/** Both Cancel and the sheet's close controls must include a focused cell. */
export function discardSplitEdit(): boolean {
  if (useSplitEditStore.getState().saving) return false;
  commitFocusedField();
  const { isDirty, cancelEdit } = useSplitEditStore.getState();
  if (isDirty && !window.confirm('You have unsaved changes. Discard them?')) return false;
  cancelEdit();
  return true;
}
