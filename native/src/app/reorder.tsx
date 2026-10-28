import { Host, List, Text as SwiftText, VStack } from '@expo/ui/swift-ui';
import {
  environment,
  font,
  foregroundStyle,
  listRowBackground,
  listStyle,
  moveDisabled,
  scrollContentBackground,
} from '@expo/ui/swift-ui/modifiers';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { moveMovementBlock, movementBlocks } from '@/components/workout/movementOrder';
import { BlancText } from '~/components/BlancText';
import { GlassButton } from '~/components/GlassButton';
import { haptics } from '~/lib/haptics';
import { errorMessage, reorderMovements } from '~/lib/movement';
import { useSessionModel, type Movement } from '~/lib/session';
import { space, useBlanc } from '~/theme/blanc';

/**
 * The workout's movement order, dragged by iOS's own list handles. A superset
 * pair moves as one row. Each drop saves at once (only this session's order;
 * the program stays the same); a failed save puts the order back, as on the
 * web.
 */
export default function ReorderSheet() {
  const c = useBlanc();
  const session = useSessionModel();
  const movements = session?.movements ?? [];
  const byId = new Map(movements.map((movement) => [movement.exerciseId, movement]));
  const groupOf = (id: string) => byId.get(id)?.superset?.groupId ?? null;
  const saved = movementBlocks(movements.map((movement) => ({ id: movement.exerciseId, name: movement.name, supersetGroupId: groupOf(movement.exerciseId) })));
  // The order being saved, shown until the save settles; the workout's own
  // order shows again after, so a failure puts the old order back.
  const [pending, setPending] = useState<string[][] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocks = pending ?? saved;

  const move = async (sourceIndices: number[], destination: number) => {
    const source = sourceIndices[0];
    if (!session || pending || source === undefined || !blocks[source]) return;
    // iOS gives the drop point counted before the dragged row is taken out.
    const target = destination > source ? destination - 1 : destination;
    if (target === source) return;
    const ids = moveMovementBlock(blocks, blocks[source][0], target);
    haptics.select();
    setError(null);
    setPending(movementBlocks(ids.map((id) => ({ id, name: '', supersetGroupId: groupOf(id) }))));
    try {
      await reorderMovements(session.workoutId, ids);
      haptics.success();
    } catch (failure) {
      haptics.error();
      setError(errorMessage(failure, 'Order not saved. Check your connection and try again.'));
    } finally {
      setPending(null);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.ground }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        {/* iOS sheets confirm on the trailing side. */}
        <View style={{ width: 44 }} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <BlancText variant="headline" accessibilityRole="header">
            Reorder
          </BlancText>
          <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
            This workout only
          </BlancText>
        </View>
        <GlassButton symbol="checkmark" accessibilityLabel="Done" onPress={() => router.back()} />
      </View>

      {error ? (
        <BlancText
          variant="footnote"
          tone="live"
          accessibilityLiveRegion="polite"
          style={{ marginHorizontal: space.gutter, marginTop: 12 }}>
          {error}
        </BlancText>
      ) : null}

      <Host style={{ flex: 1, marginTop: 4 }}>
        <List modifiers={[listStyle('insetGrouped'), scrollContentBackground('hidden'), environment('editMode', 'active')]}>
          <List.ForEach
            data={blocks}
            keyExtractor={(block) => block.join('+')}
            onMove={(sources, destination) => void move(sources, destination)}>
            {({ item: block }) => {
              const members = block.map((id) => byId.get(id)).filter((movement): movement is Movement => Boolean(movement));
              return (
                <VStack alignment="leading" spacing={2} modifiers={[listRowBackground(c.label), moveDisabled(pending !== null)]}>
                  <SwiftText modifiers={[font({ size: 17, weight: 'medium' }), foregroundStyle(c.ink)]}>
                    {members.map((movement) => movement.name).join(' + ')}
                  </SwiftText>
                  <SwiftText modifiers={[font({ size: 15 }), foregroundStyle(c.graphite)]}>{blockLine(members)}</SwiftText>
                </VStack>
              );
            }}
          </List.ForEach>
        </List>
      </Host>
    </View>
  );
}

/** "Superset" for a pair, else how far the movement has got. */
function blockLine(members: Movement[]): string {
  if (members.length > 1) return 'Superset';
  const [movement] = members;
  if (!movement) return '';
  if (movement.done === movement.sets.length) return 'Done';
  return `${movement.done} of ${movement.sets.length} sets`;
}
