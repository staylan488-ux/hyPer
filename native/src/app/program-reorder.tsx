import { Host, List, Text as SwiftText, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityElement,
  accessibilityLabel,
  environment,
  font,
  foregroundStyle,
  listRowBackground,
  listStyle,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { dayLabel, daySummary, exerciseBlocks } from '@/lib/splitDraft';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { speak, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { targetsLine } from '~/lib/program';
import { useBlanc } from '~/theme/blanc';

type Item = { id: string; title: string; line: string; spoken: string };

/** "3 × 8–12" or "3–4 sets × 8–12" as VoiceOver should say it: "3 sets of 8 to 12 reps". */
function spokenTargets(line: string): string {
  return speak(`${line.replace(/^(\S+)(?: sets)? × /, (_match, sets: string) => `${sets} ${sets === '1' ? 'set' : 'sets'} of `)} reps`);
}

/**
 * The program's days, or one day's exercises, dragged by iOS's own list
 * handles. A superset pair moves as one row. Drops change the draft only;
 * nothing is written until the program is saved.
 */
export default function ProgramReorderSheet() {
  const c = useBlanc();
  const large = useLargeText();
  const { day: dayId } = useLocalSearchParams<{ day?: string }>();
  const draft = useSplitEditStore((state) => state.draft);
  const day = dayId ? draft?.days.find((entry) => entry.id === dayId) ?? null : null;

  const items: Item[] = day
    ? exerciseBlocks(day.exercises).map((block) => {
        const title = block.map((exercise) => exercise.exercise.name).join(' + ');
        return {
          id: block[0].id,
          title,
          line: block.length > 1 ? 'Superset' : targetsLine(block[0]),
          spoken: block.length > 1 ? `Superset, ${block.map((exercise) => exercise.exercise.name).join(' and ')}` : `${title}, ${spokenTargets(targetsLine(block[0]))}`,
        };
      })
    : (draft?.days ?? []).map((entry, index) => ({
        id: entry.id,
        title: dayLabel(entry, index),
        line: daySummary(entry),
        spoken: speak(`${dayLabel(entry, index)} · ${daySummary(entry)}`),
      }));

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
        {/* Changes apply as they are made: Done only, trailing as in iOS 26 sheets. */}
        <View style={{ width: 44 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            {day ? 'Reorder exercises' : 'Reorder days'}
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 1} style={large ? { textAlign: 'center' } : undefined}>
            {day ? dayLabel(day, draft?.days.indexOf(day) ?? 0) : draft?.name.trim() || 'New program'}
          </BlancText>
        </View>
        <GlassButton symbol="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
      </View>

      <Host style={{ flex: 1, marginTop: 4 }}>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), environment('editMode', 'active')]}>
          <List.ForEach data={items} keyExtractor={(item) => item.id} onMove={move}>
            {({ item }) => (
              // One VoiceOver element per row, in words. The text styles are
              // the same 17 and 15 points at the standard size and grow with
              // iOS's text size.
              <VStack
                alignment="leading"
                spacing={2}
                modifiers={[listRowBackground(c.label), accessibilityElement('ignore'), accessibilityLabel(item.spoken)]}>
                <SwiftText modifiers={[font({ textStyle: 'body', weight: 'medium' }), foregroundStyle(c.ink)]}>{item.title}</SwiftText>
                <SwiftText modifiers={[font({ textStyle: 'subheadline' }), foregroundStyle(c.graphite)]}>{item.line}</SwiftText>
              </VStack>
            )}
          </List.ForEach>
        </List>
      </Host>
    </View>
  );
}
