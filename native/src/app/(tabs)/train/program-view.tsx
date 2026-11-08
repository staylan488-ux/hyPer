import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useRef, useState, type ComponentProps } from 'react';
import { View } from 'react-native';

import { exerciseTotal, plural } from '@/lib/programSummary';
import { exerciseBlocks } from '@/lib/splitDraft';
import { useAppStore } from '@/stores/appStore';
import type { Split } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { announce } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { deleteProgram, editProgram, editProgramDay, planTarget, setActiveProgram } from '~/lib/program';
import { space } from '~/theme/blanc';

/**
 * A target ("4 × 8–10", "3–5 × 8–12", "4 sets") as VoiceOver should say it:
 * "4 sets of 8 to 10 reps" (Row speaks the ranges).
 */
function spokenTarget(target: string): string {
  const match = /^(\S+) × (\S+)$/.exec(target);
  if (!match) return target;
  const [, sets, reps] = match;
  return `${sets} ${sets === '1' ? 'set' : 'sets'} of ${reps} ${reps === '1' ? 'rep' : 'reps'}`;
}

/** One program: its days and what each holds, with Edit, Set active and Delete. */
export default function ProgramViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useAppStore((state) => state.splits.find((entry) => entry.id === id) ?? null);
  // Deleted from here: the screen keeps showing it while it slides away.
  const [leaving, setLeaving] = useState<Split | null>(null);
  const split = stored ?? leaving;
  if (!split) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        {/* In the screen's scroll view, so it sits below the header as the program would. */}
        <TabScroll>
          <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
            This program is no longer here.
          </BlancText>
        </TabScroll>
      </>
    );
  }
  return (
    <ProgramView
      split={split}
      onLeave={() => {
        setLeaving(split);
        router.back();
      }}
    />
  );
}

function ProgramView({ split, onLeave }: { split: Split; onLeave: () => void }) {
  const [activating, setActivating] = useState(false);
  // The header's closures are built once per program, so a ref guards a second tap.
  const activatingNow = useRef(false);
  const activate = async () => {
    if (activatingNow.current) return;
    activatingNow.current = true;
    setActivating(true);
    const prompted = await setActiveProgram(split);
    // Make active goes away once it worked, taking VoiceOver's focus with it:
    // say so, unless the plan-start alert already does.
    if (!prompted && useAppStore.getState().splits.some((entry) => entry.id === split.id && entry.is_active)) announce(`${split.name} is active`);
    activatingNow.current = false;
    setActivating(false);
  };
  // Goes back as soon as Delete is chosen; the list brings it back if the delete fails.
  const remove = () => void deleteProgram(split, onLeave);

  // A plain object: the React Compiler keeps it until the program or the
  // activating state changes, so iOS isn't sent new header items each render.
  const options = {
    title: split.name,
    unstable_headerRightItems: () => [
      {
        type: 'button',
        label: 'Edit',
        // iOS's header items are silent.
        onPress: () => {
          haptics.tap();
          editProgram(split);
        },
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
                    disabled: activating,
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
                remove();
              },
            },
          ],
        },
      },
    ],
  } satisfies ComponentProps<typeof Stack.Screen>['options'];

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
                {/* A day's rows open that day in the editor, where its sets, reps and movements change. */}
                {day.exercises.length === 0 ? <Row title="No exercises yet" quiet onPress={() => editProgramDay(split, day.id)} /> : null}
                {blocks.map((block, index) => (
                  <View key={block[0].id}>
                    {index > 0 ? <Hairline /> : null}
                    {block.map((exercise, offset) => {
                      const name = exercise.exercise?.name ?? 'Exercise';
                      const partner = block.length > 1 ? block[offset === 0 ? 1 : 0].exercise?.name : null;
                      const target = planTarget(exercise) ?? '';
                      return (
                        <View key={exercise.id}>
                          {offset > 0 ? <Hairline /> : null}
                          <Row
                            title={name}
                            detail={partner ? `Superset with ${partner}` : undefined}
                            value={target}
                            accessibilityLabel={[name, spokenTarget(target), partner ? `superset with ${partner}` : null].filter(Boolean).join(', ')}
                            onPress={() => editProgramDay(split, day.id)}
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
