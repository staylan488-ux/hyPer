import { Stack, useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useState } from 'react';

import { useSplitDraftAutosave } from '@/hooks/useSplitDraftAutosave';
import { discardSplitEdit } from '@/lib/discardSplitEdit';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { confirmAlert } from '~/lib/program';
import { useBlanc } from '~/theme/blanc';

type LeaveAction = Parameters<NonNullable<Parameters<typeof usePreventRemove>[1]>>[0]['data']['action'];

/** How long the Undo bar stays after a removal, as iOS's own undo toasts do. */
const UNDO_SECONDS = 5;

/**
 * The program editor's own stack (the program, then a day), shown as a page
 * sheet. Unsaved edits hold the sheet: Cancel or a swipe down asks before
 * dropping them, as the web's close controls do. A copy stays on this device
 * while editing, as on the web.
 */
export default function ProgramEditLayout() {
  const c = useBlanc();
  const navigation = useNavigation();
  // Declared first, so its last write lands before the edit closes below.
  useSplitDraftAutosave();
  const unsaved = useSplitEditStore((state) => state.draft !== null && state.isDirty);
  const undo = useSplitEditStore((state) => state.undo);
  // The close that was held, once it may go ahead. The guard steps aside
  // first and the close runs again from the effect below: dispatching it
  // from inside the guard's callback was caught by the still-active guard.
  const [leaving, setLeaving] = useState<LeaveAction | null>(null);

  usePreventRemove(unsaved && leaving === null, ({ data }) => {
    const { draft, isDirty } = useSplitEditStore.getState();
    // Saved or discarded since this render: nothing left to keep.
    if (!draft || !isDirty) {
      setLeaving(data.action);
      return;
    }
    void discardSplitEdit(confirmAlert).then((discarded) => {
      if (discarded) setLeaving(data.action);
    });
  });

  useEffect(() => {
    if (leaving) navigation.dispatch(leaving);
  }, [leaving, navigation]);

  // Each removal's Undo stays a few seconds; a newer one starts the time again.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => useSplitEditStore.getState().dismissUndo(), UNDO_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [undo]);

  // Leaving with an untouched edit closes it; its device copy stays.
  useEffect(
    () => () => {
      const state = useSplitEditStore.getState();
      if (state.draft && !state.isDirty && !state.saving) state.cancelEdit();
    },
    [],
  );

  return (
    <Stack
      screenOptions={{
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: '600', color: c.ink },
        headerTintColor: c.ink,
        headerBackButtonDisplayMode: 'minimal',
        headerStyle: { backgroundColor: c.ground },
        contentStyle: { backgroundColor: c.ground },
      }}
    />
  );
}
