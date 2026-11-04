import { format, parseISO } from 'date-fns';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';

import { activityTimeValue, buildActivityInput } from '@/lib/activitySessions';
import { ACTIVITY_TYPE_LABELS, ACTIVITY_TYPES, type ActivityType } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote, MenuRow, PickerRow, ToggleRow } from '~/components/Form';
import { GlassButton } from '~/components/GlassButton';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { haptics } from '~/lib/haptics';
import { confirmDeleteActivity, saveActivity, useHistoryStore } from '~/lib/history';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { space, useBlanc } from '~/theme/blanc';

const NOTES_LIMIT = 280;

/** Adds or edits an activity: type, name, day, start, length and notes, with the web's rules. */
export default function ActivitySheet() {
  const c = useBlanc();
  const params = useLocalSearchParams<{ id?: string; day?: string }>();
  const stored = useHistoryStore((state) => state.activities.find((activity) => activity.id === params.id) ?? null);
  // A delete takes the activity off History at once; the sheet keeps it
  // while the delete runs.
  const [kept, setKept] = useState(stored);
  if (stored && stored !== kept) setKept(stored);
  const editing = params.id ? (stored ?? kept) : null;
  const [initial] = useState(() => ({
    type: editing?.activity_type ?? 'bike_ride',
    customType: editing?.custom_type ?? '',
    title: editing?.title ?? '',
    date: editing?.date ?? params.day ?? new Date().toISOString().slice(0, 10),
    start: editing?.started_at ? new Date(editing.started_at).getTime() : null,
    minutes: editing?.duration_seconds ? String(Math.round(editing.duration_seconds / 60)) : '',
    notes: editing?.notes ?? '',
  }));
  const [type, setType] = useState<ActivityType>(initial.type);
  const [customType, setCustomType] = useState(initial.customType);
  const [title, setTitle] = useState(initial.title);
  const [date, setDate] = useState(() => parseISO(initial.date));
  const [start, setStart] = useState<Date | null>(() => (initial.start === null ? null : new Date(initial.start)));
  const [minutes, setMinutes] = useState(initial.minutes);
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  // Changes hold the sheet: closing asks before they go.
  const dirty =
    type !== initial.type ||
    customType !== initial.customType ||
    title !== initial.title ||
    format(date, 'yyyy-MM-dd') !== initial.date ||
    (start?.getTime() ?? null) !== initial.start ||
    minutes !== initial.minutes ||
    notes !== initial.notes;
  useLeaveGuard(dirty && !done, { title: editing ? 'Discard your changes?' : 'Discard this activity?' }, { busy: busy !== null });
  // Closes once the guard has seen the saved or deleted state.
  useEffect(() => {
    if (done) router.back();
  }, [done]);

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
      setDone(true);
    } else {
      haptics.error();
      setFailed(true);
      setBusy(null);
    }
  };

  // The same question as History's swipe; the haptics and a failure's alert come with it.
  const remove = () => {
    if (!editing || busy) return;
    void confirmDeleteActivity(editing, {
      onConfirmed: () => setBusy('delete'),
      onDeleted: () => setDone(true),
    }).then((deleted) => {
      if (!deleted) setBusy(null);
    });
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
        <View style={{ width: 44 }} />
      </View>

      <Label style={{ marginTop: 22 }}>
        <MenuRow
          label="Activity"
          value={type}
          options={ACTIVITY_TYPES.map((value) => ({ value, label: ACTIVITY_TYPE_LABELS[value] }))}
          onChange={(value) => setType(value as ActivityType)}
        />
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
        {/* Off leaves the start out; on brings back the saved start, else now. */}
        <ToggleRow label="Start time" value={start !== null} onChange={(on) => setStart(on ? new Date(initial.start ?? Date.now()) : null)} />
        {start ? (
          <>
            <Hairline />
            <PickerRow label="Start" mode="time" value={start} onChange={setStart} />
          </>
        ) : null}
        <Hairline />
        <FieldRow
          label="Duration"
          unit={minutes ? 'min' : undefined}
          value={minutes}
          onChangeText={(text) => setMinutes(text.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          placeholder="Optional"
          maxLength={4}
        />
      </Label>

      <Label style={{ marginTop: 18 }}>
        <FieldNotes value={notes} onChange={setNotes} />
      </Label>

      {failed ? <FormNote alert>Not saved. Check your connection and try again.</FormNote> : null}

      <View style={{ marginHorizontal: space.inset, marginTop: 24 }}>
        {/* An edit saves once something changed; a new activity can save as it opened. */}
        <Capsule title="Save" size="large" fill busy={busy === 'save'} disabled={busy === 'delete' || (Boolean(editing) && !dirty)} onPress={() => void save()} />
      </View>

      {editing ? (
        <Label style={{ marginTop: space.section }}>
          <Row title="Delete activity" destructive disabled={busy !== null} onPress={remove} />
        </Label>
      ) : null}
      <View style={{ height: space.section }} />
    </KeyboardAwareScrollView>
  );
}

function FieldNotes({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  // Wraps and grows from the label's line, as the program editor's names do, and keeps its line breaks.
  return <FieldRow label="Notes" wide grows paragraphs value={value} onChangeText={onChange} placeholder="Optional" maxLength={NOTES_LIMIT} />;
}
