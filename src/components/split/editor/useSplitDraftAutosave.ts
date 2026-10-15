import { useEffect } from 'react';
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
    const onHidden = () => {
      if (document.visibilityState === 'hidden') saver.flush();
    };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', saver.flush);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', saver.flush);
      unsubscribe();
      saver.flush();
    };
  }, []);
}
