import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getSetAutofillValues, type PreviousWorkoutSetMap } from '@/lib/setAutofill';
import { useAppStore } from '@/stores/appStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Tally } from '~/components/Tally';
import { useFinishedStore, summarize } from '~/lib/finished';
import { formatClock, formatLoad, formatRepRange } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { flushNotes } from '~/lib/notes';
import { startRest, useRestStore } from '~/lib/rest';
import { useFocusStore, useNow, usePreviousTargets, useSessionModel, useStartSession, type SessionModel } from '~/lib/session';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { devScrollTrace } from '~/platform/devLaunch';
import { space, useBlanc } from '~/theme/blanc';

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
  const logSet = useAppStore((state) => state.logSet);
  const completeWorkout = useAppStore((state) => state.completeWorkout);
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

  const log = async () => {
    if (!current || !draft || weight === null || reps === null || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    try {
      await logSet(current.set.id, weight, Math.round(reps), draft.rpe ?? undefined);
      haptics.success();
      startRest(current.movement.exerciseId);
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
    Alert.alert('Finish workout?', `${session.doneCount} of ${session.sets.length} sets logged.`, [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Finish',
        onPress: async () => {
          // Notes typed during the workout land before it closes, as on the web.
          if (!(await flushNotes())) {
            haptics.error();
            Alert.alert('Note not saved', 'The workout is still open. Check your connection and try again.');
            return;
          }
          const summary = summarize(session);
          try {
            await completeWorkout();
            setFinished(summary);
            useRestStore.getState().stop();
            haptics.success();
            router.push('/session-done');
          } catch {
            haptics.error();
            Alert.alert('Not saved', 'The workout is still open. Check your connection and try again.');
          }
        },
      },
    ]);
  };

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
                current.movement.substitutesFor
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

            {failed ? (
              <BlancText variant="footnote" tone="live" style={{ marginTop: 14 }}>
                Not saved. Your numbers are kept; try again.
              </BlancText>
            ) : null}

            <Capsule
              title={failed ? 'Retry' : 'Log set'}
              size="large"
              fill
              busy={saving}
              disabled={!ready}
              onPress={() => void log()}
              style={{ marginTop: 16 }}
            />
            </Animated.View>
          </Label>
          </View>
        ) : (
          <Label style={{ marginTop: 18, padding: 18, gap: 14 }}>
            <BlancText variant="headline">All sets logged</BlancText>
            <Capsule title="Finish workout" size="large" fill onPress={finish} />
          </Label>
        )}

        <Section title="Movements">
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
                        movement.substitutesFor
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
          </Label>
        </Section>
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

/** No live workout: start one of the program's days. */
function StartWorkout() {
  const split = useAppStore((state) => state.activeSplit);
  const { starting, start } = useStartSession();

  return (
    <>
      <Stack.Screen options={{ title: 'Train', unstable_headerRightItems: () => [] }} />
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {split ? `${split.name} · ${split.days.length} days` : 'No program yet'}
        </BlancText>
        {split ? (
          <Section title="Start a session">
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
          </Section>
        ) : null}
      </TabScroll>
    </>
  );
}
