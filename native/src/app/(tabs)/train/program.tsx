import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Alert, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { exerciseTotal, plural, shownActiveProgram, templateItemLabel, visibleTemplateItems } from '@/lib/programSummary';
import { useAppStore } from '@/stores/appStore';
import type { FlexDayTemplate, Split } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { deleteProgram, editProgram, newProgram, renameQuickStart, setActiveProgram, startQuickStart, useDeletingPrograms } from '~/lib/program';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Program: how Train works (program days or flexible sessions), the programs
 * to choose from, or the quick starts kept from flexible sessions.
 */
export default function ProgramScreen() {
  const splits = useAppStore((state) => state.splits);
  const mode = useAppStore((state) => state.workoutMode);
  const live = useAppStore((state) => Boolean(state.currentWorkout && !state.currentWorkout.completed));
  const setWorkoutMode = useAppStore((state) => state.setWorkoutMode);
  const flexible = mode === 'flexible';
  const active = shownActiveProgram(splits, mode);
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
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {flexible ? 'Flexible · build each session as you go' : active ? `${active.name} · active` : splits.length > 0 ? 'None active' : 'No program yet'}
        </BlancText>

        <Host matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset, marginTop: 18, opacity: live ? 0.5 : 1 }} pointerEvents={live ? 'none' : 'auto'}>
          <Picker selection={mode} onSelectionChange={(next) => switchMode(next as 'split' | 'flexible')} modifiers={[pickerStyle('segmented')]}>
            <SwiftText modifiers={[tag('split')]}>Program days</SwiftText>
            <SwiftText modifiers={[tag('flexible')]}>Flexible</SwiftText>
          </Picker>
        </Host>
        {live ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 8 }}>
            Finish the current workout to switch.
          </BlancText>
        ) : null}

        {flexible ? <QuickStarts /> : <Programs splits={splits} />}
      </TabScroll>
    </>
  );
}

function Programs({ splits }: { splits: Split[] }) {
  const c = useBlanc();
  // A program being deleted folds away once Delete is chosen, here or on its
  // own screen, and comes back if the delete fails.
  const deleting = useDeletingPrograms((state) => state.ids);
  const shown = splits.filter((split) => !deleting.has(split.id));

  if (shown.length === 0) {
    return (
      <Label style={{ marginTop: space.section, padding: 18, gap: 14 }}>
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

  const remove = (split: Split) => void deleteProgram(split);

  const menu = (split: Split): MenuAction[] => [
    ...(split.is_active ? [] : [{ title: 'Set active', symbol: 'checkmark.circle', run: () => void setActiveProgram(split) }]),
    { title: 'Edit', symbol: 'pencil', run: () => editProgram(split) },
    { title: 'Delete', symbol: 'trash', destructive: true, run: () => remove(split) },
  ];

  return (
    <Section title="Programs">
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
              <View style={{ backgroundColor: c.label }}>
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
    </Section>
  );
}

function QuickStarts() {
  const c = useBlanc();
  const templates = useAppStore((state) => state.flexTemplates);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [starting, setStarting] = useState<string | null>(null);
  const shown = templates.filter((template) => !leaving.has(template.id));

  if (shown.length === 0) {
    return (
      <Label style={{ marginTop: space.section, padding: 18, gap: 2 }}>
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
        } else haptics.success();
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
        .map((item) => `${item.exercise_name || 'Exercise'}  ${templateItemLabel(item)}`)
        .join('\n') || undefined,
    );

  return (
    <Section title="Quick starts">
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {shown.map((template, index) => {
          const items = visibleTemplateItems(template);
          return (
            <Animated.View key={template.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline /> : null}
              <SwipeRow
                name={template.label}
                actions={[
                  { label: 'Rename', onPress: () => renameQuickStart(template) },
                  { label: 'Delete', destructive: true, onPress: () => remove(template) },
                ]}>
                <View style={{ backgroundColor: c.label }}>
                  <Row
                    title={template.label}
                    detail={items.map((item) => item.exercise_name || 'Exercise').join(' · ') || 'No movements'}
                    trailing={
                      <Capsule
                        title="Start"
                        variant="quiet"
                        busy={starting === template.id}
                        disabled={starting !== null}
                        accessibilityLabel={`Start ${template.label}`}
                        onPress={() => void start(template)}
                      />
                    }
                    onPress={() => details(template)}
                    menu={menu(template)}
                  />
                </View>
              </SwipeRow>
            </Animated.View>
          );
        })}
      </Label>
    </Section>
  );
}
