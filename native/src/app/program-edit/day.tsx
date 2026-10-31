import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, type ComponentProps } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { isPendingExerciseId } from '@/lib/customExercises';
import { dayLabel, exerciseBlocks, type DraftExercise } from '@/lib/splitDraft';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import type { MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { UndoBar } from '~/components/UndoBar';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { targetsLine } from '~/lib/program';
import { space, useBlanc } from '~/theme/blanc';

/** One training day of the draft: its exercises, in order, to change, pair, swap or remove. */
export default function ProgramDayScreen() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const index = useSplitEditStore((state) => state.draft?.days.findIndex((day) => day.id === id) ?? -1);
  const day = useSplitEditStore((state) => state.draft?.days.find((entry) => entry.id === id) ?? null);
  const undo = useSplitEditStore((state) => state.undo);
  // The Undo bar belongs to the screen on top.
  const focused = useIsFocused();
  const blocks = useMemo(() => (day ? exerciseBlocks(day.exercises) : []), [day]);
  const label = day ? dayLabel(day, index) : '';

  const rename = () =>
    Alert.prompt(
      'Day name',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            haptics.select();
            useSplitEditStore.getState().renameDay(id, (text ?? '').slice(0, 40));
          },
        },
      ],
      'plain-text',
      day?.day_name ?? '',
    );

  const options = useMemo(
    () => ({
        title: label,
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: 'Rename day',
            icon: { type: 'sfSymbol', name: 'pencil' },
            onPress: () => {
              haptics.tap();
              rename();
            },
          },
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [label],
  );

  if (!day) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
          This day was removed.
        </BlancText>
      </>
    );
  }

  const add = () => router.push({ pathname: '/swap', params: { program: 'add', day: day.id } });

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 120 }}>
        <Section
          title="Exercises"
          style={{ marginTop: 12 }}
          action={blocks.length > 1 ? { title: 'Reorder', onPress: () => router.push({ pathname: '/program-reorder', params: { day: day.id } }) } : undefined}>
          <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
            {/* One row per exercise, so taking one out of a pair folds that row alone. */}
            {blocks.flatMap((block, blockIndex) =>
              block.map((exercise, offset) => (
                <Animated.View key={exercise.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                  {blockIndex > 0 || offset > 0 ? <Hairline /> : null}
                  <ExerciseRow
                    dayId={day.id}
                    exercise={exercise}
                    partner={block.length > 1 ? block[offset === 0 ? 1 : 0] : null}
                    canMoveUp={blockIndex > 0}
                    canMoveDown={blockIndex < blocks.length - 1}
                  />
                </Animated.View>
              )),
            )}
            <Animated.View layout={rowLayout}>
              {blocks.length > 0 ? <Hairline /> : null}
              <Row title="Add exercises" leading={<SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />} onPress={add} />
            </Animated.View>
          </Label>
        </Section>
      </ScrollView>
      <UndoBar label={focused ? (undo?.label ?? null) : null} onUndo={() => useSplitEditStore.getState().undoRemoval()} />
    </>
  );
}

/** An exercise: tap for its sets and reps; swipe to swap or remove; hold for everything else. */
function ExerciseRow({ dayId, exercise, partner, canMoveUp, canMoveDown }: {
  dayId: string;
  exercise: DraftExercise;
  partner: DraftExercise | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const c = useBlanc();
  const store = useSplitEditStore.getState;
  const name = exercise.exercise.name;
  const open = () => router.push({ pathname: '/program-exercise', params: { day: dayId, exercise: exercise.id } });
  const swap = () => router.push({ pathname: '/swap', params: { program: 'swap', day: dayId, id: exercise.id } });
  // A draft change: the Undo bar can bring it back.
  const remove = () => {
    store().removeExercise(dayId, exercise.id);
    haptics.success();
  };
  const move = (direction: -1 | 1) => {
    haptics.select();
    store().reorderExercise(dayId, exercise.id, direction);
  };
  // Grouped as iOS menus are: what to change, where it sits, then remove.
  const menu: MenuAction[] = [
    { title: 'Sets and reps', symbol: 'slider.horizontal.3', run: open },
    { title: 'Swap exercise', symbol: 'arrow.left.arrow.right', run: swap },
    partner
      ? {
          title: 'Unlink superset',
          symbol: 'link.badge.minus',
          run: () => {
            haptics.select();
            store().clearExerciseSuperset(dayId, exercise.id);
          },
        }
      : { title: 'Add superset', symbol: 'link', run: () => router.push({ pathname: '/swap', params: { program: 'superset', day: dayId, id: exercise.id } }) },
    ...(canMoveUp || canMoveDown
      ? [
          {
            title: '',
            inline: true,
            children: [
              ...(canMoveUp ? [{ title: partner ? 'Move superset earlier' : 'Move earlier', symbol: 'arrow.up', run: () => move(-1) }] : []),
              ...(canMoveDown ? [{ title: partner ? 'Move superset later' : 'Move later', symbol: 'arrow.down', run: () => move(1) }] : []),
            ],
          },
        ]
      : []),
    { title: 'Remove', symbol: 'trash', destructive: true, removes: true, run: remove },
  ];
  const detail = [
    targetsLine(exercise),
    partner ? `superset with ${partner.exercise.name}` : null,
    isPendingExerciseId(exercise.exercise_id) ? 'custom, added on save' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SwipeRow
      name={name}
      actions={[
        { label: 'Swap', onPress: swap },
        { label: 'Remove', destructive: true, onPress: remove },
      ]}>
      <View style={{ backgroundColor: c.label }}>
        <Row title={name} detail={detail} chevron onPress={open} menu={menu} />
      </View>
    </SwipeRow>
  );
}
