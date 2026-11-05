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
import { getWorkoutDurationMs } from '@/lib/workoutSessions';
import { fetchPreviousSetTargets } from '@/lib/previousSetTargets';
import type { PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { WorkoutSet } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import type { MenuAction } from '~/components/HoldMenu';
import { LoggedSetRow } from '~/components/LoggedSetRow';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { Tally } from '~/components/Tally';
import { announce, speak } from '~/lib/accessibility';
import { gainOnLastTime } from '~/lib/beatLastTime';
import { formatMinutes } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import {
  attachStats,
  confirmDeleteWorkout,
  detachStats,
  editPastWorkout,
  loadPlan,
  movePastMovement,
  removePastSet,
  savePastNote,
  useHistoryStore,
} from '~/lib/history';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { planTarget } from '~/lib/program';
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

  // Last time's numbers for these movements, so a set that beat them shows its ↑ as it did live.
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [previous, setPrevious] = useState<PreviousWorkoutSetMap>({});
  const exerciseKey = movements.map((movement) => movement.exerciseId).sort().join(',');
  const workoutId = workout?.id ?? null;
  const workoutDate = workout?.date ?? null;
  const workoutStartedAt = workout?.created_at ?? null;
  useEffect(() => {
    if (!userId || !workoutId || !workoutDate || !exerciseKey) return;
    let on = true;
    void fetchPreviousSetTargets({ userId, workoutId, date: workoutDate, beforeCreatedAt: workoutStartedAt, exerciseIds: exerciseKey.split(',') }).then((result) => {
      if (on && result) setPrevious(result);
    });
    return () => {
      on = false;
    };
  }, [userId, workoutId, workoutDate, workoutStartedAt, exerciseKey]);

  if (!workout) {
    return (
      <>
        <Stack.Screen options={{ title: '' }} />
        {/* In the screen's scroll view, so it sits below the header as the workout would. */}
        <TabScroll>
          <BlancText variant="secondary" tone="graphite" style={{ margin: space.gutter }}>
            This workout is no longer here.
          </BlancText>
        </TabScroll>
      </>
    );
  }

  const title = historyWorkoutTitle(workout, plan);
  const durationMs = getWorkoutDurationMs(workout);
  const day = historyDayKey(workout);
  // Read like the receipt at Finish: when it started and how long it ran.
  const started = workout.created_at ? new Date(workout.created_at) : null;
  const startedAt = started && !Number.isNaN(started.getTime()) ? started : null;
  const length = durationMs ? formatMinutes(Math.max(1, Math.round(durationMs / 60000))) : null;
  const meta = [startedAt ? format(startedAt, 'EEE · MMM d · h:mm a') : format(parseISO(day), 'EEE · MMM d'), length].filter(Boolean).join(' · ');
  // VoiceOver hears the day and month in full and the length in words:
  // "Tuesday, November 4, 7:05 AM, 1 hour 5 minutes".
  const spokenMeta = speak(
    [startedAt ? format(startedAt, 'EEEE, MMMM d, h:mm a') : format(parseISO(day), 'EEEE, MMMM d'), length].filter(Boolean).join(', '),
  );
  const marks = movements.flatMap((movement) => movement.sets.map((set) => set.completed));
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
        <BlancText variant="meta" size={13} tone="graphite" accessibilityLabel={spokenMeta} style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {meta}
        </BlancText>
        {marks.length > 0 ? (
          <Tally
            marks={marks}
            current={null}
            height={20}
            accessibilityLabel={`${marks.filter(Boolean).length} of ${marks.length} sets logged`}
            style={{ marginHorizontal: space.gutter, marginTop: 14 }}
          />
        ) : null}

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
            <MovementBlock
              workout={workout}
              movement={movement}
              note={notes[movement.exerciseId] || movement.planNote}
              orderedIds={orderedIds}
              previous={previous}
            />
          </Animated.View>
        ))}

        <Animated.View layout={rowLayout}>
          <Label style={{ marginTop: space.section }}>
            <Row title="Add movement" leading={<Plus />} onPress={() => addMovement(workout.id)} />
          </Label>
          <Label style={{ marginTop: 18 }}>
            <Row title="Delete workout" destructive onPress={remove} />
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

/** Saves an edit, saying so when it did not save; VoiceOver also hears `done` when it did. */
function runEdit(workoutId: string, mutate: () => Promise<void>, failed = 'Not saved', done?: string): Promise<boolean> {
  return editPastWorkout(workoutId, mutate).then((saved) => {
    if (saved) {
      haptics.success();
      announce(done);
    } else {
      haptics.error();
      Alert.alert(failed, 'Check your connection and try again.');
    }
    return saved;
  });
}

/** One movement: its sets (tap to correct, swipe to delete) and a menu for the rest. */
function MovementBlock({
  workout,
  movement,
  note,
  orderedIds,
  previous,
}: {
  workout: HistoryWorkout;
  movement: HistoryMovement;
  note: string;
  orderedIds: string[];
  previous: PreviousWorkoutSetMap;
}) {
  const c = useBlanc();
  const store = useAppStore.getState;
  // One Add set at a time: taps while one is saving do nothing.
  const adding = useRef(false);
  const [addingShown, setAddingShown] = useState(false);
  // One set with an RPE keeps the column on every row, so the numbers line up.
  const rpeColumn = movement.sets.some((set) => set.rpe);
  // What the plan asked for, beside the name: "4 × 8–10".
  const target = movement.plan ? planTarget(movement.plan) : null;
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
              if (saved) {
                haptics.success();
                announce('Note saved');
              } else {
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
        onPress: () =>
          void runEdit(workout.id, () => store().removeExerciseFromWorkout(workout.id, movement.exerciseId), 'Not removed', `${movement.name} removed`),
      },
    ]);

  const menu = () => {
    const actions: { label: string; run: () => void }[] = [
      { label: 'Add set', run: () => addSet() },
      { label: note ? 'Edit note' : 'Add note', run: editNote },
    ];
    // The order is worked out when the move runs, after any move before it.
    const move = (direction: -1 | 1, done: string) => () =>
      void runEdit(workout.id, () => movePastMovement(workout.id, movement.exerciseId, direction), undefined, done);
    if (moveHistoryMovement(orderedIds, movement.exerciseId, -1)) actions.push({ label: 'Move up', run: move(-1, 'Moved up') });
    if (moveHistoryMovement(orderedIds, movement.exerciseId, 1)) actions.push({ label: 'Move down', run: move(1, 'Moved down') });
    if (movement.supersetGroupId) {
      actions.push({
        label: 'Unlink superset',
        run: () => void runEdit(workout.id, () => store().clearWorkoutSuperset(workout.id, movement.exerciseId), undefined, 'Superset unlinked'),
      });
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
      'Set added',
    ).then(() => {
      adding.current = false;
      setAddingShown(false);
    });
  };

  return (
    <Section
      title={movement.name}
      note={target ?? undefined}
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
              // A line drawn 20 points tall, 44 to touch: over the quiet line
              // above it when there is one (without it, ⋯ sits just above), and
              // down to the sets.
              hitSlop={{ top: line ? 16 : 6, bottom: 8 }}
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
            <SetRow workoutId={workout.id} movement={movement} set={set} number={index + 1} rpeColumn={rpeColumn} previous={previous} />
          </Animated.View>
        ))}
        <Animated.View layout={rowLayout}>
          <Hairline />
          <Row title={addingShown ? 'Adding…' : 'Add set'} leading={<Plus />} onPress={addSet} />
        </Animated.View>
      </Label>
    </Section>
  );
}

/** A set: tap to correct; swipe to delete (all the way deletes); hold for the menu. */
function SetRow({
  workoutId,
  movement,
  set,
  number,
  rpeColumn,
  previous,
}: {
  workoutId: string;
  movement: HistoryMovement;
  set: WorkoutSet;
  number: number;
  rpeColumn: boolean;
  previous: PreviousWorkoutSetMap;
}) {
  const c = useBlanc();
  const name = `${movement.name} set ${number}`;
  const edit = () => router.push({ pathname: '/past-set', params: { workout: workoutId, set: set.id, number: String(number) } });
  // The row leaves at once; a delete that fails brings it back.
  const remove = () =>
    void removePastSet(workoutId, movement.exerciseId, set.id).then((deleted) => {
      if (deleted) {
        haptics.success();
        announce(`Set ${number} deleted`);
      } else {
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
        <LoggedSetRow number={number} set={set} rpeColumn={rpeColumn} gain={set.completed ? gainOnLastTime(set, previous, movement.sets) : null} onPress={edit} menu={menu} />
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
    const spoken = [
      workout.strain != null ? `Strain ${workout.strain.toFixed(1)}` : 'WHOOP stats',
      workout.avg_hr != null ? `average heart rate ${workout.avg_hr}` : null,
      workout.max_hr != null ? `max ${workout.max_hr}` : null,
      workout.energy_kcal != null ? `${Math.round(workout.energy_kcal)} kcal` : null,
    ]
      .filter(Boolean)
      .join(', ');
    const removeStats = () =>
      void detachStats(workout).then((ok) => {
        if (ok) {
          haptics.success();
          announce('Stats removed');
        } else {
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
                accessibilityLabel={spoken}
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
          if (ok) {
            haptics.success();
            announce('Stats added');
          } else {
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

