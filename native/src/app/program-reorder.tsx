import { Host, List, Text as SwiftText, VStack } from '@expo/ui/swift-ui';
import { environment, font, foregroundStyle, listRowBackground, listStyle, scrollContentBackground } from '@expo/ui/swift-ui/modifiers';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { dayLabel, daySummary, exerciseBlocks } from '@/lib/splitDraft';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { haptics } from '~/lib/haptics';
import { targetsLine } from '~/lib/program';
import { useBlanc } from '~/theme/blanc';

type Item = { id: string; title: string; line: string };

/**
 * The program's days, or one day's exercises, dragged by iOS's own list
 * handles. A superset pair moves as one row. Drops change the draft only;
 * nothing is written until the program is saved.
 */
export default function ProgramReorderSheet() {
  const c = useBlanc();
  const { day: dayId } = useLocalSearchParams<{ day?: string }>();
  const draft = useSplitEditStore((state) => state.draft);
  const day = dayId ? draft?.days.find((entry) => entry.id === dayId) ?? null : null;

  const items: Item[] = day
    ? exerciseBlocks(day.exercises).map((block) => ({
        id: block[0].id,
        title: block.map((exercise) => exercise.exercise.name).join(' + '),
        line: block.length > 1 ? 'Superset' : targetsLine(block[0]),
      }))
    : (draft?.days ?? []).map((entry, index) => ({ id: entry.id, title: dayLabel(entry, index), line: daySummary(entry) }));

  const move = (sources: number[], destination: number) => {
    const source = sources[0];
    if (source === undefined || !items[source]) return;
    // iOS gives the drop point counted before the dragged row is taken out.
    const target = destination > source ? destination - 1 : destination;
    if (target === source || !items[target]) return;
    haptics.select();
    const store = useSplitEditStore.getState();
    if (day) store.moveExerciseTo(day.id, items[source].id, items[target].id);
    else store.moveDay(items[source].id, items[target].id);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            {day ? 'Reorder exercises' : 'Reorder days'}
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
            {day ? dayLabel(day, draft?.days.indexOf(day) ?? 0) : draft?.name.trim() || 'New program'}
          </BlancText>
        </View>
        <View style={{ width: 44 }} />
      </View>

      <Host style={{ flex: 1, marginTop: 4 }}>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), environment('editMode', 'active')]}>
          <List.ForEach data={items} keyExtractor={(item) => item.id} onMove={move}>
            {({ item }) => (
              <VStack alignment="leading" spacing={2} modifiers={[listRowBackground(c.label)]}>
                <SwiftText modifiers={[font({ size: 17, weight: 'medium' }), foregroundStyle(c.ink)]}>{item.title}</SwiftText>
                <SwiftText modifiers={[font({ size: 15 }), foregroundStyle(c.graphite)]}>{item.line}</SwiftText>
              </VStack>
            )}
          </List.ForEach>
        </List>
      </Host>
    </View>
  );
}
