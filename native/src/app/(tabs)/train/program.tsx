import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Alert, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAdaptiveSplitScheduling } from '@/hooks/useAdaptiveSplitScheduling';
import { saveAdaptiveSplitScheduling } from '@/lib/adaptiveSplitScheduling';
import { exerciseTotal, plural, shownActiveProgram, visibleTemplateItems } from '@/lib/programSummary';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { FlexDayTemplate, Split } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { FormNote, ToggleRow } from '~/components/Form';
import { Label } from '~/components/Label';
import { showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { announce, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { deleteProgram, editProgram, newProgram, planTarget, renameQuickStart, setActiveProgram, startQuickStart, useDeletingPrograms } from '~/lib/program';
import { space } from '~/theme/blanc';

/**
 * Program: how Train works (program days or flexible sessions), the programs
 * to choose from, or the quick starts kept from flexible sessions. Program
 * days end with Adaptive scheduling, which decides how those days move.
 */
export default function ProgramScreen() {
  const splits = useAppStore((state) => state.splits);
  const mode = useAppStore((state) => state.workoutMode);
  const live = useAppStore((state) => Boolean(state.currentWorkout && !state.currentWorkout.completed));
  const setWorkoutMode = useAppStore((state) => state.setWorkoutMode);
  const flexible = mode === 'flexible';
  const active = shownActiveProgram(splits, mode);
  // Only what the rows below do not already say: the picker names the mode,
  // the active program's row says Active, and the empty card says there is none.
  const subtitle = flexible ? 'Build each session as you go' : !active && splits.length > 0 ? 'None active' : null;
  // Only while the person's own pull runs.
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const store = useAppStore.getState();
    void Promise.all([store.fetchSplits(), store.fetchWorkoutMode(), store.fetchCurrentWorkout(), store.fetchFlexTemplates()]);
  }, []);

  const switchMode = (next: 'split' | 'flexible') => {
    if (next === mode) return;
    haptics.select();
    void setWorkoutMode(next).then((result) => {
      if (!result.ok) Alert.alert('Mode not changed', result.reason ?? 'Try again.');
      else if (next === 'flexible') void useAppStore.getState().fetchFlexTemplates();
    });
  };

  const refresh = async () => {
    setRefreshing(true);
    const store = useAppStore.getState();
    await Promise.allSettled([store.fetchSplits({ force: true }), store.fetchFlexTemplates({ force: true })]);
    setRefreshing(false);
  };

  // Built once per mode, so the header is not re-sent on every render.
  const options = useMemo(
    () => ({
        title: 'Program',
        unstable_headerRightItems: () =>
          flexible
            ? []
            : [
                {
                  type: 'button',
                  label: 'New program',
                  icon: { type: 'sfSymbol', name: 'plus' },
                  // iOS's header items are silent.
                  onPress: () => {
                    haptics.tap();
                    newProgram();
                  },
                },
              ],
      }) satisfies ComponentProps<typeof Stack.Screen>['options'],
    [flexible],
  );

  return (
    <>
      <Stack.Screen options={options} />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {subtitle ? (
          <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
            {subtitle}
          </BlancText>
        ) : null}

        {live ? null : (
          <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset, marginTop: 18 }}>
            <Picker
              selection={mode}
              onSelectionChange={(next) => switchMode(next as 'split' | 'flexible')}
              modifiers={[pickerStyle('segmented')]}>
              <SwiftText modifiers={[tag('split')]}>Program days</SwiftText>
              <SwiftText modifiers={[tag('flexible')]}>Flexible</SwiftText>
            </Picker>
          </Host>
        )}

        {flexible ? <QuickStarts /> : <Programs splits={splits} />}

        {/* During a workout the programs lead; the mode, locked for now, follows with why. */}
        {live ? (
          <>
            <Label style={{ marginTop: space.section }}>
              <Row title="Training mode" quiet value={mode === 'flexible' ? 'Flexible' : 'Program days'} accessibilityLabel={`Training mode, ${mode === 'flexible' ? 'Flexible' : 'Program days'}, locked during a workout`} />
            </Label>
            <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
              Finish the current workout to switch.
            </BlancText>
          </>
        ) : null}

        {/* Only program days are scheduled; with no program there is nothing yet to move. */}
        {flexible || splits.length === 0 ? null : <SchedulingSetting />}
      </TabScroll>
    </>
  );
}

/**
 * Adaptive scheduling: a switch saved to the account, with the reason under
 * it. Not locked during a workout: it changes the days ahead, not this one.
 */
function SchedulingSetting() {
  const enabled = useAdaptiveSplitScheduling();
  const userId = useAuthStore((state) => state.user?.id);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async (next: boolean) => {
    if (saving || !userId) return;
    setSaving(true);
    setFailed(false);
    try {
      await saveAdaptiveSplitScheduling(next);
      haptics.success();
    } catch {
      haptics.error();
      setFailed(true);
    }
    // After the try, not in a finally, which the React Compiler can't
    // compile; nothing in the catch throws.
    setSaving(false);
  };

  return (
    <Animated.View layout={rowLayout}>
      <Label style={{ marginTop: space.section }}>
        <ToggleRow list label="Adaptive scheduling" value={enabled} disabled={saving || !userId} onChange={(next) => void toggle(next)} />
      </Label>
      <FormNote alert={failed}>
        {failed
          ? 'Couldn’t save this setting. Your previous choice is still active.'
          : 'Upcoming workouts follow the program days you complete. Off uses your saved schedule.'}
      </FormNote>
    </Animated.View>
  );
}

function Programs({ splits }: { splits: Split[] }) {
  // A program being deleted folds away once Delete is chosen, here or on its
  // own screen, and comes back if the delete fails.
  const deleting = useDeletingPrograms((state) => state.ids);
  const shown = splits.filter((split) => !deleting.has(split.id));

  if (shown.length === 0) {
    return (
      <Label style={{ marginTop: space.section, padding: 18, paddingRight: 16, gap: 14 }}>
        <View style={{ gap: 2 }}>
          <BlancText variant="headline">Build your first program</BlancText>
          <BlancText variant="secondary" tone="graphite">
            Answer five questions, or start blank.
          </BlancText>
        </View>
        <Capsule title="Create program" size="large" fill onPress={newProgram} />
      </Label>
    );
  }

  const remove = (split: Split) =>
    void deleteProgram(split).then((deleted) => {
      if (deleted) announce(`${split.name} deleted`);
    });
  // The row's "Active" changes by sight only; VoiceOver stays on the row. The
  // plan-start alert already says it is active, so only without that alert.
  const activate = (split: Split) =>
    setActiveProgram(split).then((prompted) => {
      if (!prompted && useAppStore.getState().splits.some((entry) => entry.id === split.id && entry.is_active)) announce(`${split.name} is active`);
    });

  const menu = (split: Split): MenuAction[] => [
    ...(split.is_active ? [] : [{ title: 'Set active', symbol: 'checkmark.circle', run: () => void activate(split) }]),
    { title: 'Edit', symbol: 'pencil', run: () => editProgram(split) },
    { title: 'Delete', symbol: 'trash', destructive: true, run: () => remove(split) },
  ];

  return (
    // The page is titled Program; the list needs no heading of its own.
    <View style={{ marginTop: 24 }}>
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {shown.map((split, index) => (
          <Animated.View key={split.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            <SwipeRow
              name={split.name}
              actions={[
                { label: 'Edit', onPress: () => editProgram(split) },
                { label: 'Delete', destructive: true, onPress: () => remove(split) },
              ]}>
              <View>
                <Row
                  title={split.name}
                  detail={[split.is_active ? 'Active' : null, plural(split.days.length, 'day'), plural(exerciseTotal(split), 'exercise')]
                    .filter(Boolean)
                    .join(' · ')}
                  chevron
                  onPress={() => router.push({ pathname: '/train/program-view', params: { id: split.id } })}
                  menu={menu(split)}
                />
              </View>
            </SwipeRow>
          </Animated.View>
        ))}
      </Label>
    </View>
  );
}

function QuickStarts() {
  const large = useLargeText();
  const templates = useAppStore((state) => state.flexTemplates);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState<string | null>(null);
  const shown = templates.filter((template) => !leaving.has(template.id));

  if (shown.length === 0) {
    return (
      <Label style={{ marginTop: space.section, padding: 18, paddingRight: 16, gap: 2 }}>
        <BlancText variant="headline">No quick starts yet</BlancText>
        <BlancText variant="secondary" tone="graphite">
          Finish a flexible session and keep it as a quick start.
        </BlancText>
      </Label>
    );
  }

  const start = async (template: FlexDayTemplate) => {
    if (starting) return;
    setStarting(template.id);
    await startQuickStart(template);
    setStarting(null);
  };

  // A full swipe deletes with no question, as saved meals do; the row folds
  // away and comes back if the delete did not take.
  const remove = (template: FlexDayTemplate) => {
    setLeaving((current) => new Set(current).add(template.id));
    void useAppStore
      .getState()
      .deleteFlexTemplate(template.id)
      .then(() => {
        const still = useAppStore.getState().flexTemplates.some((entry) => entry.id === template.id);
        if (still) {
          haptics.error();
          Alert.alert('Not deleted', 'Check your connection and try again.');
        } else {
          haptics.success();
          announce(`${template.label} deleted`);
        }
        setLeaving((current) => {
          const next = new Set(current);
          next.delete(template.id);
          return next;
        });
      });
  };

  const menu = (template: FlexDayTemplate): MenuAction[] => [
    { title: 'Start', symbol: 'play', run: () => void start(template) },
    { title: 'Rename', symbol: 'pencil', run: () => renameQuickStart(template) },
    { title: 'Delete', symbol: 'trash', destructive: true, removes: true, run: () => remove(template) },
  ];
  // A tap shows what the quick start holds, with the same choices.
  const details = (template: FlexDayTemplate) =>
    showActionSheet(
      template.label,
      menu(template),
      visibleTemplateItems(template)
        .map((item) => [item.exercise_name || 'Exercise', planTarget(item)].filter(Boolean).join(' · '))
        .join('\n') || undefined,
    );

  return (
    <Section title="Quick starts">
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {shown.map((template, index) => {
          const items = visibleTemplateItems(template);
          const startButton = (
            <Capsule
              title="Start"
              variant="quiet"
              tone="effort"
              busy={starting === template.id}
              disabled={starting !== null}
              accessibilityLabel={`Start ${template.label}`}
              onPress={() => void start(template)}
            />
          );
          return (
            <Animated.View key={template.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline /> : null}
              <SwipeRow
                name={template.label}
                actions={[
                  { label: 'Rename', onPress: () => renameQuickStart(template) },
                  { label: 'Delete', destructive: true, onPress: () => remove(template) },
                ]}>
                <View>
                  <Row
                    title={template.label}
                    detail={items.map((item) => item.exercise_name || 'Exercise').join(' · ') || 'No movements'}
                    trailing={large ? undefined : startButton}
                    onPress={() => details(template)}
                    menu={menu(template)}
                  />
                  {/* At the accessibility text sizes the button would squeeze the words: it goes under them. */}
                  {large ? <View style={{ paddingLeft: 18, paddingRight: 16, paddingBottom: 12 }}>{startButton}</View> : null}
                </View>
              </SwipeRow>
            </Animated.View>
          );
        })}
      </Label>
    </Section>
  );
}
