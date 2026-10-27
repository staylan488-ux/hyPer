import { parseISO } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { activityTimeValue, buildActivityInput } from '@/lib/activitySessions';
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, type ActivityType } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, PickerRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { haptics } from '~/lib/haptics';
import { deleteActivity, saveActivity, useHistoryStore } from '~/lib/history';
import { space, useBlanc } from '~/theme/blanc';

const NOTES_LIMIT = 280;

/** Adds or edits an activity: type, name, day, start, length and notes, with the web's rules. */
export default function ActivitySheet() {
  const c = useBlanc();
  const params = useLocalSearchParams<{ id?: string; day?: string }>();
  const editing = useHistoryStore((state) => state.activities.find((activity) => activity.id === params.id) ?? null);
  const [type, setType] = useState<ActivityType>(editing?.activity_type ?? 'bike_ride');
  const [customType, setCustomType] = useState(editing?.custom_type ?? '');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [date, setDate] = useState(() => parseISO(editing?.date ?? params.day ?? new Date().toISOString().slice(0, 10)));
  const [start, setStart] = useState<Date | null>(() => (editing?.started_at ? new Date(editing.started_at) : null));
  const [minutes, setMinutes] = useState(editing?.duration_seconds ? String(Math.round(editing.duration_seconds / 60)) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [failed, setFailed] = useState(false);

  const chooseType = () => {
    haptics.tap();
    ActionSheetIOS.showActionSheetWithOptions(
      { title: 'Activity', options: [...ACTIVITY_TYPES.map((value) => ACTIVITY_TYPE_LABELS[value]), 'Cancel'], cancelButtonIndex: ACTIVITY_TYPES.length },
      (index) => {
        if (index >= ACTIVITY_TYPES.length) return;
        haptics.select();
        setType(ACTIVITY_TYPES[index]);
      },
    );
  };

  const save = async () => {
    if (busy) return;
    setBusy('save');
    setFailed(false);
    const input = buildActivityInput(
      { activityType: type, customType, title, date, startTime: start ? activityTimeValue(start.toISOString()) : '', durationMinutes: minutes, notes },
      editing,
    );
    const saved = await saveActivity(editing, input).catch(() => false);
    if (saved) {
      haptics.success();
      router.back();
    } else {
      haptics.error();
      setFailed(true);
      setBusy(null);
    }
  };

  const remove = () => {
    if (!editing || busy) return;
    Alert.alert('Delete this activity?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy('delete');
          const deleted = await deleteActivity(editing);
          if (deleted) {
            haptics.success();
            router.back();
          } else {
            haptics.error();
            setBusy(null);
            Alert.alert('Not deleted', 'Check your connection and try again.');
          }
        },
      },
    ]);
  };

  return (
    <KeyboardAwareScrollView
      bottomOffset={24}
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
        <GlassButton symbol="xmark" accessibilityLabel="Close" onPress={() => router.back()} />
        <BlancText variant="headline" style={{ flex: 1, textAlign: 'center' }} accessibilityRole="header">
          {editing ? 'Edit activity' : 'Add activity'}
        </BlancText>
        <Capsule title="Save" busy={busy === 'save'} onPress={() => void save()} />
      </View>

      <Label style={{ marginTop: 22 }}>
        <Row title="Activity" quiet value={ACTIVITY_TYPE_LABELS[type]} chevron onPress={chooseType} />
        {type === 'other' ? (
          <>
            <Hairline />
            <FieldRow label="Name" wide value={customType} onChangeText={setCustomType} placeholder="Yoga, climbing…" maxLength={40} />
          </>
        ) : null}
        <Hairline />
        <FieldRow label="Title" wide value={title} onChangeText={setTitle} placeholder="Optional" />
      </Label>

      <Label style={{ marginTop: 18 }}>
        <PickerRow label="Date" mode="date" value={date} max={new Date()} onChange={setDate} />
        <Hairline />
        {start ? (
          <PickerRow label="Start" mode="time" value={start} onChange={setStart} />
        ) : (
          <Row title="Add start time" quiet onPress={() => setStart(new Date())} />
        )}
        <Hairline />
        <FieldRow label="Duration" unit="min" value={minutes} onChangeText={(text) => setMinutes(text.replace(/[^0-9]/g, ''))} keyboardType="number-pad" placeholder="0" maxLength={4} />
      </Label>

      <Label style={{ marginTop: 18 }}>
        <FieldNotes value={notes} onChange={setNotes} />
      </Label>

      {failed ? <FormNote alert>Not saved. Check your connection and try again.</FormNote> : null}

      {editing ? (
        <Label style={{ marginTop: 30 }}>
          <Pressable accessibilityRole="button" disabled={busy !== null} onPress={remove} style={{ minHeight: 52, justifyContent: 'center', paddingHorizontal: 18 }}>
            {({ pressed }) => (
              <BlancText variant="body" tone="live" style={{ opacity: pressed || busy === 'delete' ? 0.5 : 1 }}>
                Delete activity
              </BlancText>
            )}
          </Pressable>
        </Label>
      ) : null}
      <View style={{ height: space.section }} />
    </KeyboardAwareScrollView>
  );
}

function FieldNotes({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  return (
    <FieldRow
      label="Notes"
      wide
      value={value}
      onChangeText={onChange}
      placeholder="Optional"
      multiline
      maxLength={NOTES_LIMIT}
    />
  );
}
