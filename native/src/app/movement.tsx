import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { format, parseISO } from 'date-fns';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { useAppStore } from '@/stores/appStore';
import type { WorkoutSet } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { FigureInput } from '~/components/FigureInput';
import { FormNote } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { LoggedSetRow } from '~/components/LoggedSetRow';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { Stepper } from '~/components/Stepper';
import { gainOnLastTime } from '~/lib/beatLastTime';
import { formatRepRange } from '~/lib/format';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { changeSetCount, confirmRemoveMovement, errorMessage, setSkipped, switchBack, unlinkSuperset } from '~/lib/movement';
import { editNote, NOTE_LIMIT, saveNoteNow, useMovementNote } from '~/lib/notes';
import { usePreviousNotesStore, usePreviousTargets, useSessionModel, type Movement } from '~/lib/session';
import { chooseRpe, parseNumber } from '~/lib/setEntry';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * One movement of the live workout: correct a logged set, change how many
 * sets it has, keep a note, or swap or skip it for this workout only. In a
 * flexible session it can also be paired as a superset or taken out.
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
      // Room under a set being corrected for its Cancel and Save.
      bottomOffset={96}
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
  if (movement.skipped) return 'Skipped for this workout';
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
  // Logged sets that beat the same set last time carry an up mark.
  const previous = usePreviousTargets(workoutId);
  const hasUnfinished = inWorkout && movement.sets.some((set) => !set.completed);
  // One set with an RPE keeps the column on every row, so the numbers line up.
  const rpeColumn = movement.sets.some((set) => set.completed && set.rpe);
  // After a switch back or a removal saves, the sheet closes only if it is
  // still on top: closed while it saved, the back would close the next screen.
  const navigation = useNavigation();
  const closeSheet = () => {
    if (navigation.isFocused()) router.back();
  };

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
      closeSheet();
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
    }
    // After the try, not in a finally: the React Compiler can't compile a
    // component holding try/finally, and nothing above throws.
    setEditingPlan(null);
  };

  const confirmRemove = () =>
    confirmRemoveMovement(workoutId, movement, {
      onStart: () => setEditingPlan('remove'),
      onRemoved: closeSheet,
      onFailed: () => setEditingPlan(null),
    });

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
                  <LoggedSetRow
                    set={set}
                    number={index + 1}
                    gain={gainOnLastTime(set, previous)}
                    rpeColumn={rpeColumn}
                    disabled={editing !== null}
                    onPress={() => setEditing(set.id)}
                  />
                )}
                <Hairline />
              </View>
            ) : null,
          )}
          <View style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <RollingText variant="bodyStrong">{`${movement.sets.length} ${movement.sets.length === 1 ? 'set' : 'sets'}`}</RollingText>
              {/* The logged sets show above; the plan's count is for reference. */}
              {movement.range ? (
                <BlancText variant="secondary" tone="graphite" numberOfLines={1} style={{ marginTop: 1 }}>
                  {rangeLine(movement)}
                </BlancText>
              ) : null}
            </View>
            <Stepper
              busy={changing !== null}
              canMinus={movement.canRemoveSet}
              canPlus={movement.canAddSet}
              minusLabel="Remove a set"
              plusLabel="Add a set"
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
            style={[typeScale.fieldLines, { color: c.ink, minHeight: 66, padding: 0 }]}
          />
        </Label>
        <NoteFooter status={note.status} length={note.text.length} />
        {lastNote ? (
          <FormNote>
            Last note, {format(parseISO(lastNote.date), 'MMM d')}: {lastNote.note}
          </FormNote>
        ) : null}
      </Section>

      {hasUnfinished ? (
        <Section title="This workout">
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
              title="Swap"
              chevron
              onPress={() => router.push({ pathname: '/swap', params: { id: movement.exerciseId } })}
            />
            <Hairline />
            {/* Shows the change at once; the save follows, and says so if it fails. */}
            <Row
              title={movement.skipped ? 'Bring back' : 'Skip'}
              accessibilityLabel={movement.skipped ? `Bring back ${movement.name}` : `Skip ${movement.name} for this workout`}
              onPress={() => void setSkipped(workoutId, movement, !movement.skipped)}
            />
          </Label>
          <FormNote>Your program stays the same.</FormNote>
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
              destructive
              trailing={editingPlan === 'remove' ? <ActivityIndicator /> : undefined}
              onPress={editingPlan ? undefined : confirmRemove}
            />
          </Label>
        </Section>
      ) : null}
    </>
  );
}

/** Corrects a logged set. Saving never starts rest, as on the web. */
function SetEditor({ set, number, onClose }: { set: WorkoutSet; number: number; onClose: () => void }) {
  const logSet = useAppStore((state) => state.logSet);
  const [weight, setWeight] = useState(set.weight === null ? '' : String(set.weight));
  const [reps, setReps] = useState(set.reps === null ? '' : String(set.reps));
  const [rpe, setRpe] = useState<number | null>(set.rpe);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const weightValue = parseNumber(weight);
  const repsValue = parseNumber(reps);
  const ready = weightValue !== null && repsValue !== null;
  // Closing the sheet with a correction typed asks first; Save or Cancel closes the editor.
  const dirty =
    weight !== (set.weight === null ? '' : String(set.weight)) || reps !== (set.reps === null ? '' : String(set.reps)) || rpe !== set.rpe;
  useLeaveGuard(dirty, { title: 'Discard this correction?' }, { busy: saving });

  const save = async () => {
    if (weightValue === null || repsValue === null || saving) return;
    Keyboard.dismiss();
    setSaving(true);
    setFailed(false);
    const rpeValue = rpe ?? undefined;
    try {
      await logSet(set.id, weightValue, Math.round(repsValue), rpeValue);
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
        <Chip
          label={rpe ? `RPE ${rpe}` : 'Add RPE'}
          accessibilityLabel={rpe ? `RPE ${rpe}. Change` : 'Add RPE'}
          haptic={false}
          onPress={() => chooseRpe(setRpe)}
        />
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
  return <FormNote alert={status === 'failed'}>{text}</FormNote>;
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
