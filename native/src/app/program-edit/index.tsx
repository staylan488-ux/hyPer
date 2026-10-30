import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { formatDistanceToNowStrict } from 'date-fns';
import { router, Stack, useIsFocused, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState, type ComponentProps } from 'react';
import { Alert, Keyboard, ScrollView, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { saveSplitEdit } from '@/components/split/editor/editorActions';
import type { ProgramDesignAnswers } from '@/lib/programDesigner';
import {
  BLANK_DAY_OPTIONS,
  DAYS_QUESTION,
  DEFAULT_BLANK_DAYS,
  DEFAULT_PROGRAM_ANSWERS,
  EQUIPMENT_QUESTION,
  EXPERIENCE_QUESTION,
  FOCUS_QUESTION,
  LIBRARY_LOAD_FAILED,
  SESSION_QUESTION,
  guidedTemplate,
  seedGuidedDraft,
  templateExerciseCount,
  type ProgramQuestion,
} from '@/lib/programQuestions';
import { plural } from '@/lib/programSummary';
import { dayLabel, daySummary, type DraftDay } from '@/lib/splitDraft';
import { blankSplitDraft } from '@/lib/splitDraftSeed';
import { NEW_SPLIT_DRAFT_ID, clearSplitDraft, readSplitDraft } from '@/lib/splitDraftStorage';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import { useSplitEditStore } from '@/stores/splitEditStore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Chip } from '~/components/Chip';
import { FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import type { MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { UndoBar } from '~/components/UndoBar';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { afterProgramSaved, confirmAlert } from '~/lib/program';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

/**
 * Creating and editing share one editor, as on the web. A new program starts
 * at the chooser (guided or blank), which only fills the draft; nothing is
 * created until Create.
 */
export default function ProgramEditScreen() {
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const hasDraft = useSplitEditStore((state) => state.draft !== null);
  const [notice, setNotice] = useState<string | null>(null);
  if (mode === 'new' && !hasDraft) return <Chooser onNotice={setNotice} />;
  return <Editor notice={notice} />;
}

const cancel = () => {
  haptics.tap();
  Keyboard.dismiss();
  router.back();
};

// ── Chooser ──────────────────────────────────────────────────────────

function Chooser({ onNotice }: { onNotice: (notice: string | null) => void }) {
  const c = useBlanc();
  const userId = useAuthStore((state) => state.user?.id ?? null);
  const [stored, setStored] = useState(() => (userId ? readSplitDraft(userId, NEW_SPLIT_DRAFT_ID) : null));
  const [answers, setAnswers] = useState<ProgramDesignAnswers>(DEFAULT_PROGRAM_ANSWERS);
  const [blankDays, setBlankDays] = useState(String(DEFAULT_BLANK_DAYS));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guided = useMemo(() => guidedTemplate(answers), [answers]);

  const startGuided = async () => {
    setLoading(true);
    setError(null);
    try {
      const { draft, notice } = await seedGuidedDraft(guided);
      haptics.success();
      onNotice(notice);
      useSplitEditStore.getState().startNew(draft, { userId });
    } catch {
      haptics.error();
      setError(LIBRARY_LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  };

  const answer = <K extends keyof ProgramDesignAnswers>(key: K, value: ProgramDesignAnswers[K]) => {
    haptics.select();
    setAnswers((current) => ({ ...current, [key]: value }));
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'New program',
          unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel }],
          unstable_headerRightItems: () => [],
        }}
      />
      <ScrollView style={{ flex: 1, backgroundColor: c.ground }} contentContainerStyle={{ paddingBottom: 48 }}>
        {stored ? (
          <Label style={{ marginTop: 12, padding: 18, gap: 12 }}>
            <BlancText variant="body">
              Unsaved program{stored.draft.name.trim() ? ` “${stored.draft.name.trim()}”` : ''} · {plural(stored.draft.days.length, 'day')}, from{' '}
              {formatDistanceToNowStrict(stored.savedAt, { addSuffix: true })}.
            </BlancText>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Capsule
                  title="Discard it"
                  variant="quiet"
                  fill
                  onPress={() => {
                    void confirmAlert({
                      title: 'Discard this program?',
                      message: 'It has not been created yet. Discarding removes it from this device.',
                      confirmLabel: 'Discard',
                      destructive: true,
                    }).then((discard) => {
                      if (!discard) return;
                      if (userId) clearSplitDraft(userId, NEW_SPLIT_DRAFT_ID);
                      setStored(null);
                      haptics.success();
                    });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Capsule
                  title="Resume"
                  fill
                  onPress={() => {
                    onNotice(null);
                    useSplitEditStore.getState().restoreDraft(stored, { userId });
                  }}
                />
              </View>
            </View>
          </Label>
        ) : null}

        <Section title="Guided" note="Five questions" style={{ marginTop: stored ? space.section : 12 }}>
          <View style={{ gap: 16, marginHorizontal: space.inset }}>
            <Choice question={DAYS_QUESTION} value={String(answers.daysPerWeek)} onChange={(value) => answer('daysPerWeek', Number(value))} />
            <Choice question={FOCUS_QUESTION} value={answers.focus} onChange={(value) => answer('focus', value)} />
            <Choice
              question={EQUIPMENT_QUESTION}
              value={answers.equipment === 'dumbbell_only' ? 'dumbbell_only' : 'full_gym'}
              onChange={(value) => answer('equipment', value)}
            />
            <Choice question={SESSION_QUESTION} value={answers.sessionLength} onChange={(value) => answer('sessionLength', value)} />
            <Choice question={EXPERIENCE_QUESTION} value={answers.experience} onChange={(value) => answer('experience', value)} />
          </View>
          <Label style={{ marginTop: 18, padding: 18, gap: 14 }}>
            <View accessibilityLiveRegion="polite">
              <BlancText variant="headline">{guided.name}</BlancText>
              <BlancText variant="secondary" tone="graphite" style={{ marginTop: 2 }}>
                {plural(guided.days.length, 'day')} a week · {plural(templateExerciseCount(guided), 'exercise')}
              </BlancText>
            </View>
            <Capsule title="Start from this plan" size="large" fill busy={loading} onPress={() => void startGuided()} />
          </Label>
          {error ? <FormNote alert>{error}</FormNote> : null}
        </Section>

        <Section title="Blank">
          <View style={{ marginHorizontal: space.inset, gap: 14 }}>
            <Choice
              question={{ key: 'daysPerWeek', label: 'Training days', options: BLANK_DAY_OPTIONS }}
              value={blankDays}
              onChange={(value) => {
                haptics.select();
                setBlankDays(value);
              }}
            />
            <Capsule
              title="Start blank"
              variant="quiet"
              size="large"
              fill
              disabled={loading}
              onPress={() => {
                onNotice(null);
                useSplitEditStore.getState().startNew(blankSplitDraft(Number(blankDays)), { userId });
              }}
            />
          </View>
        </Section>
      </ScrollView>
    </>
  );
}

/** One question as iOS's segmented control. */
function Choice<K extends keyof ProgramDesignAnswers, T extends string>({
  question,
  value,
  onChange,
}: {
  question: ProgramQuestion<K, T>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={{ gap: 8 }}>
      <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: 4 }}>
        {question.label}
      </BlancText>
      <Host matchContents={{ vertical: true }}>
        <Picker selection={value} onSelectionChange={(next) => onChange(next as T)} modifiers={[pickerStyle('segmented')]}>
          {question.options.map((option) => (
            <SwiftText key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </SwiftText>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

// ── Editor ───────────────────────────────────────────────────────────

function Editor({ notice }: { notice: string | null }) {
  const c = useBlanc();
  const draft = useSplitEditStore((state) => state.draft);
  const isDirty = useSplitEditStore((state) => state.isDirty);
  const saving = useSplitEditStore((state) => state.saving);
  const error = useSplitEditStore((state) => state.error);
  const undo = useSplitEditStore((state) => state.undo);
  const restorable = useSplitEditStore((state) => state.restorable);
  const baseSignature = useSplitEditStore((state) => state.baseSignature);
  // Text fields keep their own text while typing; a restored draft refills them.
  const [formKey, setFormKey] = useState(0);
  const isNew = Boolean(draft?._isNew);
  // The Undo bar belongs to the screen on top; a day pushed over this one shows its own.
  const focused = useIsFocused();

  const save = () => {
    Keyboard.dismiss();
    void saveSplitEdit({
      createSplit: useAppStore.getState().createSplit,
      onSaved: (saved) => {
        haptics.success();
        afterProgramSaved(saved);
      },
      onClose: () => router.back(),
    }).then(() => {
      // Said out loud too: the note under the name can be scrolled out of sight.
      const failure = useSplitEditStore.getState().error;
      if (!failure) return;
      haptics.error();
      Alert.alert('Not saved', failure);
    });
  };

  const options = useMemo(
    () => ({
        title: isNew ? 'New program' : 'Edit program',
        unstable_headerLeftItems: () => [{ type: 'button', label: 'Cancel', onPress: cancel, disabled: saving }],
        unstable_headerRightItems: () => [
          {
            type: 'button',
            label: saving ? 'Saving' : isNew ? 'Create' : 'Save',
            variant: 'prominent',
            tintColor: c.ink,
            disabled: saving,
            onPress: () => {
              haptics.tap();
              save();
            },
          },
        ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNew, saving, c.ink],
  );

  if (!draft) return <Stack.Screen options={{ title: '' }} />;

  const store = useSplitEditStore.getState;
  // The row plays the tap.
  const addDay = () => {
    store().addDay(`Day ${draft.days.length + 1}`);
    const added = store().draft?.days.at(-1);
    if (added) router.push({ pathname: '/program-edit/day', params: { id: added.id } });
  };

  return (
    <>
      <Stack.Screen options={options} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.ground }}
        contentContainerStyle={{ paddingBottom: 120 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets>
        {restorable && !isDirty ? (
          <Label style={{ marginTop: 12, padding: 18, gap: 12 }}>
            <BlancText variant="body">
              Unsaved edits from {formatDistanceToNowStrict(restorable.savedAt, { addSuffix: true })} are on this device.
            </BlancText>
            {restorable.baseSignature && baseSignature && restorable.baseSignature !== baseSignature ? (
              <BlancText variant="secondary" tone="graphite">
                The program has changed since. Restoring replaces those changes when you save.
              </BlancText>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Capsule
                  title="Discard them"
                  variant="quiet"
                  fill
                  onPress={() => {
                    void confirmAlert({
                      title: 'Discard these edits?',
                      message: 'The unsaved copy on this device is removed.',
                      confirmLabel: 'Discard',
                      destructive: true,
                    }).then((discard) => {
                      if (!discard) return;
                      store().dismissRestore();
                      haptics.success();
                    });
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Capsule
                  title="Restore"
                  fill
                  onPress={() => {
                    store().restoreSaved();
                    setFormKey((key) => key + 1);
                  }}
                />
              </View>
            </View>
          </Label>
        ) : null}

        {notice ? <FormNote>{notice}</FormNote> : null}

        <Label key={formKey} style={{ marginTop: 12 }}>
          <TextField
            label="Name"
            initial={draft.name}
            placeholder="Push Pull Legs"
            maxLength={60}
            onChange={(text) => store().renameSplit(text)}
          />
          <Hairline />
          <TextField
            label="Description"
            initial={draft.description ?? ''}
            placeholder="Optional"
            maxLength={200}
            onChange={(text) => store().updateDescription(text)}
          />
        </Label>
        {error ? <FormNote alert>{error}</FormNote> : null}

        <Section title="Days" action={draft.days.length > 1 ? { title: 'Reorder', onPress: () => router.push('/program-reorder') } : undefined}>
          <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
            {draft.days.map((day, index) => (
              <Animated.View key={day.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                {index > 0 ? <Hairline /> : null}
                <DayRow day={day} index={index} total={draft.days.length} />
              </Animated.View>
            ))}
            <Animated.View layout={rowLayout}>
              {draft.days.length > 0 ? <Hairline /> : null}
              <Row title="Add day" leading={<SymbolView name="plus" size={15} weight="semibold" tintColor={c.ink} />} onPress={addDay} />
            </Animated.View>
          </Label>
        </Section>
      </ScrollView>
      <UndoBar label={focused ? (undo?.label ?? null) : null} onUndo={() => store().undoRemoval()} />
    </>
  );
}

/** A form row whose text the field keeps while typing; each change goes to the draft. */
function TextField({ label, initial, placeholder, maxLength, onChange }: {
  label: string;
  initial: string;
  placeholder: string;
  maxLength: number;
  onChange: (text: string) => void;
}) {
  const c = useBlanc();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: 52, paddingLeft: 18, paddingRight: 16, paddingVertical: 15 }}>
      <BlancText variant="body" style={{ width: 104 }}>
        {label}
      </BlancText>
      {/* Grows to fit a long name; Return finishes instead of adding a line. */}
      <TextInput
        defaultValue={initial}
        onChangeText={(text) => onChange(text.replace(/\n/g, ' '))}
        placeholder={placeholder}
        placeholderTextColor={c.upcoming}
        maxLength={maxLength}
        multiline
        scrollEnabled={false}
        submitBehavior="blurAndSubmit"
        autoCorrect={false}
        returnKeyType="done"
        selectionColor={c.ink}
        accessibilityLabel={label}
        style={[typeScale.body, { flex: 1, color: c.ink, padding: 0, paddingTop: 0 }]}
      />
    </View>
  );
}

/** A day: tap to open it; swipe to remove (Undo brings it back); hold for the menu. */
function DayRow({ day, index, total }: { day: DraftDay; index: number; total: number }) {
  const c = useBlanc();
  const label = dayLabel(day, index);
  const store = useSplitEditStore.getState;
  const open = () => router.push({ pathname: '/program-edit/day', params: { id: day.id } });
  // A draft change: the Undo bar can bring it back.
  const remove = () => {
    store().removeDay(day.id);
    haptics.success();
  };
  const rename = () =>
    Alert.prompt(
      'Day name',
      undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (text?: string) => {
            haptics.select();
            store().renameDay(day.id, (text ?? '').slice(0, 40));
          },
        },
      ],
      'plain-text',
      day.day_name,
    );
  const move = (direction: -1 | 1) => {
    haptics.select();
    store().reorderDays(day.id, direction);
  };
  const menu: MenuAction[] = [
    { title: 'Rename', symbol: 'pencil', run: rename },
    ...(total > 1
      ? [
          {
            title: '',
            inline: true,
            children: [
              ...(index > 0 ? [{ title: 'Move earlier', symbol: 'arrow.up', run: () => move(-1) }] : []),
              ...(index < total - 1 ? [{ title: 'Move later', symbol: 'arrow.down', run: () => move(1) }] : []),
            ],
          },
        ]
      : []),
    { title: 'Remove day', symbol: 'trash', destructive: true, removes: true, run: remove },
  ];

  return (
    <SwipeRow name={label} actions={[{ label: 'Remove', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row title={label} detail={daySummary(day)} chevron onPress={open} menu={menu} />
      </View>
    </SwipeRow>
  );
}
