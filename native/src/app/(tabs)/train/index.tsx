import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { differenceInCalendarWeeks, format, parseISO } from 'date-fns';
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode, type Ref } from 'react';
import { AccessibilityInfo, Alert, Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, type ViewStyle } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { moveMovementBlock, movementBlocks } from '@/lib/movementOrder';
import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { DragList } from '~/components/DragList';
import { FigureInput } from '~/components/FigureInput';
import { FormNote, type TextField } from '~/components/Form';
import { Label } from '~/components/Label';
import { PlanCard } from '~/components/PlanCard';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow, type SwipeAction } from '~/components/SwipeRow';
import { TabScroll, tabBarCover } from '~/components/TabScroll';
import { Tally } from '~/components/Tally';
import { UndoBar } from '~/components/UndoBar';
import { useAccountRefresh } from '~/lib/accountData';
import { gainOnLastTime } from '~/lib/beatLastTime';
import { useFinishWorkout } from '~/lib/finishWorkout';
import { formatClock, formatRepRange, formatSet, formatTarget } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { rowLayout } from '~/lib/motion';
import { confirmRemoveMovement, errorMessage, renameSession, reorderMovements, setSkipped } from '~/lib/movement';
import { startRest } from '~/lib/rest';
import { useFocusStore, useNow, usePreviousNotes, usePreviousTargets, useSessionModel, useStartSession, type SessionModel } from '~/lib/session';
import { afterLoggedSet } from '~/lib/sessionModel';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { useTodayPlan } from '~/lib/today';
import { devScrollTrace } from '~/platform/devLaunch';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

type Current = NonNullable<SessionModel['current']>;
type Movement = SessionModel['movements'][number];
/** The numbers for the set about to be logged. `touched` once the person edits them. */
type Draft = { setId: string; weight: string; reps: string; rpe: number | null; touched: boolean };

/** How long "Beat last time" holds in the card after the set saves. */
const BEAT_MOMENT_MS = 4000;
/** How long Undo stays after a skip, as in the program editor. */
const UNDO_MS = 5000;
/** Each skip's own token, so Undo and a failed save only ever clear their own skip. */
let skipCount = 0;
const nextSkipKey = () => (skipCount += 1);

/**
 * Runs `work` and tells whether it finished without throwing. The try lives
 * out here because the React Compiler can't yet compile a component whose
 * own code branches inside a try.
 */
async function succeeds(work: () => Promise<void>): Promise<boolean> {
  try {
    await work();
    return true;
  } catch {
    return false;
  }
}

/**
 * The web's autofill rule: set 1 starts from last workout's set 1, later sets
 * from the latest set logged in this workout.
 */
function suggestedDraft(current: Current, previous: PreviousWorkoutSetMap): Draft {
  const autofill = getSetAutofillValues({
    exerciseId: current.movement.exerciseId,
    setNumber: current.set.set_number,
    currentExerciseSets: current.movement.sets,
    previousWorkoutSetsByExercise: previous,
  });
  const rpe = current.set.rpe ?? (autofill?.rpe ? Number(autofill.rpe) : null);
  return {
    setId: current.set.id,
    weight: current.set.weight !== null ? String(current.set.weight) : (autofill?.weight ?? ''),
    reps: current.set.reps !== null ? String(current.set.reps) : (autofill?.reps ?? ''),
    rpe: rpe !== null && Number.isFinite(rpe) ? rpe : null,
    touched: false,
  };
}

/** The set card's figures at their largest: the row keeps this height whatever size they step down to. */
const FIGURE_SIZE = 76;

/**
 * The weight and reps share one size, stepping down as their digits add up,
 * so "102.5 × 10" still fits the card beside its units.
 */
function figureSize(weight: string, reps: string): number {
  const length = Math.max(1, weight.length) + Math.max(1, reps.length);
  return length <= 5 ? FIGURE_SIZE : length <= 6 ? 64 : length <= 7 ? 56 : length <= 8 ? 50 : 44;
}

export default function TrainScreen() {
  const session = useSessionModel();
  if (!session) return <StartWorkout />;
  return <LiveWorkout session={session} />;
}

/** The session clock; ticks on its own so the screen around it stays still. */
function Elapsed({ startedAt, done, total }: { startedAt: Date; done: number; total: number }) {
  const now = useNow(1000);
  const elapsed = Math.max(0, (now - startedAt.getTime()) / 1000);
  return (
    <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
      <BlancText variant="meta" size={14} tone="graphite">
        {formatClock(elapsed)}
      </BlancText>
      {total > 0 ? ` · ${done} of ${total} sets` : null}
    </BlancText>
  );
}

function LiveWorkout({ session }: { session: SessionModel }) {
  const c = useBlanc();
  const previous = usePreviousTargets(session.workoutId);
  const previousNotes = usePreviousNotes(session);
  const logSet = useAppStore((state) => state.logSet);
  const focus = useFocusStore((state) => state.focus);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const scrollOffset = useRef(0);
  const cardRef = useRef<ComponentRef<typeof View>>(null);
  const insets = useSafeAreaInsets();

  // After switching movement, scroll only if the workout card is hidden under
  // the navigation bar, and only enough to show it. Forcing a scroll to the
  // top fought the large title (and short pages, which cannot scroll), and
  // made the screen twitch.
  const revealCard = () => {
    requestAnimationFrame(() => {
      cardRef.current?.measureInWindow((_x, y) => {
        const visibleTop = insets.top + 56;
        if (y >= visibleTop) return;
        scroll.current?.scrollTo({ y: scrollOffset.current - (visibleTop + 12 - y), animated: true });
      });
    });
  };
  const focusedId = useFocusStore((state) => state.exerciseId);
  const focusSeen = useRef(focusedId);
  const onFocusChange = useEffectEvent(() => revealCard());
  useEffect(() => {
    if (focusSeen.current === focusedId) return;
    focusSeen.current = focusedId;
    onFocusChange();
  }, [focusedId]);

  const current = session.current;
  const [draft, setDraft] = useState<Draft | null>(() => (current ? suggestedDraft(current, previous) : null));
  const [saving, setSaving] = useState(false);
  // The set whose save failed: its card says so and offers Retry. Another
  // movement's card never does, so Retry can't log numbers for the wrong set.
  const [failedSetId, setFailedSetId] = useState<string | null>(null);
  const failed = failedSetId !== null && failedSetId === current?.set.id;
  const [editing, setEditing] = useState<'weight' | 'reps' | null>(null);
  // The last saved set, when it beat last time. Its gain shows in place of
  // "Last time" for a moment (`fresh`), and stays on "All sets logged".
  const [beat, setBeat] = useState<{ key: number; gain: string; fresh: boolean } | null>(null);
  useEffect(() => {
    if (!beat?.fresh) return;
    const timer = setTimeout(() => setBeat((latest) => (latest?.key === beat.key ? { ...latest, fresh: false } : latest)), BEAT_MOMENT_MS);
    return () => clearTimeout(timer);
  }, [beat]);
  // The latest skip, to take back from the bar at the foot for a few seconds.
  const [undo, setUndo] = useState<{ key: number; exerciseId: string; name: string; wasCurrent: boolean } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo((latest) => (latest?.key === undo.key ? null : latest)), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);
  const weightField = useRef<TextField>(null);
  const repsField = useRef<TextField>(null);

  // A new set starts from its suggested numbers; the same set keeps any edits,
  // including after a failed save.
  const currentSetId = current?.set.id ?? null;
  const onSetChange = useEffectEvent(() => {
    setDraft((existing) => {
      if (!current) return null;
      return existing?.setId === current.set.id ? existing : suggestedDraft(current, previous);
    });
    setFailedSetId(null);
  });
  useEffect(() => onSetChange(), [currentSetId]);

  // "Last time" arrives after the screen opens: fill it into an untouched set.
  const onPreviousChange = useEffectEvent(() => {
    setDraft((existing) => {
      if (!current || !existing || existing.touched || existing.setId !== current.set.id) return existing;
      return suggestedDraft(current, previous);
    });
  });
  useEffect(() => onPreviousChange(), [previous]);

  const weight = draft ? parseNumber(draft.weight) : null;
  const reps = draft ? parseNumber(draft.reps) : null;
  const ready = weight !== null && reps !== null;
  const figure = draft ? figureSize(draft.weight, draft.reps) : FIGURE_SIZE;
  const last = current ? previous[current.movement.exerciseId]?.[current.set.set_number] : undefined;
  const lastLine = last ? formatSet(last.weight, last.reps, { unit: false }) : '';
  const lastNote = current ? previousNotes[current.movement.exerciseId] : undefined;

  const blocked = current?.blocked ?? null;

  const log = async () => {
    if (!current || !draft || weight === null || reps === null || saving || blocked) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailedSetId(null);
    setBeat(null);
    const logged = current.set;
    const loggedReps = Math.round(reps);
    const saved = await succeeds(async () => {
      await logSet(logged.id, weight, loggedReps, draft.rpe ?? undefined);
      // Beating the same set last time gets a firmer haptic and a quiet line.
      const gain = gainOnLastTime({ ...logged, weight, reps: loggedReps }, previous);
      if (gain) {
        haptics.beat();
        setBeat({ key: Date.now(), gain, fresh: true });
        AccessibilityInfo.announceForAccessibility(`Beat last time, ${gain}`);
      } else {
        haptics.success();
      }
      // The web's order: a superset's partner for the same round, else more of
      // this movement, else the next in turn. A superset rests after B only.
      const after = afterLoggedSet(session, logged, useAppStore.getState().currentWorkout?.sets ?? []);
      const chosen = useFocusStore.getState().exerciseId;
      if (after.nextExerciseId && (!chosen || chosen === logged.exercise_id)) focus(after.nextExerciseId);
      if (after.rest) startRest(current.movement.exerciseId);
    });
    if (!saved) {
      haptics.error();
      setFailedSetId(logged.id);
    }
    setSaving(false);
  };

  const bump = (field: 'weight' | 'reps', delta: number) => {
    setDraft((existing) => {
      if (!existing) return existing;
      const value = parseNumber(existing[field]) ?? 0;
      // 12.7 − 5 is 7.7, not 7.699999999999999
      const next = Math.round(Math.max(0, value + delta) * 100) / 100;
      return { ...existing, [field]: String(next), touched: true };
    });
    haptics.select();
  };

  const pickRpe = () =>
    chooseRpe((rpe) => setDraft((existing) => (existing ? { ...existing, rpe, touched: true } : existing)));

  /** Sets, note and swap for one movement. */
  const openMovement = (exerciseId: string) => router.push({ pathname: '/movement', params: { id: exerciseId } });

  // Skip a movement for this workout only: the next one in turn comes up at
  // once, and Undo (or a tap on its row) brings it back. Callers give the tap.
  const skip = (movement: Movement) => {
    Keyboard.dismiss();
    const wasCurrent = movement.exerciseId === current?.movement.exerciseId;
    const key = nextSkipKey();
    setUndo({ key, exerciseId: movement.exerciseId, name: movement.name, wasCurrent });
    AccessibilityInfo.announceForAccessibility(`${movement.name} skipped`);
    void setSkipped(session.workoutId, movement, true).then((saved) => {
      if (saved) return;
      setUndo((latest) => (latest?.key === key ? null : latest));
      if (wasCurrent && useFocusStore.getState().exerciseId === null) focus(movement.exerciseId);
    });
  };

  /** Brings a skipped movement back; `next` makes it the one up now. */
  const bringBack = (movement: Pick<Movement, 'exerciseId' | 'name'>, next: boolean) => {
    setUndo((latest) => (latest?.exerciseId === movement.exerciseId ? null : latest));
    if (next) focus(movement.exerciseId);
    void setSkipped(session.workoutId, movement, false);
  };

  const { finish, closing } = useFinishWorkout(session);

  // The header is built once per name and state, never per keystroke or
  // clock tick, so its buttons are not re-sent to iOS under the finger.
  const { workoutId, dayName, flexible } = session;
  const headerOptions = useMemo(
    () =>
      ({
        title: dayName,
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: closing ? 'Saving…' : 'Finish',
            variant: 'prominent',
            tintColor: c.ink,
            disabled: closing,
            onPress: () => {
              haptics.tap();
              finish();
            },
          },
          {
            // Rest without logging a set, or change a movement's rest length.
            type: 'button',
            label: 'Rest timer',
            icon: { type: 'sfSymbol', name: 'timer' },
            disabled: closing,
            onPress: () => {
              haptics.tap();
              router.push('/rest');
            },
          },
          // A flexible session is named by the person; it can be renamed.
          ...(flexible
            ? [
                {
                  type: 'button' as const,
                  label: 'Rename workout',
                  icon: { type: 'sfSymbol' as const, name: 'pencil' as const },
                  disabled: closing,
                  onPress: () => {
                    haptics.tap();
                    renameWorkout(workoutId, dayName);
                  },
                },
              ]
            : []),
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    [workoutId, dayName, closing, c.ink, flexible, finish],
  );

  // A drop saves this session's order at once (never the program); while it
  // saves rows stay put, and a failed save puts the old order back.
  const [reordering, setReordering] = useState(false);
  const [orderRevision, setOrderRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Blocks: a superset pair moves as one. (Computed after every hook, so the
  // React Compiler can keep the movement list from rebuilding as you type.)
  const blocks = movementBlocks(
    session.movements.map((movement) => ({ id: movement.exerciseId, name: movement.name, supersetGroupId: movement.superset?.groupId })),
  );
  const byId = new Map(session.movements.map((movement) => [movement.exerciseId, movement]));
  const moveBlock = async (key: string, index: number) => {
    if (reordering) return;
    const ids = moveMovementBlock(blocks, key, index);
    setReordering(true);
    try {
      await reorderMovements(session.workoutId, ids);
    } catch (failure) {
      haptics.error();
      setOrderRevision((value) => value + 1);
      Alert.alert('Order not saved', errorMessage(failure, 'Check your connection and try again.'));
    }
    setReordering(false);
  };

  const movementRow = (movement: Movement, blockIndex: number) => {
    const isCurrent = movement.exerciseId === current?.movement.exerciseId;
    const complete = movement.done === movement.sets.length;
    const plan = movement.plan;
    const lastSet = previous[movement.exerciseId]?.[1];
    const lastLine = lastSet ? formatSet(lastSet.weight, lastSet.reps, { unit: false }) : '';
    const hasSetsLeft = movement.sets.some((set) => !set.completed);
    // Swipe to swap or skip a movement with sets to go and, in a flexible
    // session, to take it out (asks first).
    const swipe: SwipeAction[] = [
      ...(hasSetsLeft
        ? [{ label: 'Swap', onPress: () => router.push({ pathname: '/swap', params: { id: movement.exerciseId, from: 'train' } }) }]
        : []),
      ...(hasSetsLeft && !movement.skipped ? [{ label: 'Skip', onPress: () => skip(movement) }] : []),
      ...(session.flexible
        ? [{ label: 'Remove', destructive: true, onPress: () => confirmRemoveMovement(session.workoutId, movement) }]
        : []),
    ];
    // What a hold, a swipe and a drag do, for VoiceOver.
    const actions = [
      { label: 'Sets, note and swap', run: () => openMovement(movement.exerciseId) },
      ...(hasSetsLeft && !movement.skipped ? [{ label: 'Skip for this workout', run: () => skip(movement) }] : []),
      ...(blockIndex > 0 ? [{ label: 'Move up', run: () => void moveBlock(blocks[blockIndex][0], blockIndex - 1) }] : []),
      ...(blockIndex < blocks.length - 1 ? [{ label: 'Move down', run: () => void moveBlock(blocks[blockIndex][0], blockIndex + 1) }] : []),
    ];
    // Each movement ends with its own tally; the next set stands taller on the row up now.
    const tally = (
      <Tally
        compact
        marks={movement.sets.map((set) => set.completed)}
        current={isCurrent && current ? current.setNumber - 1 : null}
        accessibilityLabel={`${movement.done} of ${movement.sets.length} sets done`}
      />
    );
    // Up now, the card above says the rest; later rows give the target (this
    // workout's set count) and last time.
    const detail = isCurrent
      ? 'Now'
      : [
          movement.superset
            ? `Superset ${movement.superset.role}`
            : movement.substitutesFor
              ? `Instead of ${movement.substitutesFor.exercise_name ?? 'the planned movement'}`
              : plan && (plan.target_reps_min || plan.target_reps_max)
                ? formatTarget(movement.sets.length, plan.target_reps_min, plan.target_reps_max)
                : null,
          lastLine ? `last ${lastLine}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
    const row = movement.skipped ? (
      // Skipped for this workout; a tap brings it back as the one up now.
      <Row
        quiet
        title={movement.name}
        value={movement.done ? `Skipped · ${movement.done} of ${movement.sets.length}` : 'Skipped'}
        leading={
          <Lead>
            <SymbolView name="forward.end" size={13} weight="semibold" tintColor={c.graphite} />
          </Lead>
        }
        accessibilityLabel={`${movement.name}, skipped${movement.done ? `, ${movement.done} sets logged` : ''}. Bring back`}
        onPress={() => bringBack(movement, true)}
        actions={actions}
      />
    ) : complete ? (
      // Finished movements open their sets, to correct one.
      <Row
        quiet
        title={movement.name}
        leading={
          <Lead>
            <SymbolView name="checkmark" size={14} weight="semibold" tintColor={c.graphite} />
          </Lead>
        }
        trailing={tally}
        accessibilityLabel={`${movement.name}, done, ${movement.done} sets. Show sets`}
        onPress={() => openMovement(movement.exerciseId)}
        actions={actions}
      />
    ) : (
      // Up now, a tap opens its sets; any other row becomes the one up next, in place.
      <Row
        title={movement.name}
        detail={detail || undefined}
        leading={<Lead />}
        trailing={tally}
        accessibilityLabel={[movement.name, detail, `${movement.done} of ${movement.sets.length} sets done`].filter(Boolean).join(', ')}
        onPress={isCurrent ? () => openMovement(movement.exerciseId) : () => focus(movement.exerciseId)}
        actions={actions}
      />
    );
    return swipe.length > 0 ? (
      <SwipeRow name={movement.name} actions={swipe}>
        <View style={{ backgroundColor: c.label }}>{row}</View>
      </SwipeRow>
    ) : (
      row
    );
  };
  const addMovement = () => router.push({ pathname: '/swap', params: { mode: 'add' } });

  // Built before the set card, so typing in the card never rebuilds the list.
  const movementList =
    session.movements.length > 0 ? (
      <Section title="Movements">
        {/* Hold a movement to lift it and drag it into place; hold and let
            go for its sets, note and swap. The card's corners are the rows'. */}
        <Label>
          <DragList
            items={blocks.map((block) => ({
              key: block[0],
              node: block.map((id, index) => {
                const movement = byId.get(id);
                return movement ? (
                  <View key={id}>
                    {index > 0 ? <Hairline /> : null}
                    {movementRow(movement, blocks.findIndex((entry) => entry === block))}
                  </View>
                ) : null;
              }),
            }))}
            enabled={!reordering}
            revision={orderRevision}
            roundBottom={!session.flexible}
            onMove={(key, index) => void moveBlock(key, index)}
            onHold={(key) => openMovement(key)}
            onDragging={setDragging}
          />
          {session.flexible ? (
            <Animated.View layout={rowLayout}>
              <Hairline />
              <Row
                title="Add movement"
                leading={
                  <Lead>
                    <SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />
                  </Lead>
                }
                onPress={addMovement}
              />
            </Animated.View>
          ) : null}
        </Label>
      </Section>
    ) : null;

  return (
    <>
      <Stack.Screen options={headerOptions} />
      <TabScroll
        ref={scroll}
        // Once Finish is confirmed, its saved summary must not race new edits.
        pointerEvents={closing ? 'none' : 'auto'}
        accessibilityElementsHidden={closing}
        // A lifted movement holds the page still while it is dragged.
        scrollEnabled={!dragging}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
          if (__DEV__ && devScrollTrace.enabled) console.log(`[scroll] ${event.nativeEvent.contentOffset.y.toFixed(1)}`);
        }}>
        <Elapsed startedAt={session.startedAt} done={session.doneCount} total={session.sets.length} />

        <Tally
          marks={session.sets.map((set) => set.completed)}
          current={current?.index ?? null}
          height={20}
          style={{ marginHorizontal: space.gutter, marginTop: 16 }}
          accessibilityLabel={`${session.doneCount} of ${session.sets.length} sets done${current ? `, set ${current.index + 1} next` : ''}`}
        />

        {current && draft ? (
          <View ref={cardRef} collapsable={false}>
          <Label style={{ marginTop: 18, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 18 }}>
            {/* Keyed by movement so a switch fades the new movement in instead of jumping. */}
            <Animated.View key={current.movement.exerciseId} entering={FadeIn.duration(220)}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              {/* The name and its line open the movement's sets, note and swap, like ⋯. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${current.movement.name}, set ${current.setNumber} of ${current.movement.sets.length}`}
                accessibilityHint="Opens its sets, note and swap"
                onPress={() => {
                  haptics.tap();
                  openMovement(current.movement.exerciseId);
                }}
                onLongPress={() => {
                  haptics.select();
                  openMovement(current.movement.exerciseId);
                }}
                style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.55 : 1 })}>
                <BlancText variant="title" numberOfLines={2}>
                  {current.movement.name}
                </BlancText>
                <BlancText variant="secondary" tone="graphite" style={{ marginTop: 2 }}>
                  {[
                    `Set ${current.setNumber} of ${current.movement.sets.length}`,
                    current.movement.superset
                      ? `superset with ${current.movement.superset.partnerName}`
                      : current.movement.substitutesFor
                        ? `instead of ${current.movement.substitutesFor.exercise_name ?? 'the planned movement'}`
                        : formatRepRange(current.movement.plan?.target_reps_min, current.movement.plan?.target_reps_max),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </BlancText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${current.movement.name}: sets, note and swap`}
                hitSlop={10}
                onPress={() => {
                  haptics.tap();
                  openMovement(current.movement.exerciseId);
                }}
                style={({ pressed }) => ({ marginTop: 2, marginRight: -4, opacity: pressed ? 0.45 : 1 })}>
                <SymbolView name="ellipsis.circle" size={24} weight="regular" tintColor={c.graphite} />
              </Pressable>
            </View>
            {current.movement.note ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={2} style={{ marginTop: 6 }}>
                {current.movement.note}
              </BlancText>
            ) : null}

            {/* Holds the largest figures' height, so a step down in size never moves the card. */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 14, minHeight: Math.round(FIGURE_SIZE * 1.1) }}>
              <BigValue
                ref={weightField}
                value={draft.weight}
                unit="lb"
                size={figure}
                accessibilityLabel="Weight in pounds"
                onChange={(text) => setDraft({ ...draft, weight: text, touched: true })}
                onFocus={() => setEditing('weight')}
                onBlur={() => setEditing((field) => (field === 'weight' ? null : field))}
              />
              <BlancText variant="figure" size={Math.round(figure * 0.4)} tone="graphite" style={{ marginBottom: Math.round(figure * 0.16) }}>
                ×
              </BlancText>
              <BigValue
                ref={repsField}
                value={draft.reps}
                unit="reps"
                size={figure}
                integer
                accessibilityLabel="Reps"
                onChange={(text) => setDraft({ ...draft, reps: text, touched: true })}
                onFocus={() => setEditing('reps')}
                onBlur={() => setEditing((field) => (field === 'reps' ? null : field))}
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Chip
                  label={draft.rpe ? `RPE ${draft.rpe}` : 'Add RPE'}
                  accessibilityLabel={draft.rpe ? `RPE ${draft.rpe}. Change` : 'Add RPE'}
                  haptic={false}
                  onPress={pickRpe}
                />
                {/* For this workout only; the program keeps it. */}
                <Chip
                  label="Skip"
                  accessibilityLabel={`Skip ${current.movement.name}`}
                  accessibilityHint="For this workout only. Undo brings it back."
                  haptic={false}
                  onPress={() => {
                    haptics.tap();
                    skip(current.movement);
                  }}
                />
              </View>
              {beat?.fresh ? (
                <BeatLine key={beat.key} gain={beat.gain} style={{ marginLeft: 12 }} />
              ) : lastLine ? (
                <Animated.View key="last" entering={FadeIn.duration(220)} style={{ flexShrink: 1, marginLeft: 12 }}>
                  <BlancText variant="meta" tone="graphite" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    Last time {lastLine}
                  </BlancText>
                </Animated.View>
              ) : null}
            </View>
            {lastNote ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={2} style={{ marginTop: 10 }}>
                Last note, {format(parseISO(lastNote.date), 'MMM d')}: {lastNote.note}
              </BlancText>
            ) : null}

            {failed ? (
              <BlancText variant="footnote" tone="live" style={{ marginTop: 14 }}>
                Not saved. Your numbers are kept; try again.
              </BlancText>
            ) : blocked ? (
              <BlancText variant="footnote" tone="graphite" accessibilityLiveRegion="polite" style={{ marginTop: 14 }}>
                {blocked}
              </BlancText>
            ) : null}

            <Capsule
              title={failed ? 'Retry' : 'Log set'}
              size="large"
              fill
              busy={saving}
              disabled={!ready || Boolean(blocked)}
              onPress={() => void log()}
              style={{ marginTop: 16 }}
            />
            </Animated.View>
          </Label>
          </View>
        ) : session.movements.length === 0 ? (
          // A flexible session starts empty and is built as it goes.
          <Capsule
            title="Add your first movement"
            size="large"
            fill
            onPress={addMovement}
            style={{ marginHorizontal: space.inset, marginTop: 18 }}
          />
        ) : (
          <Label style={{ marginTop: 18, padding: 18, gap: 14 }}>
            <View style={{ gap: 4 }}>
              {/* Everything left was skipped when nothing was logged. */}
              <BlancText variant="headline">{session.sets.length > 0 ? 'All sets logged' : 'Nothing left to log'}</BlancText>
              {beat ? <BeatLine key={beat.key} gain={beat.gain} /> : null}
            </View>
            <Capsule title="Finish workout" size="large" fill busy={closing} onPress={finish} />
          </Label>
        )}

        {movementList}
      </TabScroll>

      <UndoBar
        label={undo && !closing ? `${undo.name} skipped` : null}
        bottom={tabBarCover(true) + 8}
        onUndo={() => {
          if (undo) bringBack(undo, undo.wasCurrent);
        }}
      />

      {editing && !closing ? (
        <KeyboardStickyView style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <KeyBar
            step={editing === 'weight' ? '5 lb' : '1'}
            onMinus={() => bump(editing, editing === 'weight' ? -5 : -1)}
            onPlus={() => bump(editing, editing === 'weight' ? 5 : 1)}
            onNext={editing === 'weight' ? () => repsField.current?.focus() : undefined}
          />
        </KeyboardStickyView>
      ) : null}
    </>
  );
}

/** A flexible session's name, asked for in place. */
function renameWorkout(workoutId: string, dayName: string) {
  Alert.prompt(
    'Workout name',
    undefined,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Save',
        onPress: (text?: string) => {
          const name = text?.trim().slice(0, 40);
          if (!name || name === dayName) return;
          renameSession(workoutId, name).then(
            () => haptics.success(),
            (error: unknown) => {
              haptics.error();
              Alert.alert('Not renamed', errorMessage(error, 'Could not save the workout name. Try again.'));
            },
          );
        },
      },
    ],
    'plain-text',
    dayName,
  );
}

/** The movement rows' one leading slot (a check, the skip mark or nothing), so every name starts on the same edge. */
function Lead({ children }: { children?: ReactNode }) {
  return <View style={{ width: 16, alignItems: 'center' }}>{children}</View>;
}

/** A saved set beat last time: an up mark and the gain, in ink, for a moment. */
function BeatLine({ gain, style }: { gain: string; style?: ViewStyle }) {
  const c = useBlanc();
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(220)}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }, style]}>
      <SymbolView name="arrow.up" size={11} weight="bold" tintColor={c.ink} />
      <BlancText variant="meta" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ flexShrink: 1 }}>
        Beat last time · {gain}
      </BlancText>
    </Animated.View>
  );
}

function BigValue({
  ref,
  value,
  unit,
  size,
  onChange,
  onFocus,
  onBlur,
  accessibilityLabel,
  integer,
}: {
  ref: Ref<TextField>;
  value: string;
  unit: string;
  size: number;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  accessibilityLabel: string;
  integer?: boolean;
}) {
  const field = useRef<TextField>(null);
  useImperativeHandle(ref, () => field.current as TextField);
  return (
    // The unit beside the number is part of the field: a tap there types too.
    <Pressable accessible={false} onPress={() => field.current?.focus()} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      <FigureInput
        ref={field}
        // The key bar below brings − / +, Next and Done; no system bar.
        returnKeyType="default"
        value={value}
        fontSize={size}
        onChangeText={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        selectTextOnFocus
        maxLength={6}
        accessibilityLabel={accessibilityLabel}
      />
      <BlancText variant="secondary" tone="graphite">
        {unit}
      </BlancText>
    </Pressable>
  );
}

/** Quick steps that ride on the number pad, plus Next (weight to reps) or Done (the pad has no return key). */
function KeyBar({ step, onMinus, onPlus, onNext }: { step: string; onMinus: () => void; onPlus: () => void; onNext?: () => void }) {
  const c = useBlanc();
  const key = (label: string, onPress: () => void, accessibilityLabel: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // 36 points drawn, 44 or more to touch.
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => ({
        height: 36,
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : c.label,
      })}>
      <BlancText variant="secondary" weight="600">
        {label}
      </BlancText>
    </Pressable>
  );
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: c.ground,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: c.hairline,
      }}>
      {key(`− ${step}`, onMinus, `Minus ${step}`)}
      {key(`+ ${step}`, onPlus, `Plus ${step}`)}
      <View style={{ flex: 1 }} />
      {onNext
        ? key(
            'Next',
            () => {
              haptics.tap();
              onNext();
            },
            'Next, reps',
          )
        : key(
            'Done',
            () => {
              haptics.tap();
              Keyboard.dismiss();
            },
            'Done',
          )}
    </View>
  );
}

/** No live workout: start today's planned day or any other, or a flexible session. */
function StartWorkout() {
  const mode = useAppStore((state) => state.workoutMode);
  return mode === 'flexible' ? <StartFlexible /> : <StartPlanned />;
}

/** Header items before a session: History, then the schedule and Program (programs, quick starts, training mode). */
function useStartHeader(title: string) {
  const mode = useAppStore((state) => state.workoutMode);
  const hasSplit = useAppStore((state) => Boolean(state.activeSplit));
  // Built once per mode, so typing on the screen never re-sends the header.
  const options = useMemo(
    () => ({
        title,
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: 'History',
            icon: { type: 'sfSymbol', name: 'clock.arrow.circlepath' },
            onPress: () => {
              haptics.tap();
              router.push('/train/history');
            },
          },
          {
            type: 'menu',
            label: 'Training options',
            icon: { type: 'sfSymbol', name: 'ellipsis' },
            menu: {
              items: [
                ...(mode === 'split' && hasSplit
                  ? [
                      {
                        type: 'action' as const,
                        label: 'Schedule',
                        icon: { type: 'sfSymbol' as const, name: 'calendar' as const },
                        onPress: () => {
                          haptics.tap();
                          router.push('/schedule');
                        },
                      },
                    ]
                  : []),
                {
                  // Programs, quick starts and how Train works.
                  type: 'action',
                  label: 'Program',
                  icon: { type: 'sfSymbol', name: 'list.bullet.rectangle' },
                  onPress: () => {
                    haptics.tap();
                    router.push('/train/program');
                  },
                },
                {
                  type: 'action',
                  label: 'Run',
                  icon: { type: 'sfSymbol', name: 'figure.run' },
                  onPress: () => {
                    haptics.tap();
                    router.push('/run');
                  },
                },
              ],
            },
          },
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    [title, mode, hasSplit],
  );
  return <Stack.Screen options={options} />;
}

/** Program mode: today's card by the schedule, then any other day to start instead. */
function StartPlanned() {
  const split = useAppStore((state) => state.activeSplit);
  const { starting, start } = useStartSession();
  const plan = useTodayPlan();
  const header = useStartHeader('Train');
  const { refreshing, refresh } = useAccountRefresh();
  const week = plan.schedule
    ? differenceInCalendarWeeks(new Date(), parseISO(`${plan.schedule.startDate}T00:00:00`), TRAINING_WEEK) + 1
    : null;
  // How finishing another day moves the plan, by the web's rule.
  const otherNote = !plan.schedule
    ? null
    : !plan.adaptiveSchedulingEnabled
      ? 'Your saved schedule stays as it is.'
      : plan.schedule.mode === 'fixed'
        ? 'Finishing a different day shifts the sessions after it.'
        : 'Finishing a different day moves the next session on from it.';
  // The day the card above offers is not offered again.
  const planned = plan.hero.kind === 'planned' ? plan.hero.day.id : null;
  const otherDays = split ? split.days.filter((day) => day.id !== planned) : [];

  return (
    <>
      {header}
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {/* Without a program the card below says so. */}
        {split ? (
          <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
            {[split.name, week && week >= 1 ? `week ${week}` : null].filter(Boolean).join(' · ')}
          </BlancText>
        ) : null}
        <PlanCard hero={plan.hero} next={plan.next} place="train" />
        {otherDays.length > 0 ? (
          <Section title="Other days">
            <Label>
              {otherDays.map((day, index) => (
                <View key={day.id}>
                  {index > 0 ? <Hairline /> : null}
                  <Row
                    title={day.day_name}
                    detail={dayLine(day)}
                    trailing={
                      <Capsule
                        title={starting === day.id ? 'Starting' : 'Start'}
                        variant="quiet"
                        busy={starting === day.id}
                        disabled={starting !== null}
                        onPress={() => void start(day.id)}
                      />
                    }
                  />
                </View>
              ))}
            </Label>
            {otherNote ? <FormNote>{otherNote}</FormNote> : null}
          </Section>
        ) : null}
      </TabScroll>
    </>
  );
}

/** "5 movements · 17 sets", "1 movement · 1 set". */
function dayLine(day: { exercises: { target_sets: number }[] }): string {
  const movements = day.exercises.length;
  const sets = day.exercises.reduce((sum, exercise) => sum + exercise.target_sets, 0);
  return `${movements} ${movements === 1 ? 'movement' : 'movements'} · ${sets} ${sets === 1 ? 'set' : 'sets'}`;
}

const FLEX_NAME_LIMIT = 40;

/** Flexible mode: name the session (or pick a quick start) and build it as you go. */
function StartFlexible() {
  const c = useBlanc();
  const templates = useAppStore((state) => state.flexTemplates);
  const fetchFlexTemplates = useAppStore((state) => state.fetchFlexTemplates);
  const startFlexibleWorkout = useAppStore((state) => state.startFlexibleWorkout);
  const header = useStartHeader('Train');
  const [name, setName] = useState('');
  // The field keeps its own text while typing (a controlled field can lose
  // keystrokes typed during a re-render); a quick start remounts it filled.
  const [field, setField] = useState({ key: 0, text: '' });
  const [template, setTemplate] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const label = name.trim();
  const refreshTemplates = useCallback(() => fetchFlexTemplates({ force: true }), [fetchFlexTemplates]);
  const { refreshing, refresh } = useAccountRefresh(refreshTemplates);

  useEffect(() => {
    void fetchFlexTemplates();
  }, [fetchFlexTemplates]);

  const start = async () => {
    if (!label || starting) return;
    Keyboard.dismiss();
    setStarting(true);
    try {
      const workout = await startFlexibleWorkout(label, template);
      if (!workout) {
        haptics.error();
        Alert.alert('Finish your other workout first', 'A program session from today is still open.');
        return;
      }
      haptics.success();
    } catch (error) {
      haptics.error();
      Alert.alert('Could not start', errorMessage(error, 'Check your connection and try again.'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <>
      {header}
      <TabScroll
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          Flexible · build today as you go
        </BlancText>

        <Section title="What are you training?" style={{ marginTop: 18 }}>
          {/* The field fills the card's height, so a tap anywhere on it types. */}
          <Label style={{ paddingHorizontal: 18, paddingVertical: 3 }}>
            <TextInput
              key={field.key}
              defaultValue={field.text}
              onChangeText={(text) => {
                setName(text);
                // Typing a different name leaves the quick start, as on the web.
                if (template && text !== template) setTemplate(null);
              }}
              placeholder="Upper, push, arms…"
              placeholderTextColor={c.graphite}
              maxLength={FLEX_NAME_LIMIT}
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => void start()}
              selectionColor={c.ink}
              accessibilityLabel="What are you training?"
              lineBreakModeIOS="tail"
              style={[typeScale.field, { color: c.ink, padding: 0, minHeight: 44 }]}
            />
          </Label>
        </Section>

        {templates.length > 0 ? (
          <Section title="Quick start">
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: space.inset }}>
              {templates.slice(0, 6).map((entry) => (
                <Chip
                  key={entry.id}
                  label={entry.label}
                  selected={template === entry.label}
                  onPress={() => {
                    const chosen = template === entry.label ? null : entry.label;
                    setTemplate(chosen);
                    setName(chosen ?? '');
                    setField((value) => ({ key: value.key + 1, text: chosen ?? '' }));
                  }}
                />
              ))}
            </View>
          </Section>
        ) : null}

        <Capsule
          title={label ? `Start ${label}` : 'Start session'}
          size="large"
          fill
          busy={starting}
          disabled={!label}
          onPress={() => void start()}
          style={{ marginHorizontal: space.inset, marginTop: space.section }}
        />
        {template ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
            Starts with its movements and notes.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}
