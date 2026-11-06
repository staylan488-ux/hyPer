import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { differenceInCalendarWeeks, parseISO } from 'date-fns';
import { useCallback, useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef, useState, type ComponentProps, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Alert, Keyboard, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { heldMovement, moveMovementBlock, movementBlocks } from '@/lib/movementOrder';
import { getSetAutofillValues, previousSetTarget, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
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
import { announce, screenReaderRunning, speak, spokenClock, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useAccountDay, useAccountRefresh } from '~/lib/accountData';
import { gainOnLastTime } from '~/lib/beatLastTime';
import { useFinishWorkout } from '~/lib/finishWorkout';
import { useWorkoutBarShown } from '~/lib/workoutBar';
import { formatLoad, formatMinutes, formatRepRange, formatSet, formatTarget } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { rowLayout } from '~/lib/motion';
import { confirmRemoveMovement, errorMessage, renameSession, reorderMovements, setSkipped } from '~/lib/movement';
import { restSecondsFor, startRest } from '~/lib/rest';
import { liveSessionModel, useFocusStore, useNow, usePreviousNotes, usePreviousTargets, useSessionModel, useStartSession, type SessionModel } from '~/lib/session';
import { afterLoggedSet } from '~/lib/sessionModel';
import { chooseRpe, isBodyweight, parseNumber, weightToLog } from '~/lib/setEntry';
import { useFinishedToday, useTodayPlan } from '~/lib/today';
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
/** With VoiceOver, which takes a few swipes to reach the bar at the foot. */
const UNDO_MS_SCREEN_READER = 20000;
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
const FIGURE_SIZE = 72;

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
function Elapsed({ startedAt }: { startedAt: Date }) {
  const now = useNow(1000);
  const elapsed = Math.max(0, (now - startedAt.getTime()) / 1000);
  return (
    <BlancText
      variant="secondary"
      tone="graphite"
      // The clock in words; the tally just below reads the sets.
      accessibilityLabel={`Workout time, ${spokenClock(elapsed)}`}
      style={{ fontVariant: ['tabular-nums'] }}>
      {/* Minutes, as Today's card says it: a ticking m:ss here read like a time of day. */}
      {formatMinutes(Math.floor(elapsed / 60))}
    </BlancText>
  );
}

function LiveWorkout({ session }: { session: SessionModel }) {
  const c = useBlanc();
  const large = useLargeText();
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
  const [undo, setUndo] = useState<{ key: number; exerciseId: string; name: string; wasCurrent: boolean; endedEarly: boolean } | null>(null);
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(
      () => setUndo((latest) => (latest?.key === undo.key ? null : latest)),
      screenReaderRunning() ? UNDO_MS_SCREEN_READER : UNDO_MS,
    );
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

  // On a bodyweight movement an empty weight logs as 0: no "0" to type first.
  const weight = draft ? weightToLog(draft.weight, isBodyweight(current?.set.exercise)) : null;
  const reps = draft ? parseNumber(draft.reps) : null;
  const ready = weight !== null && reps !== null;
  const figure = draft ? figureSize(draft.weight, draft.reps) : FIGURE_SIZE;
  const last = current ? previousSetTarget(current.set, current.movement.sets, previous) : undefined;
  const lastNote = current ? previousNotes[current.movement.exerciseId] : undefined;
  const lastWeight = last && typeof last.weight === 'number' && last.weight > 0 ? formatLoad(last.weight) : null;
  const lastReps = last && typeof last.reps === 'number' && Number.isFinite(last.reps) ? last.reps : null;
  // "Set 2 of 4 · 8–10 reps" under the movement's name.
  const cardLine = current
    ? [
        `Set ${current.setNumber} of ${current.movement.sets.length}`,
        current.movement.superset
          ? `superset with ${current.movement.superset.partnerName}`
          : current.movement.substitutesFor
            ? `instead of ${current.movement.substitutesFor.exercise_name ?? 'the planned movement'}`
            : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';

  // The rep target sits under the reps figure, beside last time's reps: "8–10 · last 9".
  const repTarget = current ? formatRepRange(current.movement.plan?.target_reps_min, current.movement.plan?.target_reps_max) : null;

  const blocked = current?.blocked ?? null;
  // Why the set can't log yet (a superset's turn), as it appears.
  useAnnounce(failed ? null : blocked);

  const log = async () => {
    if (!current || !draft || weight === null || reps === null || saving || blocked) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailedSetId(null);
    setBeat(null);
    const logged = current.set;
    const loggedReps = Math.round(reps);
    // One line for VoiceOver per log: focus stays on Log set while the card
    // changes under it, so nothing else says the set saved.
    const spoken = [`Set ${current.setNumber} of ${current.movement.sets.length} logged`];
    const saved = await succeeds(async () => {
      await logSet(logged.id, weight, loggedReps, draft.rpe ?? undefined);
      // Beating the same set last time gets a firmer haptic and a quiet line.
      const gain = gainOnLastTime({ ...logged, weight, reps: loggedReps }, previous, current.movement.sets);
      if (gain) {
        haptics.beat();
        setBeat({ key: Date.now(), gain, fresh: true });
        spoken.push(`beat last time, ${gain}`);
      } else {
        haptics.success();
      }
      // The web's order: a superset's partner for the same round, else more of
      // this movement, else the next in turn. A superset rests after B only.
      const after = afterLoggedSet(session, logged, useAppStore.getState().currentWorkout?.sets ?? []);
      const chosen = useFocusStore.getState().exerciseId;
      if (after.nextExerciseId && (!chosen || chosen === logged.exercise_id)) focus(after.nextExerciseId);
      if (after.rest) {
        startRest(current.movement.exerciseId);
        spoken.push(`rest ${spokenClock(restSecondsFor(current.movement.exerciseId))}`);
      }
      if (!liveSessionModel()?.current) spoken.push('all sets logged');
      announce(spoken.join(', '));
    });
    if (!saved) {
      haptics.error();
      setFailedSetId(logged.id);
      announce('Not saved. Your numbers are kept; try again.');
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
  // With a set logged it ends early instead: the logged sets stay and count,
  // the rest are dropped when the workout finishes.
  const skip = (movement: Movement) => {
    Keyboard.dismiss();
    const wasCurrent = movement.exerciseId === current?.movement.exerciseId;
    const key = nextSkipKey();
    // The Undo bar announces "<name> skipped" (or "ended early") as it appears.
    setUndo({ key, exerciseId: movement.exerciseId, name: movement.name, wasCurrent, endedEarly: movement.done > 0 });
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
    announce(`${movement.name} brought back${next ? ', up now' : ''}`);
  };

  // The undo bar sits above whatever covers the foot: the workout bar only shows here during a rest.
  const workoutBar = useWorkoutBarShown((state) => state.shown);
  const { finish, closing } = useFinishWorkout(session);

  // Magic Tap (a two-finger double tap) logs the set that's ready, exactly
  // as Log set does, and otherwise says why it can't.
  const magicLog = () => {
    if (closing) return;
    if (!current || !draft) {
      announce(session.movements.length === 0 ? 'Add a movement first' : session.sets.length > 0 ? 'All sets logged' : 'Nothing left to log');
      return;
    }
    if (saving) return announce('Saving the set');
    if (blocked) return announce(blocked);
    if (!ready) return announce(weight === null ? (reps === null ? 'Enter the weight and reps first' : 'Enter the weight first') : 'Enter the reps first');
    haptics.tap();
    void log();
  };

  // The header is built once per name and state, never per keystroke or
  // clock tick, so its buttons are not re-sent to iOS under the finger.
  const { workoutId, dayName, flexible } = session;
  // Finish stays quiet glass beside Log set until every set is logged, then leads.
  const allLogged = session.sets.length > 0 && session.doneCount >= session.sets.length;
  const headerOptions = useMemo(
    () =>
      ({
        title: dayName,
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: closing ? 'Saving…' : 'Finish',
            variant: allLogged ? 'prominent' : 'plain',
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
    [workoutId, dayName, closing, c.ink, flexible, finish, allLogged],
  );

  // A drop saves this session's order at once (never the program); while it
  // saves rows stay put, and a failed save puts the old order back.
  const [reordering, setReordering] = useState(false);
  const [orderRevision, setOrderRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The movement under the finger: a pair lifts as one, but a hold on B opens B.
  const touchedMovement = useRef<string | null>(null);
  // Written through a callback: a ref written inline in the list would keep
  // the React Compiler from memoizing the list.
  const touchMovement = useCallback((id: string) => {
    touchedMovement.current = id;
  }, []);
  // Blocks: a superset pair moves as one. (Computed after every hook, so the
  // React Compiler can keep the movement list from rebuilding as you type.)
  const blocks = movementBlocks(
    session.movements.map((movement) => ({ id: movement.exerciseId, name: movement.name, supersetGroupId: movement.superset?.groupId })),
  );
  const byId = new Map(session.movements.map((movement) => [movement.exerciseId, movement]));
  // `spoken`: what VoiceOver hears once a Move up or Move down saves (the
  // row moves under its focus without a word).
  const moveBlock = async (key: string, index: number, spoken?: string) => {
    if (reordering) return;
    const ids = moveMovementBlock(blocks, key, index);
    setReordering(true);
    try {
      await reorderMovements(session.workoutId, ids);
      announce(spoken);
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
    // Skipping a movement part way through ends it early.
    const skipLabel = movement.done > 0 ? 'End early' : 'Skip';
    // Swipe to swap or skip a movement with sets to go and, in a flexible
    // session, to take it out (asks first).
    const swipe: SwipeAction[] = [
      ...(hasSetsLeft
        ? [{ label: 'Swap', onPress: () => router.push({ pathname: '/swap', params: { id: movement.exerciseId, from: 'train' } }) }]
        : []),
      ...(hasSetsLeft && !movement.skipped ? [{ label: skipLabel, onPress: () => skip(movement) }] : []),
      ...(session.flexible
        ? [{ label: 'Remove', destructive: true, onPress: () => confirmRemoveMovement(session.workoutId, movement) }]
        : []),
    ];
    // What a hold, a swipe and a drag do, for VoiceOver.
    const actions = [
      { label: 'Sets, note and swap', run: () => openMovement(movement.exerciseId) },
      ...(hasSetsLeft && !movement.skipped ? [{ label: `${skipLabel} for this workout`, run: () => skip(movement) }] : []),
      ...(blockIndex > 0
        ? [{ label: 'Move up', run: () => void moveBlock(blocks[blockIndex][0], blockIndex - 1, `${movement.name} moved up`) }]
        : []),
      ...(blockIndex < blocks.length - 1
        ? [{ label: 'Move down', run: () => void moveBlock(blocks[blockIndex][0], blockIndex + 1, `${movement.name} moved down`) }]
        : []),
    ];
    // Each movement ends with its own tally; the next set stands taller on the row up now.
    // The tally keeps 4 pt on top for that stroke; the same below centres the strokes on the row.
    const tally = (
      <Tally
        compact
        marks={movement.sets.map((set) => set.completed)}
        current={isCurrent && current ? current.setNumber - 1 : null}
        accessibilityLabel={`${movement.done} of ${movement.sets.length} sets done`}
        style={{ marginBottom: 4 }}
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
    const row = movement.endedEarly ? (
      // Ended early: done with the sets logged, which stay and count. A tap
      // brings the rest back as the one up now.
      <Row
        quiet
        title={movement.name}
        value={`Ended early · ${movement.done} of ${movement.sets.length}`}
        accessibilityLabel={`${movement.name}, ended early, ${movement.done} of ${movement.sets.length} sets logged. Bring back`}
        onPress={() => bringBack(movement, true)}
        actions={actions}
      />
    ) : movement.skipped ? (
      // Skipped for this workout; a tap brings it back as the one up now.
      <Row
        quiet
        title={movement.name}
        value="Skipped"
        accessibilityLabel={`${movement.name}, skipped. Bring back`}
        onPress={() => bringBack(movement, true)}
        actions={actions}
      />
    ) : complete ? (
      // Finished movements open their sets, to correct one.
      <Row
        quiet
        title={movement.name}
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
        trailing={tally}
        accessibilityLabel={[movement.name, detail, `${movement.done} of ${movement.sets.length} sets done`].filter(Boolean).join(', ')}
        onPress={
          isCurrent
            ? () => openMovement(movement.exerciseId)
            : () => {
                focus(movement.exerciseId);
                // The card above changes; VoiceOver stays on this row.
                announce(`${movement.name}, up now`);
              }
        }
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
                  <View key={id} onTouchStart={() => touchMovement(id)}>
                    {index > 0 ? <Hairline /> : null}
                    {movementRow(movement, blocks.findIndex((entry) => entry === block))}
                  </View>
                ) : null;
              }),
            }))}
            enabled={!reordering}
            revision={orderRevision}
            roundBottom={!session.flexible}
            // Rules start at the names, past each row's 16 pt mark.
            ruleInset={18}
            onMove={(key, index) => void moveBlock(key, index)}
            onHold={(key) => openMovement(heldMovement(blocks, key, touchedMovement.current))}
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
        onMagicTap={magicLog}
        // A lifted movement holds the page still while it is dragged.
        scrollEnabled={!dragging}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
          if (__DEV__ && devScrollTrace.enabled) console.log(`[scroll] ${event.nativeEvent.contentOffset.y.toFixed(1)}`);
        }}>
        {/* The session's tally and its clock share one line under the title; at the accessibility sizes they stack. */}
        <View
          style={
            large
              ? { marginHorizontal: space.gutter, marginTop: 2, gap: 10 }
              : { marginHorizontal: space.gutter, marginTop: 6, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }
          }>
          {/* An empty session has no marks to draw. */}
          {session.sets.length > 0 ? (
            <Tally
              marks={session.sets.map((set) => set.completed)}
              current={current?.index ?? null}
              height={20}
              style={large ? undefined : { flexShrink: 1 }}
              accessibilityLabel={`${session.doneCount} of ${session.sets.length} sets done${current ? `, set ${current.index + 1} next` : ''}`}
            />
          ) : (
            <View />
          )}
          <Elapsed startedAt={session.startedAt} />
        </View>

        {current && draft ? (
          <View ref={cardRef} collapsable={false}>
          <Label style={{ marginTop: 14, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 18 }}>
            {/* Keyed by movement so a switch fades the new movement in instead of jumping. */}
            <Animated.View key={current.movement.exerciseId} entering={FadeIn.duration(220)}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              {/* The name and its line open the movement's sets, note and swap, like ⋯. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={speak(`${current.movement.name}, ${cardLine}`)}
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
                <BlancText variant="title" numberOfLines={large ? undefined : 2}>
                  {current.movement.name}
                </BlancText>
                <BlancText variant="secondary" tone="graphite" style={{ marginTop: 2 }}>
                  {cardLine}
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
              <BlancText variant="footnote" tone="graphite" numberOfLines={large ? undefined : 2} style={{ marginTop: 6 }}>
                {current.movement.note}
              </BlancText>
            ) : null}

            {/* Last time's numbers sit under the figures they compare with; here, a fresh gain or last time's note. */}
            {beat?.fresh ? (
              <BeatLine key={beat.key} gain={beat.gain} style={{ marginTop: 8 }} />
            ) : lastNote ? (
              <Animated.View key="note" entering={FadeIn.duration(220)} style={{ marginTop: 8 }}>
                <BlancText
                  variant="footnote"
                  tone="graphite"
                  numberOfLines={large ? undefined : 2}
                  accessibilityLabel={`Last note: ${lastNote.note}`}>
                  {lastNote.note}
                </BlancText>
              </Animated.View>
            ) : null}

            <FigureRow
              size={figure}
              weight={
                <BigValue
                  ref={weightField}
                  value={draft.weight}
                  unit="lb"
                  size={figure}
                  caption={lastWeight ? `last ${lastWeight}` : undefined}
                  spokenCaption={lastWeight ? `Last time, ${lastWeight} pounds` : undefined}
                  accessibilityLabel="Weight in pounds"
                  onChange={(text) => setDraft({ ...draft, weight: text, touched: true })}
                  onFocus={() => setEditing('weight')}
                  onBlur={() => setEditing((field) => (field === 'weight' ? null : field))}
                />
              }
              reps={
                <BigValue
                  ref={repsField}
                  value={draft.reps}
                  unit="reps"
                  size={figure}
                  integer
                  caption={[repTarget?.replace(/ reps?$/, ''), lastReps !== null ? `last ${lastReps}` : null].filter(Boolean).join(' · ') || undefined}
                  spokenCaption={[repTarget ? `Target ${repTarget}` : null, lastReps !== null ? `last time ${lastReps} reps` : null].filter(Boolean).join(', ') || undefined}
                  accessibilityLabel="Reps"
                  onChange={(text) => setDraft({ ...draft, reps: text, touched: true })}
                  onFocus={() => setEditing('reps')}
                  onBlur={() => setEditing((field) => (field === 'reps' ? null : field))}
                />
              }
            />

            {/* RPE is the one value to set beside the figures; Skip is a quiet word at the far side. */}
            <View
              style={
                large
                  ? { alignItems: 'flex-start', gap: 6, marginTop: 12 }
                  : { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }
              }>
              <Chip
                label={draft.rpe ? `RPE ${draft.rpe}` : 'Add RPE'}
                accessibilityLabel={draft.rpe ? `RPE ${draft.rpe}. Change` : 'Add RPE'}
                haptic={false}
                onPress={pickRpe}
              />
              {/* For this workout only; the program keeps it. With a set logged it ends the movement early, keeping those sets. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  current.movement.done > 0
                    ? `End ${current.movement.name} early, keeping ${current.movement.done} of ${current.movement.sets.length} sets`
                    : `Skip ${current.movement.name}`
                }
                accessibilityHint="For this workout only. Undo brings it back."
                hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
                onPress={() => {
                  haptics.tap();
                  skip(current.movement);
                }}
                style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
                <BlancText variant="secondary" weight="500">
                  {current.movement.done > 0 ? 'End early' : 'Skip movement'}
                </BlancText>
              </Pressable>
            </View>

            {failed ? (
              <BlancText variant="footnote" tone="live" style={{ marginTop: 14 }}>
                Not saved. Your numbers are kept; try again.
              </BlancText>
            ) : blocked ? (
              <BlancText variant="footnote" tone="graphite" style={{ marginTop: 14 }}>
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
        label={undo && !closing ? `${undo.name} ${undo.endedEarly ? 'ended early' : 'skipped'}` : null}
        bottom={tabBarCover(workoutBar) + 8}
        onUndo={() => {
          if (undo) bringBack(undo, undo.wasCurrent);
        }}
      />

      {editing && !closing ? (
        <KeyboardStickyView style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <KeyBar
            step={editing === 'weight' ? '5 lb' : '1'}
            spokenStep={editing === 'weight' ? '5 pounds' : '1 rep'}
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
  const large = useLargeText();
  return (
    <Animated.View
      entering={FadeIn.duration(180)}
      exiting={FadeOut.duration(220)}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 }, style]}>
      <SymbolView name="arrow.up" size={11} weight="bold" tintColor={c.ink} />
      <BlancText variant="footnote" numberOfLines={large ? undefined : 1} adjustsFontSizeToFit={!large} minimumFontScale={0.8} style={{ flexShrink: 1, fontVariant: ['tabular-nums'] }}>
        Beat last time · {gain}
      </BlancText>
    </Animated.View>
  );
}

/**
 * Weight × reps at the figures' shared `size`. It holds the largest figures'
 * height, so a step down in size never moves the card. At the accessibility
 * text sizes the capped figures and their grown units no longer fit side by
 * side, so "× reps" wraps under the weight when it must.
 */
function FigureRow({ weight, reps, size }: { weight: ReactNode; reps: ReactNode; size: number }) {
  // Weight and reps outgrow the card from the larger standard text sizes on;
  // the wrapping row looks the same while they still fit.
  const large = useWindowDimensions().fontScale > 1;
  const minHeight = Math.round(FIGURE_SIZE * 1.1);
  // The fields name themselves; the "×" is only drawn.
  const times = (
    <BlancText
      variant="figure"
      size={Math.round(size * 0.4)}
      tone="graphite"
      accessibilityElementsHidden
      importantForAccessibility="no"
      // Centred on the figures, above the captions under them.
      style={{ marginBottom: Math.round(size * 0.3) + CAPTION_HEIGHT + 5 }}>
      ×
    </BlancText>
  );
  return large ? (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: 14, rowGap: 4, marginTop: 14, minHeight }}>
      {weight}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
        {times}
        {reps}
      </View>
    </View>
  ) : (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 14, minHeight }}>
      {weight}
      {times}
      {reps}
    </View>
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
  caption,
  spokenCaption,
}: {
  ref: Ref<TextField>;
  value: string;
  unit: string;
  size: number;
  /** Written small under the ruled line: last time's value, and for reps the target ("8–10 · last 9"). */
  caption?: string;
  spokenCaption?: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  accessibilityLabel: string;
  integer?: boolean;
}) {
  const c = useBlanc();
  const field = useRef<TextField>(null);
  const [focused, setFocused] = useState(false);
  useImperativeHandle(ref, () => field.current as TextField);
  return (
    <View>
    {/* The unit beside the number is part of the field: a tap there types too. */}
    <Pressable accessible={false} onPress={() => field.current?.focus()} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      {/* A ruled line under the figure, as in a paper log: it can be written in. Ink while typing. */}
      <View style={{ borderBottomWidth: focused ? 1.5 : 1, borderBottomColor: focused ? c.ink : c.mark, marginBottom: focused ? -0.5 : 0 }}>
      <FigureInput
        ref={field}
        // The key bar below brings − / +, Next and Done; no system bar.
        returnKeyType="default"
        value={value}
        fontSize={size}
        onChangeText={onChange}
        onFocus={() => {
          setFocused(true);
          onFocus();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        keyboardType={integer ? 'number-pad' : 'decimal-pad'}
        selectTextOnFocus
        maxLength={6}
        accessibilityLabel={accessibilityLabel}
      />
      </View>
      {/* The field's label names the unit. React Native can't line a text
          field's baseline up with text beside it, so the unit is lifted onto
          the figure's baseline by the measured difference. */}
      <BlancText
        variant="secondary"
        tone="graphite"
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ transform: [{ translateY: -Math.round(size * 0.043 * 2) / 2 }] }}>
        {unit}
      </BlancText>
    </Pressable>
    {/* Last time under its own figure, as a paper log keeps the last session in the margin. */}
    <BlancText
      variant="meta"
      tone="graphite"
      accessibilityLabel={spokenCaption}
      accessibilityElementsHidden={!caption}
      importantForAccessibility={caption ? 'auto' : 'no-hide-descendants'}
      numberOfLines={1}
      style={{ marginTop: 5, minHeight: CAPTION_HEIGHT, opacity: caption ? 1 : 0 }}>
      {caption || ' '}
    </BlancText>
    </View>
  );
}

/** The last-time caption's line under each figure (Menlo 12 on a 16 pt line), kept even when empty so the card doesn't move. */
const CAPTION_HEIGHT = 16;

/**
 * The key bar's text grows no further than this, like iOS's own bars above
 * the keyboard: its three keys must share one row at every text size.
 */
const KEY_BAR_MAX_SCALE = 2;

/** Quick steps that ride on the number pad, plus Next (weight to reps) or Done (the pad has no return key). */
function KeyBar({
  step,
  spokenStep,
  onMinus,
  onPlus,
  onNext,
}: {
  step: string;
  /** The step in words for VoiceOver: "5 pounds", "1 rep". */
  spokenStep: string;
  onMinus: () => void;
  onPlus: () => void;
  onNext?: () => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const key = (label: string, onPress: () => void, accessibilityLabel: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // 36 points drawn, 44 or more to touch.
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => ({
        ...(large ? { minHeight: 36, paddingVertical: 6 } : { height: 36 }),
        paddingHorizontal: 14,
        borderRadius: 18,
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : c.label,
      })}>
      <BlancText variant="secondary" weight="600" maxFontSizeMultiplier={KEY_BAR_MAX_SCALE}>
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
      {key(`− ${step}`, onMinus, `Minus ${spokenStep}`)}
      {key(`+ ${step}`, onPlus, `Plus ${spokenStep}`)}
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
  const large = useLargeText();
  const split = useAppStore((state) => state.activeSplit);
  const { starting, start } = useStartSession();
  const plan = useTodayPlan();
  const header = useStartHeader('Train');
  const { refreshing, refresh } = useAccountRefresh();
  // The account's day, as the card below: the week moves on with it overnight.
  const dayKey = useAccountDay((state) => state.dayKey);
  const week = plan.schedule
    ? differenceInCalendarWeeks(parseISO(dayKey), parseISO(`${plan.schedule.startDate}T00:00:00`), TRAINING_WEEK) + 1
    : null;
  // How finishing another day moves the plan, by the web's rule.
  const otherNote = !plan.schedule
    ? null
    : !plan.adaptiveSchedulingEnabled
      ? 'Your saved schedule stays as it is.'
      : plan.schedule.mode === 'fixed'
        ? 'Finishing a different day shifts the sessions after it.'
        : 'Finishing a different day moves the next session on from it.';
  // The day the card above offers, or shows as done today, is not offered again.
  const planned = plan.hero.kind === 'planned' ? plan.hero.day.id : null;
  const finished = useFinishedToday(plan.hero.kind === 'done');
  // While the plan, or History's read of today's workout, loads the list waits,
  // so a day is never offered and then taken back.
  const holding = plan.hero.kind === 'loading' || (plan.hero.kind === 'done' && finished === undefined);
  const otherDays = split && !holding ? split.days.filter((day) => day.id !== planned && day.id !== finished?.splitDayId) : [];

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
        <PlanCard hero={plan.hero} next={plan.next} place="train" seeded={plan.seeded} />
        {otherDays.length > 0 ? (
          // Arrives with the card's fade, once its rows are known.
          <Animated.View entering={FadeIn.duration(220)}>
            <Section title="Other days">
              <Label>
                {otherDays.map((day, index) => {
                  const startButton = (
                    <Capsule
                      title={starting === day.id ? 'Starting' : 'Start'}
                      // Each day's button names its day.
                      accessibilityLabel={`${starting === day.id ? 'Starting' : 'Start'} ${day.day_name}`}
                      variant="quiet"
                      busy={starting === day.id}
                      disabled={starting !== null}
                      onPress={() => void start(day.id)}
                    />
                  );
                  return (
                    <View key={day.id}>
                      {index > 0 ? <Hairline /> : null}
                      <Row title={day.day_name} detail={dayLine(day)} trailing={large ? undefined : startButton} />
                      {/* At the accessibility text sizes the button would squeeze the day's words: it goes under them. */}
                      {large ? <View style={{ paddingLeft: 18, paddingRight: 16, paddingBottom: 12 }}>{startButton}</View> : null}
                    </View>
                  );
                })}
              </Label>
              {otherNote ? <FormNote>{otherNote}</FormNote> : null}
            </Section>
          </Animated.View>
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
