import { router, useLocalSearchParams } from 'expo-router';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { format, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useAppStore } from '@/stores/appStore';
import type { WorkoutSet } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FigureInput } from '~/components/FigureInput';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { formatLoad, formatRepRange } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { changeSetCount, errorMessage, removeMovement, switchBack, unlinkSuperset } from '~/lib/movement';
import { editNote, NOTE_LIMIT, saveNoteNow, useMovementNote } from '~/lib/notes';
import { usePreviousNotesStore, useSessionModel, type Movement } from '~/lib/session';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * One movement of the live workout: correct a logged set, change how many
 * sets it has, keep a note, or swap it for this workout only. In a flexible
 * session it can also be paired as a superset or taken out.
 */
export default function MovementSheet() {
  const c = useBlanc();
  const { id } = useLocalSearchParams<{ id: string }>();
  const session = useSessionModel();
  const live = session?.movements.find((entry) => entry.exerciseId === id) ?? null;
  // A swap closes this sheet as the movement leaves the workout: keep showing
  // it while the sheet slides away.
  const [last, setLast] = useState(live);
  if (live && live !== last) setLast(live);
  const movement = live ?? last;

  // A native sheet expects its scroll view as the screen's own view, so the
  // header rides in the list as a sticky first item.
  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingBottom: 40 }}
      stickyHeaderIndices={[0]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <View style={{ backgroundColor: c.ground, paddingBottom: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
          <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <BlancText variant="headline" numberOfLines={1} accessibilityRole="header">
              {movement?.name ?? 'Movement'}
            </BlancText>
            {movement ? (
              <BlancText variant="footnote" tone="graphite" numberOfLines={1}>
                {movementLine(movement)}
              </BlancText>
            ) : null}
          </View>
          <View style={{ width: 44 }} />
        </View>
      </View>

      {session && movement ? (
        <MovementDetail
          workoutId={session.workoutId}
          movement={movement}
          isCurrent={session.current?.movement.exerciseId === movement.exerciseId}
          inWorkout={live !== null}
          flexible={session.flexible}
        />
      ) : (
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 24 }}>
          This movement is no longer in the workout.
        </BlancText>
      )}
    </KeyboardAwareScrollView>
  );
}

/** "Instead of Bench Press" for a swap, the superset, else the rep target. */
function movementLine(movement: Movement): string {
  if (movement.substitutesFor) return `Instead of ${movement.substitutesFor.exercise_name ?? 'the planned movement'}`;
  if (movement.superset) return `Superset ${movement.superset.role} · with ${movement.superset.partnerName}`;
  return formatRepRange(movement.plan?.target_reps_min, movement.plan?.target_reps_max) ?? `${movement.sets.length} sets`;
}

/** "Plan: 3 sets" or "Plan: 3–4 sets", for reference; the count can still change. */
function rangeLine(movement: Movement): string | null {
  const range = movement.range;
  if (!range) return null;
  return range.minSets === range.maxSets ? `Plan: ${range.maxSets} sets` : `Plan: ${range.minSets}–${range.maxSets} sets`;
}

function MovementDetail({
  workoutId,
  movement,
  isCurrent,
  inWorkout,
  flexible,
}: {
  workoutId: string;
  movement: Movement;
  isCurrent: boolean;
  /** False once the movement has left the workout and the sheet is closing. */
  inWorkout: boolean;
  /** A flexible session: pair, unpair and remove movements. */
  flexible: boolean;
}) {
  const c = useBlanc();
  const [editing, setEditing] = useState<string | null>(null);
  const [changing, setChanging] = useState<'add' | 'remove' | null>(null);
  const [switching, setSwitching] = useState(false);
  const [editingPlan, setEditingPlan] = useState<'unlink' | 'remove' | null>(null);
  const note = useMovementNote(workoutId, movement.exerciseId, movement.note);
  // Last time's note for this movement, from the lookup Train made.
  const lastNote = usePreviousNotesStore((state) => (state.workoutId === workoutId ? state.notes[movement.exerciseId] : undefined));
  const hasUnfinished = inWorkout && movement.sets.some((set) => !set.completed);

  // Closing the sheet saves the note at once rather than after the pause.
  useEffect(() => () => saveNoteNow(workoutId, movement.exerciseId), [workoutId, movement.exerciseId]);

  const changeSets = async (change: 'add' | 'remove') => {
    if (changing) return;
    setChanging(change);
    const changed = await changeSetCount(movement.exerciseId, change).catch(() => false);
    setChanging(null);
    if (changed) haptics.success();
    else {
      haptics.error();
      Alert.alert(change === 'add' ? 'Set not added' : 'Set not removed', 'Check your connection and try again.');
    }
  };

  const runSwitchBack = async () => {
    const planned = movement.substitutesFor;
    if (!planned || switching) return;
    setSwitching(true);
    try {
      await switchBack(workoutId, movement.exerciseId, planned.exercise_id, isCurrent);
      haptics.success();
      router.back();
    } catch (error) {
      haptics.error();
      setSwitching(false);
      Alert.alert('Not switched back', errorMessage(error, 'Could not switch back. Try again.'));
    }
  };

  const runUnlink = async () => {
    if (editingPlan) return;
    setEditingPlan('unlink');
    try {
      await unlinkSuperset(workoutId, movement.exerciseId);
      haptics.success();
    } catch (error) {
      haptics.error();
      Alert.alert('Not unlinked', errorMessage(error, 'Could not unlink the superset. Try again.'));
    } finally {
      setEditingPlan(null);
    }
  };

  const confirmRemove = () => {
    Alert.alert(
      `Remove ${movement.name}?`,
      movement.done ? 'Its logged sets stay in this workout.' : 'It comes out of this workout only.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setEditingPlan('remove');
            try {
              await removeMovement(workoutId, movement.exerciseId);
              haptics.success();
              router.back();
            } catch (error) {
              haptics.error();
              setEditingPlan(null);
              Alert.alert('Not removed', errorMessage(error, 'Could not remove the exercise. Try again.'));
            }
          },
        },
      ],
    );
  };

  return (
    <>
      <Section title="Sets" style={{ marginTop: 14 }}>
        <Label>
          {/* Logged sets, to correct one; the count row below covers the rest. */}
          {movement.sets.map((set, index) =>
            set.completed ? (
              <View key={set.id}>
                {editing === set.id ? (
                  <SetEditor set={set} number={index + 1} onClose={() => setEditing(null)} />
                ) : (
                  <SetRow set={set} number={index + 1} onEdit={editing ? undefined : () => setEditing(set.id)} />
                )}
                <Hairline />
              </View>
            ) : null,
          )}
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <BlancText variant="bodyStrong">
                {movement.sets.length} {movement.sets.length === 1 ? 'set' : 'sets'}
              </BlancText>
              {movement.done || movement.range ? (
                <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
                  {[movement.done ? `${movement.done} logged` : null, rangeLine(movement)].filter(Boolean).join(' · ')}
                </BlancText>
              ) : null}
            </View>
            <Stepper
              busy={changing !== null}
              canMinus={movement.canRemoveSet}
              canPlus={movement.canAddSet}
              onMinus={() => void changeSets('remove')}
              onPlus={() => void changeSets('add')}
            />
          </View>
        </Label>
      </Section>

      <Section title="Note">
        <Label style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
          <TextInput
            value={note.text}
            onChangeText={(text) => editNote(workoutId, movement.exerciseId, text)}
            onBlur={() => saveNoteNow(workoutId, movement.exerciseId)}
            placeholder="Add a note, like a seat setting or a cue"
            placeholderTextColor={c.graphite}
            multiline
            maxLength={NOTE_LIMIT}
            scrollEnabled={false}
            selectionColor={c.ink}
            accessibilityLabel={`Note for ${movement.name}`}
            style={[typeScale.body, { color: c.ink, minHeight: 66, padding: 0 }]}
          />
        </Label>
        <NoteFooter status={note.status} length={note.text.length} />
        {lastNote ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
            Last time, {format(parseISO(lastNote.date), 'MMM d')}: {lastNote.note}
          </BlancText>
        ) : null}
      </Section>

      {hasUnfinished ? (
        <Section title="Swap">
          <Label>
            {movement.substitutesFor ? (
              <>
                <Row
                  title={`Switch back to ${movement.substitutesFor.exercise_name ?? 'the planned movement'}`}
                  trailing={switching ? <ActivityIndicator /> : undefined}
                  onPress={switching ? undefined : () => void runSwitchBack()}
                />
                <Hairline />
              </>
            ) : null}
            <Row
              title="Swap for this workout"
              chevron
              onPress={() => router.push({ pathname: '/swap', params: { id: movement.exerciseId } })}
            />
          </Label>
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
            Your program stays the same.
          </BlancText>
        </Section>
      ) : null}

      {flexible && inWorkout ? (
        <Section title="Session">
          <Label>
            {movement.superset ? (
              <Row
                title="Unlink superset"
                detail={`With ${movement.superset.partnerName}`}
                trailing={editingPlan === 'unlink' ? <ActivityIndicator /> : undefined}
                onPress={editingPlan ? undefined : () => void runUnlink()}
              />
            ) : (
              <Row
                title="Add a superset"
                detail="Alternate sets with another movement"
                chevron
                onPress={() => router.push({ pathname: '/swap', params: { id: movement.exerciseId, mode: 'superset' } })}
              />
            )}
            <Hairline />
            <Row
              title="Remove from workout"
              trailing={editingPlan === 'remove' ? <ActivityIndicator /> : undefined}
              onPress={editingPlan ? undefined : confirmRemove}
            />
          </Label>
        </Section>
      ) : null}
    </>
  );
}

/** A logged set; tap to correct it. */
function SetRow({ set, number, onEdit }: { set: WorkoutSet; number: number; onEdit?: () => void }) {
  const c = useBlanc();
  const numbers = `${formatLoad(set.weight)} lb × ${set.reps ?? '–'}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Set ${number}, ${numbers}${set.rpe ? `, RPE ${set.rpe}` : ''}. Edit`}
      disabled={!onEdit}
      onPress={() => {
        haptics.tap();
        onEdit?.();
      }}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? c.pressed : 'transparent' }]}>
      <BlancText variant="bodyStrong" style={{ flex: 1 }}>
        Set {number}
      </BlancText>
      <BlancText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'] }}>
        {numbers}
      </BlancText>
      {set.rpe ? (
        <BlancText variant="secondary" tone="graphite">
          RPE {set.rpe}
        </BlancText>
      ) : null}
      <SymbolView name="pencil" size={13} weight="semibold" tintColor={c.upcoming} />
    </Pressable>
  );
}

/** Corrects a logged set. Saving never starts rest, as on the web. */
function SetEditor({ set, number, onClose }: { set: WorkoutSet; number: number; onClose: () => void }) {
  const c = useBlanc();
  const logSet = useAppStore((state) => state.logSet);
  const [weight, setWeight] = useState(set.weight === null ? '' : String(set.weight));
  const [reps, setReps] = useState(set.reps === null ? '' : String(set.reps));
  const [rpe, setRpe] = useState<number | null>(set.rpe);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const weightValue = parseNumber(weight);
  const repsValue = parseNumber(reps);
  const ready = weightValue !== null && repsValue !== null;

  const save = async () => {
    if (weightValue === null || repsValue === null || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    try {
      await logSet(set.id, weightValue, Math.round(repsValue), rpe ?? undefined);
      haptics.success();
      onClose();
    } catch {
      haptics.error();
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <BlancText variant="bodyStrong">Set {number}</BlancText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={rpe ? `RPE ${rpe}. Change` : 'Add RPE'}
          onPress={() => chooseRpe(setRpe)}
          style={({ pressed }) => ({
            height: 32,
            paddingHorizontal: 12,
            borderRadius: 16,
            justifyContent: 'center',
            backgroundColor: pressed ? c.pressed : c.fill,
          })}>
          <BlancText variant="footnote" weight="500">
            {rpe ? `RPE ${rpe}` : 'Add RPE'}
          </BlancText>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
          <FigureInput
            value={weight}
            fontSize={48}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            selectTextOnFocus
            maxLength={6}
            accessibilityLabel={`Set ${number} weight in pounds`}
          />
          <BlancText variant="secondary" tone="graphite">
            lb
          </BlancText>
        </View>
        <BlancText variant="figure" size={24} tone="graphite" style={{ marginBottom: 8 }}>
          ×
        </BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 5 }}>
          <FigureInput
            value={reps}
            fontSize={48}
            onChangeText={setReps}
            keyboardType="number-pad"
            selectTextOnFocus
            maxLength={4}
            accessibilityLabel={`Set ${number} reps`}
          />
          <BlancText variant="secondary" tone="graphite">
            reps
          </BlancText>
        </View>
      </View>

      {failed ? (
        <BlancText variant="footnote" tone="live" style={{ marginTop: 10 }}>
          Not saved. Your numbers are kept; try again.
        </BlancText>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <View style={{ flex: 1 }}>
          <Capsule title="Cancel" variant="quiet" fill disabled={saving} onPress={onClose} />
        </View>
        <View style={{ flex: 1 }}>
          <Capsule title={failed ? 'Retry' : 'Save'} fill busy={saving} disabled={!ready} onPress={() => void save()} />
        </View>
      </View>
    </View>
  );
}

/** iOS-style stepper: minus and plus halves of one pill. */
function Stepper({
  canMinus,
  canPlus,
  busy,
  onMinus,
  onPlus,
}: {
  canMinus: boolean;
  canPlus: boolean;
  busy: boolean;
  onMinus: () => void;
  onPlus: () => void;
}) {
  const c = useBlanc();
  const half = (symbol: SFSymbol, enabled: boolean, onPress: () => void, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled || busy, busy }}
      disabled={!enabled || busy}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        width: 48,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}>
      <SymbolView name={symbol} size={15} weight="semibold" tintColor={enabled && !busy ? c.ink : c.upcoming} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 9, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill }}>
      {half('minus', canMinus, onMinus, 'Remove a set')}
      <View style={{ width: StyleSheet.hairlineWidth, height: 18, backgroundColor: c.hairline }} />
      {half('plus', canPlus, onPlus, 'Add a set')}
    </View>
  );
}

function NoteFooter({ status, length }: { status: 'saving' | 'saved' | 'failed' | null; length: number }) {
  const text =
    status === 'failed'
      ? 'Not saved yet. It will try again.'
      : status === 'saving'
        ? 'Saving…'
        : status === 'saved'
          ? 'Saved'
          : length >= 160
            ? `${length} of ${NOTE_LIMIT}`
            : null;
  if (!text) return null;
  return (
    <BlancText
      variant="footnote"
      tone={status === 'failed' ? 'live' : 'graphite'}
      accessibilityLiveRegion="polite"
      style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
      {text}
    </BlancText>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 16,
  },
});
