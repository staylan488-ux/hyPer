import { Stack, useLocalSearchParams } from 'expo-router';

import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { MuscleSetsList } from '~/components/MuscleSetsList';
import { TabScroll } from '~/components/TabScroll';
import { space } from '~/theme/blanc';

/** Sets per week of a saved program, read-only (from its program view). */
export default function ProgramMusclesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const split = useAppStore((state) => state.splits.find((entry) => entry.id === id) ?? null);
  return (
    <>
      <Stack.Screen options={{ title: 'Sets per week' }} />
      <TabScroll>
        {split ? (
          <MuscleSetsList program={split} />
        ) : (
          <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
            This program is no longer here.
          </BlancText>
        )}
      </TabScroll>
    </>
  );
}
