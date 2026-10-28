import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, type ComponentProps } from 'react';
import { ActionSheetIOS, Alert, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { isPendingExerciseId } from '@/lib/customExercises';
import { dayLabel, exerciseBlocks, type DraftExercise } from '@/lib/splitDraft';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { UndoBar } from '~/components/UndoBar';
import { haptics } from '~/lib/haptics';
import { targetsLine } from '~/lib/program';
import { space, useBlanc } from '~/theme/blanc';

/** One training day of the draft: its exercises, in order, to change, pair, swap or remove. */
export default function ProgramDayScreen() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const index = useSplitEditStore((state) => state.draft?.days.findIndex((day) => day.id === id) ?? -1);
  const day = useSplitEditStore((state) => state.draft?.days.find((entry) => entry.id === id) ?? null);
  const undo = useSplitEditStore((state) => state.undo);
  const blocks = useMemo(() => (day ? exerciseBlocks(day.exercises) : []), [day]);
  const label = day ? dayLabel(day, index) : '';

  const rename = () =>
    Alert.prompt(
      'Day name',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Save', onPress: (text?: string) => useSplitEditStore.getState().renameDay(id, (text ?? '').slice(0, 40)) },
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
          <Label style={{ overflow: 'hidden' }}>
            {blocks.map((block, blockIndex) => (
              <Animated.View key={block[0].id} entering={FadeIn.duration(160)} exiting={FadeOut.duration(180)} layout={LinearTransition.duration(220)}>
                {blockIndex > 0 ? <Hairline /> : null}
                {block.map((exercise, offset) => (
                  <View key={exercise.id}>
                    {offset > 0 ? <Hairline /> : null}
                    <ExerciseRow
                      dayId={day.id}
                      exercise={exercise}
                      partner={block.length > 1 ? block[offset === 0 ? 1 : 0] : null}
                      canMoveUp={blockIndex > 0}
                      canMoveDown={blockIndex < blocks.length - 1}
                    />
                  </View>
                ))}
              </Animated.View>
            ))}
            <Animated.View layout={LinearTransition.duration(220)}>
              {blocks.length > 0 ? <Hairline /> : null}
              <Row title="Add exercises" leading={<SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />} onPress={add} />
            </Animated.View>
          </Label>
        </Section>
      </ScrollView>
      <UndoBar label={undo?.label ?? null} onUndo={() => useSplitEditStore.getState().undoRemoval()} />
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
  const remove = () => store().removeExercise(dayId, exercise.id);
  const menu = () => {
    const actions: { label: string; run: () => void }[] = [
      { label: 'Sets and reps', run: open },
      { label: 'Swap exercise', run: swap },
      partner
        ? { label: 'Unlink superset', run: () => store().clearExerciseSuperset(dayId, exercise.id) }
        : { label: 'Add superset', run: () => router.push({ pathname: '/swap', params: { program: 'superset', day: dayId, id: exercise.id } }) },
      ...(canMoveUp ? [{ label: partner ? 'Move superset earlier' : 'Move earlier', run: () => store().reorderExercise(dayId, exercise.id, -1) }] : []),
      ...(canMoveDown ? [{ label: partner ? 'Move superset later' : 'Move later', run: () => store().reorderExercise(dayId, exercise.id, 1) }] : []),
      { label: 'Remove', run: remove },
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: name,
        options: [...actions.map((action) => action.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: actions.length - 1,
      },
      (choice) => {
        if (choice < actions.length) actions[choice].run();
      },
    );
  };
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
        <Row title={name} detail={detail} chevron onPress={open} onLongPress={{ label: 'More actions', run: menu }} />
      </View>
    </SwipeRow>
  );
}
