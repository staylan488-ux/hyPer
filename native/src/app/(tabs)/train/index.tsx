import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { differenceInCalendarWeeks, format, parseISO } from 'date-fns';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ComponentRef } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { movementBlocks } from '@/components/workout/movementOrder';
import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { TRAINING_WEEK } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { FigureInput } from '~/components/FigureInput';
import { Label } from '~/components/Label';
import { PlanCard } from '~/components/PlanCard';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Tally } from '~/components/Tally';
import { useFinishedStore, summarize } from '~/lib/finished';
import { formatClock, formatLoad, formatRepRange } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { errorMessage, renameSession } from '~/lib/movement';
import { flushNotes } from '~/lib/notes';
import { startRest, stopRest } from '~/lib/rest';
import { useFocusStore, useNow, usePreviousNotes, usePreviousTargets, useSessionModel, useStartSession, type SessionModel } from '~/lib/session';
import { afterLoggedSet } from '~/lib/sessionModel';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { useTodayPlan } from '~/lib/today';
import { devScrollTrace } from '~/platform/devLaunch';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

type Current = NonNullable<SessionModel['current']>;
/** The numbers for the set about to be logged. `touched` once the person edits them. */
type Draft = { setId: string; weight: string; reps: string; rpe: number | null; touched: boolean };

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

export default function TrainScreen() {
  const session = useSessionModel();
  if (!session) return <StartWorkout />;
  return <LiveWorkout session={session} />;
}

function LiveWorkout({ session }: { session: SessionModel }) {
  const c = useBlanc();
  const now = useNow(1000);
  const previous = usePreviousTargets(session);
  const previousNotes = usePreviousNotes(session);
  const logSet = useAppStore((state) => state.logSet);
  const completeWorkout = useAppStore((state) => state.completeWorkout);
  const saveTemplateFromWorkout = useAppStore((state) => state.saveFlexibleTemplateFromCurrentWorkout);
  const fetchFlexTemplates = useAppStore((state) => state.fetchFlexTemplates);
  const focus = useFocusStore((state) => state.focus);
  const setFinished = useFinishedStore((state) => state.set);
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
  useEffect(() => {
    if (focusSeen.current === focusedId) return;
    focusSeen.current = focusedId;
    revealCard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedId]);

  const current = session.current;
  const [draft, setDraft] = useState<Draft | null>(() => (current ? suggestedDraft(current, previous) : null));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<'weight' | 'reps' | null>(null);

  // A new set starts from its suggested numbers; the same set keeps any edits,
  // including after a failed save.
  const currentSetId = current?.set.id ?? null;
  useEffect(() => {
    setDraft((existing) => {
      if (!current) return null;
      return existing?.setId === current.set.id ? existing : suggestedDraft(current, previous);
    });
    setFailed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSetId]);

  // "Last time" arrives after the screen opens: fill it into an untouched set.
  useEffect(() => {
    setDraft((existing) => {
      if (!current || !existing || existing.touched || existing.setId !== current.set.id) return existing;
      return suggestedDraft(current, previous);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previous]);

  const elapsed = Math.max(0, (now - session.startedAt.getTime()) / 1000);
  const weight = draft ? parseNumber(draft.weight) : null;
  const reps = draft ? parseNumber(draft.reps) : null;
  const ready = weight !== null && reps !== null;
  const last = current ? previous[current.movement.exerciseId]?.[current.set.set_number] : undefined;
  const lastNote = current ? previousNotes[current.movement.exerciseId] : undefined;

  const blocked = current?.blocked ?? null;

  const log = async () => {
    if (!current || !draft || weight === null || reps === null || saving || blocked) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    const logged = current.set;
    try {
      await logSet(logged.id, weight, Math.round(reps), draft.rpe ?? undefined);
      haptics.success();
      // The web's order: a superset's partner for the same round, else more of
      // this movement, else the next in turn. A superset rests after B only.
      const after = afterLoggedSet(session, logged, useAppStore.getState().currentWorkout?.sets ?? []);
      const chosen = useFocusStore.getState().exerciseId;
      if (after.nextExerciseId && (!chosen || chosen === logged.exercise_id)) focus(after.nextExerciseId);
      if (after.rest) startRest(current.movement.exerciseId);
    } catch {
      haptics.error();
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const bump = (field: 'weight' | 'reps', delta: number) => {
    setDraft((existing) => {
      if (!existing) return existing;
      const value = parseNumber(existing[field]) ?? 0;
      return { ...existing, [field]: String(Math.max(0, value + delta)), touched: true };
    });
    haptics.select();
  };

  const pickRpe = () =>
    chooseRpe((rpe) => setDraft((existing) => (existing ? { ...existing, rpe, touched: true } : existing)));

  /** Sets, note and swap for one movement. */
  const openMovement = (exerciseId: string) => router.push({ pathname: '/movement', params: { id: exerciseId } });

  const finish = () => {
    const close = async (saveTemplate: boolean) => {
      // Notes typed during the workout land before it closes, as on the web.
      if (!(await flushNotes())) {
        haptics.error();
        Alert.alert('Note not saved', 'The workout is still open. Check your connection and try again.');
        return;
      }
      const summary = summarize(session);
      try {
        // A flexible session can be kept as a quick start, notes included.
        if (saveTemplate) await saveTemplateFromWorkout();
        await completeWorkout();
        if (saveTemplate) void fetchFlexTemplates({ force: true });
        setFinished(summary);
        stopRest();
        haptics.success();
        router.push('/session-done');
      } catch {
        haptics.error();
        Alert.alert('Not saved', 'The workout is still open. Check your connection and try again.');
      }
    };
    Alert.alert('Finish workout?', `${session.doneCount} of ${session.sets.length} sets logged.`, [
      ...(session.flexible && session.movements.length > 0
        ? [{ text: 'Finish and save as quick start', onPress: () => void close(true) }]
        : []),
      { text: 'Finish', onPress: () => void close(false) },
      { text: 'Keep going', style: 'cancel' as const },
    ]);
  };

  const rename = () => {
    Alert.prompt(
      'Workout name',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            const name = text?.trim().slice(0, 40);
            if (!name || name === session.dayName) return;
            renameSession(session.workoutId, name).then(
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
      session.dayName,
    );
  };

  const blockCount = movementBlocks(
    session.movements.map((movement) => ({ id: movement.exerciseId, name: movement.name, supersetGroupId: movement.superset?.groupId })),
  ).length;
  const addMovement = () => router.push({ pathname: '/swap', params: { mode: 'add' } });

  return (
    <>
      <Stack.Screen
        options={{
          title: session.dayName,
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Finish',
              variant: 'prominent',
              tintColor: c.ink,
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
              onPress: () => {
                haptics.tap();
                router.push('/rest');
              },
            },
            // A flexible session is named by the person; it can be renamed.
            ...(session.flexible
              ? [
                  {
                    type: 'button' as const,
                    label: 'Rename workout',
                    icon: { type: 'sfSymbol' as const, name: 'pencil' as const },
                    onPress: () => {
                      haptics.tap();
                      rename();
                    },
                  },
                ]
              : []),
          ],
        }}
      />
      <TabScroll
        ref={scroll}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        onScroll={(event) => {
          scrollOffset.current = event.nativeEvent.contentOffset.y;
          if (__DEV__ && devScrollTrace.enabled) console.log(`[scroll] ${event.nativeEvent.contentOffset.y.toFixed(1)}`);
        }}>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          <BlancText variant="meta" size={14} tone="graphite">
            {formatClock(elapsed)}
          </BlancText>
          {`  ·  ${session.doneCount} of ${session.sets.length} sets`}
        </BlancText>

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
              <BlancText variant="title" numberOfLines={2} style={{ flex: 1 }}>
                {current.movement.name}
              </BlancText>
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
            {current.movement.note ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={2} style={{ marginTop: 6 }}>
                {current.movement.note}
              </BlancText>
            ) : null}

            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, marginTop: 14 }}>
              <BigValue
                value={draft.weight}
                unit="lb"
                accessibilityLabel="Weight in pounds"
                onChange={(text) => setDraft({ ...draft, weight: text, touched: true })}
                onFocus={() => setEditing('weight')}
                onBlur={() => setEditing((field) => (field === 'weight' ? null : field))}
              />
              <BlancText variant="figure" size={30} tone="graphite" style={{ marginBottom: 12 }}>
                ×
              </BlancText>
              <BigValue
                value={draft.reps}
                unit="reps"
                integer
                accessibilityLabel="Reps"
                onChange={(text) => setDraft({ ...draft, reps: text, touched: true })}
                onFocus={() => setEditing('reps')}
                onBlur={() => setEditing((field) => (field === 'reps' ? null : field))}
              />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={draft.rpe ? `RPE ${draft.rpe}. Change` : 'Add RPE'}
                onPress={pickRpe}
                style={({ pressed }) => ({
                  height: 32,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  justifyContent: 'center',
                  backgroundColor: pressed ? c.pressed : c.fill,
                })}>
                <BlancText variant="footnote" weight="500">
                  {draft.rpe ? `RPE ${draft.rpe}` : 'Add RPE'}
                </BlancText>
              </Pressable>
              {last && last.weight !== null && last.reps !== null ? (
                <BlancText variant="meta" tone="graphite">
                  Last time {formatLoad(last.weight)} × {last.reps}
                </BlancText>
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
          <Label style={{ marginTop: 18, padding: 18, gap: 14 }}>
            <BlancText variant="headline">Add your first movement</BlancText>
            <Capsule title="Add movement" size="large" fill onPress={addMovement} />
          </Label>
        ) : (
          <Label style={{ marginTop: 18, padding: 18, gap: 14 }}>
            <BlancText variant="headline">All sets logged</BlancText>
            <Capsule title="Finish workout" size="large" fill onPress={finish} />
          </Label>
        )}

        {session.movements.length > 0 ? (
        <Section
          title="Movements"
          action={blockCount > 1 ? { title: 'Reorder', onPress: () => router.push('/reorder') } : undefined}>
          <Label>
            {session.movements.map((movement, index) => {
              const isCurrent = movement.exerciseId === current?.movement.exerciseId;
              const complete = movement.done === movement.sets.length;
              const plan = movement.plan;
              const lastSet = previous[movement.exerciseId]?.[1];
              return (
                <View key={movement.exerciseId}>
                  {index > 0 ? <Hairline /> : null}
                  {complete ? (
                    // Finished movements open their sets, to correct one.
                    <Row
                      quiet
                      title={movement.name}
                      value={`Done · ${movement.done} of ${movement.sets.length}`}
                      leading={<SymbolView name="checkmark" size={14} weight="semibold" tintColor={c.graphite} />}
                      accessibilityLabel={`${movement.name}, done, ${movement.done} sets. Show sets`}
                      onPress={() => openMovement(movement.exerciseId)}
                    />
                  ) : (
                    // Tap to work on a movement next; hold for its sets, note and swap.
                    <Row
                      title={movement.name}
                      detail={[
                        isCurrent ? 'Now' : `${movement.done} of ${movement.sets.length}`,
                        movement.superset
                          ? `superset ${movement.superset.role}`
                          : movement.substitutesFor
                          ? `instead of ${movement.substitutesFor.exercise_name ?? 'the planned movement'}`
                          : plan && plan.target_reps_min && plan.target_reps_max
                            ? `${plan.target_sets} × ${plan.target_reps_min}–${plan.target_reps_max}`
                            : null,
                        lastSet && lastSet.weight !== null ? `last ${formatLoad(lastSet.weight)} × ${lastSet.reps ?? '–'}` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      chevron={!isCurrent}
                      onPress={isCurrent ? () => openMovement(movement.exerciseId) : () => focus(movement.exerciseId)}
                      onLongPress={{ label: 'Sets, note and swap', run: () => openMovement(movement.exerciseId) }}
                    />
                  )}
                </View>
              );
            })}
            {session.flexible ? (
              <>
                <Hairline />
                <Row
                  title="Add movement"
                  leading={<SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />}
                  onPress={addMovement}
                />
              </>
            ) : null}
          </Label>
        </Section>
        ) : null}
      </TabScroll>

      {editing ? (
        <KeyboardStickyView style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <KeyBar
            step={editing === 'weight' ? '5 lb' : '1'}
            onMinus={() => bump(editing, editing === 'weight' ? -5 : -1)}
            onPlus={() => bump(editing, editing === 'weight' ? 5 : 1)}
          />
        </KeyboardStickyView>
      ) : null}
    </>
  );
}

function BigValue({
  value,
  unit,
  onChange,
  onFocus,
  onBlur,
  accessibilityLabel,
  integer,
}: {
  value: string;
  unit: string;
  onChange: (text: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  accessibilityLabel: string;
  integer?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      <FigureInput
        value={value}
        fontSize={76}
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
    </View>
  );
}

/** Quick steps that ride on the number pad, plus Done (the pad has no return key). */
function KeyBar({ step, onMinus, onPlus }: { step: string; onMinus: () => void; onPlus: () => void }) {
  const c = useBlanc();
  const key = (label: string, onPress: () => void, accessibilityLabel: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
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
      {key(
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
              ],
            },
          },
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  return (
    <>
      {header}
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {split ? [split.name, week && week >= 1 ? `week ${week}` : null].filter(Boolean).join(' · ') : 'No program yet'}
        </BlancText>
        <PlanCard hero={plan.hero} next={plan.next} place="train" />
        {split && split.days.length > 0 ? (
          <Section title="Other days">
            <Label>
              {split.days.map((day, index) => (
                <View key={day.id}>
                  {index > 0 ? <Hairline /> : null}
                  <Row
                    title={day.day_name}
                    detail={`${day.exercises.length} movements · ${day.exercises.reduce((sum, exercise) => sum + exercise.target_sets, 0)} sets`}
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
            {otherNote ? (
              <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
                {otherNote}
              </BlancText>
            ) : null}
          </Section>
        ) : null}
      </TabScroll>
    </>
  );
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
      <TabScroll keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          Flexible · build today as you go
        </BlancText>

        <Section title="What are you training?" style={{ marginTop: 18 }}>
          <Label style={{ paddingHorizontal: 18, paddingVertical: 14 }}>
            {/* Drawn as plain text: iOS squeezed this field's own placeholder
                together (letters nearly overlapping) on the new renderer. */}
            {name ? null : (
              <BlancText
                variant="body"
                tone="graphite"
                numberOfLines={1}
                importantForAccessibility="no"
                accessibilityElementsHidden
                pointerEvents="none"
                style={{ position: 'absolute', left: 18, right: 18, top: 14 }}>
                Upper, push, arms…
              </BlancText>
            )}
            <TextInput
              key={field.key}
              defaultValue={field.text}
              onChangeText={(text) => {
                setName(text);
                // Typing a different name leaves the quick start, as on the web.
                if (template && text !== template) setTemplate(null);
              }}
              maxLength={FLEX_NAME_LIMIT}
              autoCorrect={false}
              returnKeyType="go"
              onSubmitEditing={() => void start()}
              selectionColor={c.ink}
              accessibilityLabel="What are you training?"
              accessibilityHint="For example upper, push or arms"
              style={[typeScale.body, { color: c.ink, padding: 0, minHeight: 22 }]}
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
                    haptics.select();
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
