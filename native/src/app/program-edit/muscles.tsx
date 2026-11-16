import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';

import { useSplitEditStore } from '@/stores/splitEditStore';
import { MuscleSetsList } from '~/components/MuscleSetsList';
import { useBlanc } from '~/theme/blanc';

/** Sets per week of the program being edited, as it stands in the draft. */
export default function DraftMusclesScreen() {
  const c = useBlanc();
  const draft = useSplitEditStore((state) => state.draft);
  return (
    <>
      <Stack.Screen options={{ title: 'Sets per week' }} />
      <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }}>
        {draft ? <MuscleSetsList program={draft} /> : null}
      </ScrollView>
    </>
  );
}
