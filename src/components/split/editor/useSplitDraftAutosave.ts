import { useEffect } from 'react';
import { onAppHidden } from '@/lib/appVisibility';
import { createSplitDraftAutosaver } from '@/lib/splitDraftStorage';
import { useSplitEditStore } from '@/stores/splitEditStore';

const AUTOSAVE_DELAY_MS = 600;

/**
 * Keeps a device copy of the program being edited, written shortly after
 * edits pause and at once when the app is hidden. Only local storage: the
 * backend is written by Save alone.
 */
export function useSplitDraftAutosave(): void {
  useEffect(() => {
    const saver = createSplitDraftAutosaver({ delayMs: AUTOSAVE_DELAY_MS });
    const read = () => {
      const { draft, isDirty, storageScope, baseSignature } = useSplitEditStore.getState();
      return { draft, isDirty, storageScope, baseSignature };
    };
    saver.update(read());
    const unsubscribe = useSplitEditStore.subscribe(() => saver.update(read()));
    const stopWatching = onAppHidden(saver.flush);
    return () => {
      stopWatching();
      unsubscribe();
      saver.flush();
    };
  }, []);
}
