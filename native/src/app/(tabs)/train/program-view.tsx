import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState, type ComponentProps } from 'react';
import { View } from 'react-native';

import { exerciseTotal, plural, setRepLabel } from '@/lib/programSummary';
import { exerciseBlocks } from '@/lib/splitDraft';
import { useAppStore } from '@/stores/appStore';
import type { Split } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { deleteProgram, editProgram, setActiveProgram } from '~/lib/program';
import { space } from '~/theme/blanc';

/** One program: its days and what each holds, with Edit, Set active and Delete. */
export default function ProgramViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const split = useAppStore((state) => state.splits.find((entry) => entry.id === id) ?? null);
  if (!split) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
          This program is no longer here.
        </BlancText>
      </>
    );
  }
  return <ProgramView split={split} />;
}

function ProgramView({ split }: { split: Split }) {
  const [activating, setActivating] = useState(false);
  const activate = async () => {
    setActivating(true);
    await setActiveProgram(split);
    setActivating(false);
  };
  const remove = async () => {
    if (await deleteProgram(split)) router.back();
  };

  const options = useMemo(
    () => ({
        title: split.name,
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: 'Edit',
            onPress: () => editProgram(split),
          },
          {
            type: 'menu',
            label: 'Program options',
            icon: { type: 'sfSymbol', name: 'ellipsis' },
            menu: {
              items: [
                ...(split.is_active
                  ? []
                  : [
                      {
                        type: 'action' as const,
                        label: 'Set active',
                        icon: { type: 'sfSymbol' as const, name: 'checkmark.circle' as const },
                        onPress: () => {
                          haptics.tap();
                          void activate();
                        },
                      },
                    ]),
                {
                  type: 'action',
                  label: 'Delete program',
                  icon: { type: 'sfSymbol', name: 'trash' },
                  destructive: true,
                  onPress: () => {
                    haptics.tap();
                    void remove();
                  },
                },
              ],
            },
          },
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [split],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {[split.is_active ? 'Active' : null, plural(split.days.length, 'day'), plural(exerciseTotal(split), 'exercise')].filter(Boolean).join(' · ')}
        </BlancText>
        {split.description ? (
          <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 6 }}>
            {split.description}
          </BlancText>
        ) : null}

        {split.is_active ? null : (
          <Capsule
            title="Make active"
            size="large"
            fill
            busy={activating}
            onPress={() => void activate()}
            style={{ marginHorizontal: space.inset, marginTop: 18 }}
          />
        )}

        {split.days.map((day) => {
          // A superset pair reads as one block, as in the editor.
          const blocks = exerciseBlocks(day.exercises);
          return (
            <Section key={day.id} title={day.day_name}>
              <Label>
                {day.exercises.length === 0 ? <Row title="No exercises" quiet /> : null}
                {blocks.map((block, index) => (
                  <View key={block[0].id}>
                    {index > 0 ? <Hairline /> : null}
                    {block.map((exercise, offset) => {
                      const name = exercise.exercise?.name ?? 'Exercise';
                      const partner = block.length > 1 ? block[offset === 0 ? 1 : 0].exercise?.name : null;
                      return (
                        <View key={exercise.id}>
                          {offset > 0 ? <Hairline /> : null}
                          <Row
                            title={name}
                            detail={partner ? `Superset with ${partner}` : undefined}
                            value={setRepLabel(exercise)}
                            accessibilityLabel={[name, `${setRepLabel(exercise).replace('×', ' sets of ')} reps`, partner ? `superset with ${partner}` : null].filter(Boolean).join(', ')}
                          />
                        </View>
                      );
                    })}
                  </View>
                ))}
              </Label>
            </Section>
          );
        })}
      </TabScroll>
    </>
  );
}
