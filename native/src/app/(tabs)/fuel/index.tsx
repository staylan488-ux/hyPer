import { addWeeks, format, isAfter, isSameDay, startOfDay } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { getLogDate } from '@/components/nutrition/nutritionLogUtils';
import { fuelDaySummary, fuelDayTitle, warnsOverTarget, type FuelMacro } from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { decodeMealComposition } from '@/lib/mealComposition';
import { weekDays } from '@/lib/nutritionCalendar';
import { canReorderNutritionGroup, offersMoveToPreviousDay } from '@/lib/nutritionDay';
import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { servingLabel, sortLedgerEntries } from '@/lib/nutritionLedger';
import { logMacro, sumMacros } from '@/lib/nutritionMacros';
import { alreadyOnDay } from '@/lib/repeatEntries';
import { useAppStore } from '@/stores/appStore';
import type { NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { formatWhole } from '~/lib/format';
import { dayKey, logsForDay, today, useFuelDay, useFuelStore, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { space, useBlanc } from '~/theme/blanc';

const logFood = (day: string, group?: string) => router.push({ pathname: '/log-food', params: group ? { day, group } : { day } });

const CHECK_CONNECTION = 'Check your connection and try again.';

/**
 * A Fuel write's result: a success tick, or an error buzz and an alert, so a
 * failed delete or move is never silent.
 */
function report(write: Promise<boolean>, failure: string) {
  void write
    .catch(() => false)
    .then((ok) => {
      if (ok) {
        haptics.success();
        return;
      }
      haptics.error();
      Alert.alert(failure, CHECK_CONNECTION);
    });
}

/**
 * A past day's meal (or one entry) logged again today: the same foods and
 * amounts at the same times, in today's matching meal; Fuel then shows today.
 * When today already has all of them, it asks before doubling the meal.
 */
function copyToToday(logs: FoodLog[], group: NutritionGroup | null) {
  const copy = () => report(useFuelStore.getState().copyToToday(logs, group), 'Not copied');
  const todayLogs = logsForDay(today());
  if (todayLogs && alreadyOnDay(logs, todayLogs)) {
    Alert.alert('Copy again?', logs.length === 1 ? 'Today already has this food.' : 'Today already has these foods.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy', onPress: copy },
    ]);
    return;
  }
  copy();
}

/** Opens the targets with that number's field ready to type, as You's Targets does. */
const editTarget = (focus: 'calories' | 'protein' | 'carbs' | 'fat') => {
  haptics.tap();
  router.push({ pathname: '/targets-edit', params: { focus } });
};

export default function FuelScreen() {
  const target = useAppStore((state) => state.macroTarget);
  // Bulking, going past a target is a good day, not a red one.
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const { selected, logs, groups, loaded, status } = useFuelDay();
  const monthLogs = useFuelStore((state) => state.logs);
  const selectedDate = new Date(`${selected}T12:00:00`);
  const live = selected === dayKey(new Date());
  const totals = sumMacros(logs);
  const summary = fuelDaySummary({ totals, target, live, selectedDate, goal });
  const daysWithLogs = useMemo(() => new Set(monthLogs.map((log) => log.date)), [monthLogs]);
  const lateNight = live && offersMoveToPreviousDay(logs);

  // The day's groups in order, Unassigned first when it has entries. Empty
  // named meals stay out of the way; a meal or snack added by hand stays.
  const groupIds = new Set(groups.map((group) => group.id));
  const unassigned = sortLedgerEntries(logs.filter((log) => !log.group_id || !groupIds.has(log.group_id)));
  const sections = groups
    .map((group) => ({ group, logs: sortLedgerEntries(logs.filter((log) => log.group_id === group.id)) }))
    .filter((section) => section.logs.length > 0 || !section.group.label);

  // Pull down: the shown day's month and the targets, fresh.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([useFuelStore.getState().refresh(), useAppStore.getState().fetchMacroTarget().catch(() => {})]);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Fuel',
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Calendar',
              icon: { type: 'sfSymbol', name: 'calendar' },
              onPress: () => {
                haptics.tap();
                router.push('/fuel-month');
              },
            },
            {
              type: 'button',
              label: 'Log food',
              icon: { type: 'sfSymbol', name: 'plus' },
              onPress: () => {
                haptics.tap();
                logFood(useFuelStore.getState().selected);
              },
            },
          ],
        }}
      />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {fuelDayTitle(selectedDate)}
        </BlancText>

        <WeekStrip selected={selectedDate} daysWithLogs={daysWithLogs} />

        {/* The day's figure and the macros open the targets, the numbers they measure against. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={loaded ? `${formatWhole(totals.calories)} of ${formatWhole(summary.targets.calories)} kcal` : `Target ${formatWhole(summary.targets.calories)} kcal`}
          accessibilityHint="Edits your calorie target"
          onPress={() => editTarget('calories')}
          style={({ pressed }) => ({ paddingHorizontal: space.gutter, marginTop: 18, opacity: pressed ? 0.55 : 1 })}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <BlancText variant="figure" size={88} style={{ letterSpacing: -2.5 }}>
              {/* never a 0 that only means "not loaded yet" */}
              {loaded ? formatWhole(totals.calories) : '–'}
            </BlancText>
            <BlancText variant="secondary" tone="graphite">
              of {formatWhole(summary.targets.calories)} kcal
            </BlancText>
          </View>
          <View style={{ marginTop: 10 }}>
            <Track progress={totals.calories / summary.targets.calories} warnOver={warnsOverTarget('calories', goal)} />
          </View>
          {live && loaded ? (
            <BlancText variant="secondary" tone={summary.kcalOverWarns ? 'live' : 'graphite'} style={{ marginTop: 10 }}>
              {summary.logLine}
            </BlancText>
          ) : null}
        </Pressable>

        <Section title="Macros">
          <Label style={{ overflow: 'hidden' }}>
            <MacroRow macro="protein" value={totals.protein} target={summary.targets.protein} goal={goal} />
            <Hairline />
            <MacroRow macro="carbs" value={totals.carbs} target={summary.targets.carbs} goal={goal} />
            <Hairline />
            <MacroRow macro="fat" value={totals.fat} target={summary.targets.fat} goal={goal} />
          </Label>
        </Section>

        {/* One day's list: rows and meals fold away and close up when removed.
            Moving to another day swaps the whole list without that motion. */}
        <LayoutAnimationConfig key={selected} skipEntering skipExiting>
          <View>
            {unassigned.length > 0 ? (
              <Animated.View key="unassigned" entering={rowEnter} exiting={blockExit} layout={rowLayout}>
                <MealSection title="Unassigned" logs={unassigned} groups={groups} lateNight={lateNight} day={selected} />
              </Animated.View>
            ) : null}
            {sections.map(({ group, logs: entries }) => (
              <Animated.View key={group.id} entering={rowEnter} exiting={blockExit} layout={rowLayout}>
                <MealSection title={nutritionGroupLabel(group, groups)} group={group} logs={entries} groups={groups} lateNight={lateNight} day={selected} />
              </Animated.View>
            ))}

            {loaded && logs.length === 0 ? (
              <Animated.View entering={rowEnter} exiting={blockExit} layout={rowLayout} style={{ marginTop: 36, alignItems: 'center', gap: 6, paddingHorizontal: space.gutter }}>
                <BlancText variant="bodyStrong">Nothing logged yet</BlancText>
                <BlancText variant="secondary" tone="graphite">
                  {live ? 'Your first entry sets the tone for the day.' : `No entries on ${format(selectedDate, 'MMM d')}.`}
                </BlancText>
                <Capsule title="Log food" onPress={() => logFood(selected)} style={{ marginTop: 12, alignSelf: 'center' }} />
              </Animated.View>
            ) : null}

            {loaded ? (
              <Animated.View layout={rowLayout} style={{ alignItems: 'center', marginTop: 28 }}>
                <Capsule title="Add meal or snack" variant="quiet" onPress={() => addMealOrSnack()} style={{ alignSelf: 'center' }} />
              </Animated.View>
            ) : null}
          </View>
        </LayoutAnimationConfig>

        {status === 'error' && !loaded ? (
          <BlancText variant="secondary" tone="live" style={{ margin: space.gutter }}>
            This day's food could not load. Pull down to try again.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}

function addMealOrSnack() {
  ActionSheetIOS.showActionSheetWithOptions({ title: 'Add a meal or snack', options: ['Meal', 'Snack', 'Cancel'], cancelButtonIndex: 2 }, (index) => {
    if (index === 2) return;
    report(useFuelStore.getState().addGroup(index === 0 ? 'meal' : 'snack'), 'Not added');
  });
}

/** Sunday-first week; swipe for the week before or after. Future days are not selectable. */
function WeekStrip({ selected, daysWithLogs }: { selected: Date; daysWithLogs: Set<string> }) {
  const c = useBlanc();
  const days = weekDays(selected);
  const now = startOfDay(new Date());
  const go = (weeks: number) => {
    const target = addWeeks(selected, weeks);
    const next = isAfter(startOfDay(target), now) ? now : target;
    if (isSameDay(next, selected)) return;
    haptics.select();
    useFuelStore.getState().select(dayKey(next));
  };
  const swipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -50) go(1);
      else if (event.translationX > 50) go(-1);
    });

  return (
    <GestureDetector gesture={swipe}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Week of ${format(days[0], 'MMMM d')}`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => go(event.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 16 }}>
        {days.map((day) => {
          const key = dayKey(day);
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, now);
          const future = isAfter(startOfDay(day), now);
          return (
            <Pressable
              key={key}
              disabled={future}
              accessibilityRole="button"
              accessibilityLabel={format(day, 'EEEE, MMMM d')}
              accessibilityState={{ selected: isSelected, disabled: future }}
              onPress={() => {
                haptics.select();
                useFuelStore.getState().select(key);
              }}
              style={({ pressed }) => ({ width: 46, alignItems: 'center', gap: 6, paddingVertical: 4, opacity: future ? 0.35 : pressed ? 0.5 : 1 })}>
              <BlancText variant="footnote" tone="graphite">
                {format(day, 'EEEEE')}
              </BlancText>
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isSelected ? c.capsule : 'transparent',
                }}>
                <BlancText variant="body" weight={isToday || isSelected ? '600' : '400'} tone={isSelected ? 'onCapsule' : 'ink'} style={{ fontVariant: ['tabular-nums'] }}>
                  {format(day, 'd')}
                </BlancText>
              </View>
              <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: daysWithLogs.has(key) ? c.graphite : 'transparent' }} />
            </Pressable>
          );
        })}
      </View>
    </GestureDetector>
  );
}

function MealSection({ title, group, logs, groups, lateNight, day }: {
  title: string;
  group?: NutritionGroup;
  logs: FoodLog[];
  groups: NutritionGroup[];
  lateNight: boolean;
  day: string;
}) {
  const c = useBlanc();
  const kcal = logs.reduce((sum, log) => sum + (logMacro(log, 'calories') ?? 0), 0);
  // A past day's meal can be logged again today (Unassigned too).
  const copyable = day !== today() && logs.some((log) => log.food);

  const groupMenu = () => {
    const copy = { label: 'Copy to today', run: () => copyToToday(logs, group ?? null) };
    if (!group) {
      if (!copyable) return;
      ActionSheetIOS.showActionSheetWithOptions({ title, options: [copy.label, 'Cancel'], cancelButtonIndex: 1 }, (index) => {
        if (index === 0) copy.run();
      });
      return;
    }
    const store = useFuelStore.getState();
    const actions: { label: string; run: () => void; destructive?: boolean }[] = [
      ...(copyable ? [copy] : []),
      { label: 'Log food here', run: () => logFood(day, group.id) },
    ];
    if (canReorderNutritionGroup(groups, group.id, -1)) actions.push({ label: 'Move up', run: () => report(store.reorderGroup(group.id, -1), 'Not moved') });
    if (canReorderNutritionGroup(groups, group.id, 1)) actions.push({ label: 'Move down', run: () => report(store.reorderGroup(group.id, 1), 'Not moved') });
    if (!group.label) {
      actions.push({
        label: `Delete ${title}`,
        destructive: true,
        run: () => report(store.deleteGroup(group), 'Not deleted'),
      });
    }
    const options = [...actions.map((action) => action.label), 'Cancel'];
    const destructive = actions.findIndex((action) => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message: !group.label ? 'Deleting it moves its foods to Unassigned.' : undefined,
        options,
        cancelButtonIndex: actions.length,
        destructiveButtonIndex: destructive >= 0 ? destructive : undefined,
      },
      (index) => {
        if (index < actions.length) actions[index].run();
      },
    );
  };

  return (
    <Section
      title={title}
      note={logs.length > 0 ? `${formatWhole(kcal)} kcal` : undefined}
      accessory={
        group || copyable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} options`}
            hitSlop={6}
            onPress={() => {
              haptics.tap();
              groupMenu();
            }}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
            <SymbolView name="ellipsis" size={17} weight="semibold" tintColor={c.ink} />
          </Pressable>
        ) : undefined
      }>
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {logs.map((log, index) => (
          <Animated.View key={log.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            <EntryRow log={log} groups={groups} lateNight={lateNight} />
          </Animated.View>
        ))}
        {logs.length === 0 && group ? (
          <Animated.View entering={rowEnter} layout={rowLayout}>
            <Row title="Nothing here yet" quiet onPress={() => logFood(day, group.id)} />
          </Animated.View>
        ) : null}
      </Label>
    </Section>
  );
}

function entryDetail(log: FoodLog): string {
  const parts = decodeMealComposition(log.food?.description);
  const time = format(getLogDate(log), 'h:mm a');
  const amount = parts ? `${parts.ingredients.length} ingredient${parts.ingredients.length === 1 ? '' : 's'}` : servingLabel(log);
  const protein = logMacro(log, 'protein');
  // As the web's ledger does, an AI estimate says so (one word, so the line stays quiet).
  const raw = log.source as string | undefined;
  const source = raw === 'gemini_estimate' || raw === 'gemini_trial' ? 'Estimate' : raw === 'gemini_label' ? 'From label' : null;
  return [time, amount, protein ? `${formatWhole(protein)} g protein` : null, source].filter(Boolean).join(' · ');
}

/** One entry: tap to edit; swipe for More and Delete (all the way deletes); hold for the menu. */
function EntryRow({ log, groups, lateNight }: { log: FoodLog; groups: NutritionGroup[]; lateNight: boolean }) {
  const c = useBlanc();
  const name = log.food?.name ?? 'Food';
  const edit = () => router.push({ pathname: '/log-food', params: { entry: log.id } });
  // The row slides away at once; it comes back if the delete fails.
  const remove = () => report(useFuelStore.getState().deleteEntry(log.id), 'Not deleted');

  const moveMenu = () => {
    const targets: { id: string | null; label: string }[] = [
      { id: null, label: 'Unassigned' },
      ...groups.map((group) => ({ id: group.id, label: nutritionGroupLabel(group, groups) })),
    ].filter((targetGroup) => targetGroup.id !== (log.group_id ?? null));
    const options = [...targets.map((targetGroup) => targetGroup.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Move ${name}`, options, cancelButtonIndex: targets.length }, (index) => {
      if (index >= targets.length) return;
      report(useFuelStore.getState().moveEntry(log.id, targets[index].id), 'Not moved');
    });
  };

  const menu = () => {
    const store = useFuelStore.getState();
    const actions: { label: string; run: () => void }[] = [{ label: 'Edit', run: edit }, { label: 'Move to…', run: moveMenu }];
    if (lateNight) actions.push({ label: 'Move to yesterday', run: () => report(store.moveEntryToYesterday(log.id), 'Not moved') });
    if (log.date !== today() && log.food) actions.push({ label: 'Copy to today', run: () => copyToToday([log], groups.find((group) => group.id === log.group_id) ?? null) });
    actions.push({ label: 'Delete', run: remove });
    const options = [...actions.map((action) => action.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: name, options, cancelButtonIndex: actions.length, destructiveButtonIndex: actions.length - 1 }, (index) => {
      if (index < actions.length) actions[index].run();
    });
  };

  const detail = entryDetail(log);
  const kcal = formatWhole(logMacro(log, 'calories') ?? 0);
  return (
    <SwipeRow
      name={name}
      actions={[
        { label: 'More', onPress: menu },
        { label: 'Delete', destructive: true, onPress: remove },
      ]}>
      <View style={{ backgroundColor: c.label }}>
        <Row
          title={name}
          detail={detail}
          value={kcal}
          onPress={edit}
          onLongPress={{ label: 'More actions', run: menu }}
          accessibilityLabel={`${name}, ${detail}, ${kcal} kcal`}
        />
      </View>
    </SwipeRow>
  );
}

const MACRO_NAMES: Record<Exclude<FuelMacro, 'calories'>, string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

/**
 * One macro against its target; a tap opens that target to change. Its line
 * turns red past target only where that is a warning for the goal: never for
 * protein, never while gaining.
 */
function MacroRow({ macro, value, target, goal }: { macro: Exclude<FuelMacro, 'calories'>; value: number; target: number; goal: NutritionGoal | undefined }) {
  const c = useBlanc();
  const name = MACRO_NAMES[macro];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${formatWhole(value)} of ${formatWhole(target)} g`}
      accessibilityHint={`Edits your ${name.toLowerCase()} target`}
      onPress={() => editTarget(macro)}
      style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: 14, gap: 9, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <BlancText variant="body">{name}</BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {formatWhole(value)}
          </BlancText>{' '}
          / {formatWhole(target)} g
        </BlancText>
      </View>
      <Track progress={target > 0 ? value / target : 0} warnOver={warnsOverTarget(macro, goal)} />
    </Pressable>
  );
}
