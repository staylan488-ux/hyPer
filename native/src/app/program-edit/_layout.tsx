import { Stack, useNavigation, usePreventRemove } from 'expo-router';
import { useEffect } from 'react';

import { useSplitDraftAutosave } from '@/components/split/editor/useSplitDraftAutosave';
import { discardSplitEdit } from '@/lib/discardSplitEdit';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { confirmAlert } from '~/lib/program';
import { useBlanc } from '~/theme/blanc';

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

  usePreventRemove(unsaved, ({ data }) => {
    const { draft, isDirty } = useSplitEditStore.getState();
    // Saved or discarded since this render: nothing left to keep.
    if (!draft || !isDirty) {
      navigation.dispatch(data.action);
      return;
    }
    void discardSplitEdit(confirmAlert).then((discarded) => {
      if (discarded) navigation.dispatch(data.action);
    });
  });

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
