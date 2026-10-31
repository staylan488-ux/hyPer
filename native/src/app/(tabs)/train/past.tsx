import { format, parseISO } from 'date-fns';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatActivityStartTime, getActivitySessionDateKey, resolveActivityTitle } from '@/lib/activitySessions';
import { historyDayKey, historyWorkoutTitle, moveHistoryMovement, orderHistoryMovements, type HistoryMovement, type HistoryWorkout } from '@/lib/historyMonth';
import { parseWorkoutNotes } from '@/lib/workoutNotes';
import { activityHasStats, searchWhoopForWorkout, workoutHasWhoopStats } from '@/lib/workoutWhoop';
import { formatWorkoutDuration, getWorkoutDurationMs } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import type { WorkoutSet } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import type { MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { formatLoad } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import {
  attachStats,
  confirmDeleteWorkout,
  detachStats,
  editPastWorkout,
  loadPlan,
  removePastSet,
  savePastNote,
  useHistoryStore,
} from '~/lib/history';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { space, useBlanc } from '~/theme/blanc';

/** One past workout: correct any set, add or take out sets and movements, keep notes, or delete it. */
export default function PastWorkoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = useHistoryStore((state) => state.workouts.find((entry) => entry.id === id) ?? null);
  // Deleted from here: the screen keeps showing it while it slides away.
  const [leaving, setLeaving] = useState<HistoryWorkout | null>(null);
  const workout = stored ?? leaving;
  const plan = useHistoryStore((state) => (id ? state.plans[id] : undefined));
  const activities = useHistoryStore((state) => state.activities);

  useEffect(() => {
    if (id) void loadPlan(id);
  }, [id]);

  const movements = useMemo(() => (workout ? orderHistoryMovements(workout.sets, plan ?? null) : []), [workout, plan]);
  const notes = useMemo(() => parseWorkoutNotes(workout?.notes ?? null).movementNotes, [workout?.notes]);

  if (!workout) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
          This workout is no longer here.
        </BlancText>
      </>
    );
  }

  const title = historyWorkoutTitle(workout, plan);
  const duration = formatWorkoutDuration(getWorkoutDurationMs(workout));
  const day = historyDayKey(workout);
  const orderedIds = movements.map((movement) => movement.exerciseId);
  const remove = () =>
    void confirmDeleteWorkout(title, workout.id, {
      onConfirmed: () => {
        setLeaving(workout);
        router.back();
      },
    });

  return (
    <>
      <Stack.Screen
        options={{
          title,
          unstable_headerRightItems: () => [
            {
              type: 'menu',
              label: 'Workout options',
              icon: { type: 'sfSymbol', name: 'ellipsis' },
              menu: {
                items: [
                  {
                    type: 'action',
                    label: 'Add movement',
                    icon: { type: 'sfSymbol', name: 'plus' },
                    onPress: () => {
                      haptics.tap();
                      addMovement(workout.id);
                    },
                  },
                  {
                    type: 'action',
                    label: 'Delete workout',
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
        }}
      />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {[format(parseISO(day), 'EEEE, MMMM d'), duration === '—' ? null : duration].filter(Boolean).join(' · ')}
        </BlancText>

        <Stats workout={workout} activities={activities.filter((activity) => getActivitySessionDateKey(activity) === day)} />

        {movements.length === 0 ? (
          <Section title="Movements">
            <Label>
              <Row title="No sets logged" quiet />
            </Label>
          </Section>
        ) : null}

        {movements.map((movement) => (
          <Animated.View key={movement.exerciseId} entering={rowEnter} exiting={blockExit} layout={rowLayout}>
            <MovementBlock workout={workout} movement={movement} note={notes[movement.exerciseId] || movement.planNote} orderedIds={orderedIds} />
          </Animated.View>
        ))}

        <Animated.View layout={rowLayout}>
          <Label style={{ marginTop: space.section }}>
            <Row title="Add movement" leading={<Plus />} onPress={() => addMovement(workout.id)} />
          </Label>
          <Label style={{ marginTop: 18 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                haptics.tap();
                remove();
              }}
              style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 18 }}>
              {({ pressed }) => (
                <BlancText variant="body" tone="live" style={{ opacity: pressed ? 0.5 : 1 }}>
                  Delete workout
                </BlancText>
              )}
            </Pressable>
          </Label>
        </Animated.View>
      </TabScroll>
    </>
  );
}

/** Opens the picker; the control that calls it plays the tap. */
function addMovement(workoutId: string) {
  router.push({ pathname: '/swap', params: { mode: 'add', workout: workoutId } });
}

function Plus() {
  const c = useBlanc();
  return <SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />;
}

/** Saves an edit, saying so when it did not save. */
function runEdit(workoutId: string, mutate: () => Promise<void>, failed = 'Not saved'): Promise<boolean> {
  return editPastWorkout(workoutId, mutate).then((saved) => {
    if (saved) haptics.success();
    else {
      haptics.error();
      Alert.alert(failed, 'Check your connection and try again.');
    }
    return saved;
  });
}

/** One movement: its sets (tap to correct, swipe to delete) and a menu for the rest. */
function MovementBlock({ workout, movement, note, orderedIds }: { workout: HistoryWorkout; movement: HistoryMovement; note: string; orderedIds: string[] }) {
  const c = useBlanc();
  const store = useAppStore.getState;
  // One Add set at a time: taps while one is saving do nothing.
  const adding = useRef(false);
  const [addingShown, setAddingShown] = useState(false);
  const line = [
    movement.substitutesFor ? `Instead of ${movement.substitutesFor.exercise_name ?? 'the planned movement'}` : null,
    movement.partnerName ? `Superset with ${movement.partnerName}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const editNote = () =>
    Alert.prompt(
      'Note',
      movement.name,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            void savePastNote(workout.id, movement.exerciseId, text ?? '').then((saved) => {
              if (saved) haptics.success();
              else {
                haptics.error();
                Alert.alert('Note not saved', 'Check your connection and try again.');
              }
            });
          },
        },
      ],
      'plain-text',
      note,
    );

  const confirmRemove = () =>
    Alert.alert(`Remove ${movement.name}?`, 'Its sets are deleted from this workout.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => void runEdit(workout.id, () => store().removeExerciseFromWorkout(workout.id, movement.exerciseId), 'Not removed'),
      },
    ]);

  const menu = () => {
    const actions: { label: string; run: () => void }[] = [
      { label: 'Add set', run: () => addSet() },
      { label: note ? 'Edit note' : 'Add note', run: editNote },
    ];
    const up = moveHistoryMovement(orderedIds, movement.exerciseId, -1);
    const down = moveHistoryMovement(orderedIds, movement.exerciseId, 1);
    if (up) actions.push({ label: 'Move up', run: () => void runEdit(workout.id, () => store().reorderWorkoutExercises(workout.id, up)) });
    if (down) actions.push({ label: 'Move down', run: () => void runEdit(workout.id, () => store().reorderWorkoutExercises(workout.id, down)) });
    if (movement.supersetGroupId) {
      actions.push({ label: 'Unlink superset', run: () => void runEdit(workout.id, () => store().clearWorkoutSuperset(workout.id, movement.exerciseId)) });
    } else {
      actions.push({
        label: 'Superset with…',
        run: () => router.push({ pathname: '/swap', params: { mode: 'superset', workout: workout.id, id: movement.exerciseId } }),
      });
    }
    actions.push({ label: 'Remove movement', run: confirmRemove });
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: movement.name,
        options: [...actions.map((action) => action.label), 'Cancel'],
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: actions.length - 1,
      },
      (index) => {
        if (index < actions.length) actions[index].run();
      },
    );
  };

  const addSet = () => {
    if (adding.current) return;
    adding.current = true;
    setAddingShown(true);
    void runEdit(
      workout.id,
      async () => {
        const created = await store().addSetToWorkout(workout.id, movement.exerciseId);
        if (!created) throw new Error('Could not add that set.');
      },
      'Set not added',
    ).then(() => {
      adding.current = false;
      setAddingShown(false);
    });
  };

  return (
    <Section
      title={movement.name}
      accessory={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${movement.name} options`}
          hitSlop={6}
          onPress={() => {
            haptics.tap();
            menu();
          }}
          style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
          <SymbolView name="ellipsis" size={17} weight="semibold" tintColor={c.ink} />
        </Pressable>
      }>
      {line || note ? (
        <View style={{ marginHorizontal: space.gutter, marginTop: -4, marginBottom: 8 }}>
          {line ? (
            <BlancText variant="secondary" tone="graphite">
              {line}
            </BlancText>
          ) : null}
          {note ? (
            // The note itself opens it to edit.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Note: ${note}`}
              accessibilityHint="Edit note"
              hitSlop={{ top: 6, bottom: 6 }}
              onPress={() => {
                haptics.tap();
                editNote();
              }}>
              {({ pressed }) => (
                <BlancText variant="secondary" tone="graphite" style={{ opacity: pressed ? 0.5 : 1 }}>
                  {note}
                </BlancText>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {movement.sets.map((set, index) => (
          <Animated.View key={set.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            <SetRow workoutId={workout.id} movement={movement} set={set} number={index + 1} />
          </Animated.View>
        ))}
        <Animated.View layout={rowLayout}>
          <Hairline />
          <Row title={addingShown ? 'Adding…' : 'Add set'} quiet leading={<Plus />} onPress={addSet} />
        </Animated.View>
      </Label>
    </Section>
  );
}

/** A set: tap to correct; swipe to delete (all the way deletes); hold for the menu. */
function SetRow({ workoutId, movement, set, number }: { workoutId: string; movement: HistoryMovement; set: WorkoutSet; number: number }) {
  const c = useBlanc();
  const name = `${movement.name} set ${number}`;
  const logged = set.weight !== null && set.reps !== null;
  const numbers = logged ? `${formatLoad(set.weight)} lb × ${set.reps}` : 'Not logged';
  const edit = () => router.push({ pathname: '/past-set', params: { workout: workoutId, set: set.id, number: String(number) } });
  // The row leaves at once; a delete that fails brings it back.
  const remove = () =>
    void removePastSet(workoutId, movement.exerciseId, set.id).then((deleted) => {
      if (deleted) haptics.success();
      else {
        haptics.error();
        Alert.alert('Set not deleted', 'Check your connection and try again.');
      }
    });
  const menu: MenuAction[] = [
    { title: 'Edit', symbol: 'pencil', run: edit },
    { title: 'Delete set', symbol: 'trash', destructive: true, removes: true, run: remove },
  ];

  return (
    <SwipeRow name={name} actions={[{ label: 'Delete', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row
          title={`Set ${number}`}
          quiet={!set.completed}
          value={set.rpe ? `${numbers}   RPE ${set.rpe}` : numbers}
          onPress={edit}
          menu={menu}
          accessibilityLabel={`Set ${number}, ${numbers}${set.rpe ? `, RPE ${set.rpe}` : ''}`}
        />
      </View>
    </SwipeRow>
  );
}

/** WHOOP strain and heart rate on the workout, or a way to add them from an activity that day. */
function Stats({ workout, activities }: { workout: HistoryWorkout; activities: Parameters<typeof searchWhoopForWorkout>[1] }) {
  const c = useBlanc();
  const attached = workoutHasWhoopStats(workout);
  const options = activities.filter(activityHasStats);
  if (!attached && options.length === 0) return null;

  if (attached) {
    const detail = [
      workout.avg_hr != null ? `${workout.avg_hr} avg bpm` : null,
      workout.max_hr != null ? `${workout.max_hr} max` : null,
      workout.energy_kcal != null ? `${Math.round(workout.energy_kcal)} kcal` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const removeStats = () =>
      void detachStats(workout).then((ok) => {
        if (ok) haptics.success();
        else {
          haptics.error();
          Alert.alert('Not removed', 'Check your connection and try again.');
        }
      });
    const menu = () =>
      ActionSheetIOS.showActionSheetWithOptions(
        { title: 'WHOOP stats', message: 'The activity returns to its day.', options: ['Remove stats', 'Cancel'], cancelButtonIndex: 1, destructiveButtonIndex: 0 },
        (index) => {
          if (index === 0) removeStats();
        },
      );
    return (
      <Section title="Stats">
        <Label style={{ overflow: 'hidden' }}>
          <SwipeRow name="WHOOP stats" actions={[{ label: 'Remove', destructive: true, onPress: removeStats }]}>
            <View style={{ backgroundColor: c.label }}>
              <Row
                title={workout.strain != null ? `Strain ${workout.strain.toFixed(1)}` : 'WHOOP stats'}
                detail={detail || undefined}
                onPress={menu}
                menu={[{ title: 'Remove stats', subtitle: 'The activity returns to its day', symbol: 'minus.circle', destructive: true, run: removeStats }]}
              />
            </View>
          </SwipeRow>
        </Label>
      </Section>
    );
  }

  const suggested = searchWhoopForWorkout(workout, options).match?.session.id ?? null;
  const ordered = [...options].sort((a, b) => Number(b.id === suggested) - Number(a.id === suggested));
  const pick = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: 'Add stats from',
        message: 'Its strain and heart rate move onto this workout, and it leaves the day’s activities.',
        options: [
          ...ordered.map(
            (activity) =>
              `${resolveActivityTitle(activity)}${activity.started_at ? ` · ${formatActivityStartTime(activity.started_at)}` : ''}${activity.id === suggested ? ' (closest)' : ''}`,
          ),
          'Cancel',
        ],
        cancelButtonIndex: ordered.length,
      },
      (index) => {
        if (index >= ordered.length) return;
        void attachStats(workout, ordered[index]).then((ok) => {
          if (ok) haptics.success();
          else {
            haptics.error();
            Alert.alert('Not added', 'Check your connection and try again.');
          }
        });
      },
    );
  return (
    <Section title="Stats">
      <Label>
        <Row title="Add WHOOP stats" detail="From an activity on this day" onPress={pick} />
      </Label>
    </Section>
  );
}

