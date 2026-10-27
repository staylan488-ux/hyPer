import { addWeeks, format, isAfter, isSameDay, startOfDay } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useRef } from 'react';
import { ActionSheetIOS, Pressable, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';

import { getLogDate } from '@/components/nutrition/nutritionLogUtils';
import { fuelDaySummary, fuelDayTitle } from '@/lib/fuelSummary';
import { decodeMealComposition } from '@/lib/mealComposition';
import { weekDays } from '@/lib/nutritionCalendar';
import { canReorderNutritionGroup, offersMoveToPreviousDay } from '@/lib/nutritionDay';
import { nutritionGroupLabel } from '@/lib/nutritionGroups';
import { servingLabel, sortLedgerEntries } from '@/lib/nutritionLedger';
import { logMacro, sumMacros } from '@/lib/nutritionMacros';
import { useAppStore } from '@/stores/appStore';
import type { NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { Track } from '~/components/Track';
import { formatWhole } from '~/lib/format';
import { dayKey, useFuelDay, useFuelStore, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

const logFood = (day: string, group?: string) => router.push({ pathname: '/log-food', params: group ? { day, group } : { day } });

export default function FuelScreen() {
  const target = useAppStore((state) => state.macroTarget);
  const { selected, logs, groups, loaded, status } = useFuelDay();
  const monthLogs = useFuelStore((state) => state.logs);
  const selectedDate = new Date(`${selected}T12:00:00`);
  const live = selected === dayKey(new Date());
  const totals = sumMacros(logs);
  const summary = fuelDaySummary({ totals, target, live, selectedDate });
  const daysWithLogs = useMemo(() => new Set(monthLogs.map((log) => log.date)), [monthLogs]);
  const lateNight = live && offersMoveToPreviousDay(logs);

  // The day's groups in order, Unassigned first when it has entries. Empty
  // named meals stay out of the way; a meal or snack added by hand stays.
  const groupIds = new Set(groups.map((group) => group.id));
  const unassigned = sortLedgerEntries(logs.filter((log) => !log.group_id || !groupIds.has(log.group_id)));
  const sections = groups
    .map((group) => ({ group, logs: sortLedgerEntries(logs.filter((log) => log.group_id === group.id)) }))
    .filter((section) => section.logs.length > 0 || !section.group.label);

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
      <TabScroll>
        <BlancText variant="secondary" tone="graphite" style={{ marginHorizontal: space.gutter, marginTop: 2 }}>
          {fuelDayTitle(selectedDate)}
        </BlancText>

        <WeekStrip selected={selectedDate} daysWithLogs={daysWithLogs} />

        <View style={{ paddingHorizontal: space.gutter, marginTop: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            <BlancText variant="figure" size={88} style={{ letterSpacing: -2.5 }}>
              {formatWhole(totals.calories)}
            </BlancText>
            <BlancText variant="secondary" tone="graphite">
              of {formatWhole(summary.targets.calories)} kcal
            </BlancText>
          </View>
          <View style={{ marginTop: 10 }}>
            <Track progress={totals.calories / summary.targets.calories} />
          </View>
          {live && loaded ? (
            <BlancText variant="secondary" tone={summary.kcalOver > 0 ? 'live' : 'graphite'} style={{ marginTop: 10 }}>
              {summary.logLine}
            </BlancText>
          ) : null}
        </View>

        <Section title="Macros">
          <Label>
            <MacroRow name="Protein" value={totals.protein} goal={summary.targets.protein} />
            <Hairline />
            <MacroRow name="Carbs" value={totals.carbs} goal={summary.targets.carbs} />
            <Hairline />
            <MacroRow name="Fat" value={totals.fat} goal={summary.targets.fat} />
          </Label>
        </Section>

        {unassigned.length > 0 ? (
          <MealSection title="Unassigned" logs={unassigned} groups={groups} lateNight={lateNight} day={selected} />
        ) : null}
        {sections.map(({ group, logs: entries }) => (
          <MealSection key={group.id} title={nutritionGroupLabel(group, groups)} group={group} logs={entries} groups={groups} lateNight={lateNight} day={selected} />
        ))}

        {loaded && logs.length === 0 ? (
          <View style={{ marginTop: 36, alignItems: 'center', gap: 6, paddingHorizontal: space.gutter }}>
            <BlancText variant="bodyStrong">Nothing logged yet</BlancText>
            <BlancText variant="secondary" tone="graphite">
              {live ? 'Your first entry sets the tone for the day.' : `No entries on ${format(selectedDate, 'MMM d')}.`}
            </BlancText>
            <Capsule title="Log food" onPress={() => logFood(selected)} style={{ marginTop: 12, alignSelf: 'center' }} />
          </View>
        ) : null}

        {loaded ? (
          <View style={{ alignItems: 'center', marginTop: 28 }}>
            <Capsule title="Add meal or snack" variant="quiet" onPress={() => addMealOrSnack()} style={{ alignSelf: 'center' }} />
          </View>
        ) : null}

        {status === 'error' && !loaded ? (
          <BlancText variant="secondary" tone="live" style={{ margin: space.gutter }}>
            This day's food could not load. Check your connection and try again.
          </BlancText>
        ) : null}
      </TabScroll>
    </>
  );
}

function addMealOrSnack() {
  ActionSheetIOS.showActionSheetWithOptions({ title: 'Add a meal or snack', options: ['Meal', 'Snack', 'Cancel'], cancelButtonIndex: 2 }, (index) => {
    if (index === 2) return;
    haptics.select();
    void useFuelStore
      .getState()
      .addGroup(index === 0 ? 'meal' : 'snack')
      .then((ok) => (ok ? haptics.success() : haptics.error()));
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
              style={{ width: 46, alignItems: 'center', gap: 6, paddingVertical: 4, opacity: future ? 0.35 : 1 }}>
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

  const groupMenu = () => {
    if (!group) return;
    const store = useFuelStore.getState();
    const actions: { label: string; run: () => void; destructive?: boolean }[] = [{ label: 'Log food here', run: () => logFood(day, group.id) }];
    if (canReorderNutritionGroup(groups, group.id, -1)) actions.push({ label: 'Move up', run: () => void store.reorderGroup(group.id, -1) });
    if (canReorderNutritionGroup(groups, group.id, 1)) actions.push({ label: 'Move down', run: () => void store.reorderGroup(group.id, 1) });
    if (!group.label) {
      actions.push({
        label: `Delete ${title}`,
        destructive: true,
        run: () => void store.deleteGroup(group).then((ok) => (ok ? haptics.success() : haptics.error())),
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
        group ? (
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
      <Label style={{ overflow: 'hidden' }}>
        {logs.map((log, index) => (
          <View key={log.id}>
            {index > 0 ? <Hairline /> : null}
            <EntryRow log={log} groups={groups} lateNight={lateNight} />
          </View>
        ))}
        {logs.length === 0 && group ? <Row title="Nothing here yet" quiet onPress={() => logFood(day, group.id)} /> : null}
      </Label>
    </Section>
  );
}

function entryDetail(log: FoodLog): string {
  const parts = decodeMealComposition(log.food?.description);
  const time = format(getLogDate(log), 'h:mm a');
  const amount = parts ? `${parts.ingredients.length} ingredient${parts.ingredients.length === 1 ? '' : 's'}` : servingLabel(log);
  const protein = logMacro(log, 'protein');
  return [time, amount, protein ? `${formatWhole(protein)} g protein` : null].filter(Boolean).join(' · ');
}

/** One entry: tap to edit; swipe for Delete and More; hold for the same menu. */
function EntryRow({ log, groups, lateNight }: { log: FoodLog; groups: NutritionGroup[]; lateNight: boolean }) {
  const c = useBlanc();
  const swipeable = useRef<SwipeableMethods>(null);
  const name = log.food?.name ?? 'Food';
  const edit = () => router.push({ pathname: '/log-food', params: { entry: log.id } });
  const remove = () => {
    swipeable.current?.close();
    void useFuelStore
      .getState()
      .deleteEntry(log.id)
      .then((ok) => (ok ? haptics.success() : haptics.error()));
  };

  const menu = () => {
    swipeable.current?.close();
    const store = useFuelStore.getState();
    const actions: { label: string; run: () => void }[] = [{ label: 'Edit', run: edit }, { label: 'Move to…', run: () => moveMenu() }];
    if (lateNight) actions.push({ label: 'Move to yesterday', run: () => void store.moveEntryToYesterday(log.id).then((ok) => (ok ? haptics.success() : haptics.error())) });
    actions.push({ label: 'Delete', run: remove });
    const options = [...actions.map((action) => action.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: name, options, cancelButtonIndex: actions.length, destructiveButtonIndex: actions.length - 1 }, (index) => {
      if (index < actions.length) actions[index].run();
    });
  };

  const moveMenu = () => {
    const targets: { id: string | null; label: string }[] = [
      { id: null, label: 'Unassigned' },
      ...groups.map((group) => ({ id: group.id, label: nutritionGroupLabel(group, groups) })),
    ].filter((targetGroup) => targetGroup.id !== (log.group_id ?? null));
    const options = [...targets.map((targetGroup) => targetGroup.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title: `Move ${name}`, options, cancelButtonIndex: targets.length }, (index) => {
      if (index >= targets.length) return;
      haptics.select();
      void useFuelStore
        .getState()
        .moveEntry(log.id, targets[index].id)
        .then((ok) => (ok ? undefined : haptics.error()));
    });
  };

  const action = (label: string, color: string, tint: string, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${name}`}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={{ width: 84, alignItems: 'center', justifyContent: 'center', backgroundColor: color }}>
      <BlancText variant="footnote" weight="600" style={{ color: tint }}>
        {label}
      </BlancText>
    </Pressable>
  );

  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.6}
      rightThreshold={44}
      overshootRight={false}
      renderRightActions={() => (
        <View style={{ flexDirection: 'row' }}>
          {action('More', c.fill, c.ink, menu)}
          {action('Delete', c.live, '#FFFFFF', remove)}
        </View>
      )}>
      <View style={{ backgroundColor: c.label }}>
        <Row
          title={name}
          detail={entryDetail(log)}
          value={formatWhole(logMacro(log, 'calories') ?? 0)}
          onPress={edit}
          onLongPress={{ label: 'More actions', run: menu }}
          accessibilityLabel={`${name}, ${entryDetail(log)}, ${formatWhole(logMacro(log, 'calories') ?? 0)} kcal`}
        />
      </View>
    </ReanimatedSwipeable>
  );
}

function MacroRow({ name, value, goal }: { name: string; value: number; goal: number }) {
  return (
    <View style={{ paddingHorizontal: 18, paddingVertical: 14, gap: 9 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <BlancText variant="body">{name}</BlancText>
        <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
          <BlancText variant="secondary" weight="500">
            {formatWhole(value)}
          </BlancText>{' '}
          / {formatWhole(goal)} g
        </BlancText>
      </View>
      <Track progress={goal > 0 ? value / goal : 0} />
    </View>
  );
}
