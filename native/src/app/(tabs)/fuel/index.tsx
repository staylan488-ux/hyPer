import { addWeeks, format, isAfter, isSameDay, startOfDay } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, StyleSheet, useWindowDimensions, View, type AlertButton } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { create } from 'zustand';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { getLogDate } from '@/lib/nutritionLogUtils';
import { fuelDaySummary, warnsOverTarget, type FuelMacro } from '@/lib/fuelSummary';
import type { NutritionGoal } from '@/lib/nutritionCalculator';
import { decodeMealComposition } from '@/lib/mealComposition';
import { weekDays } from '@/lib/nutritionCalendar';
import { canReorderNutritionGroup, offersMoveToPreviousDay } from '@/lib/nutritionDay';
import { NO_MEAL, nutritionGroupTitle } from '@/lib/nutritionGroups';
import { servingLabel, sortLedgerEntries } from '@/lib/nutritionLedger';
import { logMacro, sumMacros } from '@/lib/nutritionMacros';
import { alreadyOnDay } from '@/lib/repeatEntries';
import { readSavedFoodsCache, subscribeSavedFoodsCache } from '@/lib/savedFoodsCache';
import { canSaveAsMeal } from '@/lib/savedMealFromLog';
import { useAppStore } from '@/stores/appStore';
import { useAuthStore } from '@/stores/authStore';
import type { NutritionGroup } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row, type DetailParts } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { tabBarCover, TabScroll } from '~/components/TabScroll';
import { UndoBar } from '~/components/UndoBar';
import { Track } from '~/components/Track';
import { DayMark } from '~/fuel/DayMark';
import { announce, screenReaderRunning, speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { formatWhole } from '~/lib/format';
import { dayKey, todayLogsInMatchingMeal, useFuelDay, useFuelStore, useTodayKey, type FoodLog } from '~/lib/fuel';
import { haptics } from '~/lib/haptics';
import { blockExit, figureLayout, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { useWorkoutBarShown } from '~/lib/workoutBar';
import { useYouMealsStore } from '~/lib/you';
import { figureLead, restingFigure, space, useBlanc } from '~/theme/blanc';

const logFood = (day: string, group?: string) => router.push({ pathname: '/log-food', params: group ? { day, group } : { day } });

/** The month sheet, from the date under the title. */
const openMonth = () => {
  haptics.tap();
  router.push('/fuel-month');
};

const CHECK_CONNECTION = 'Check your connection and try again.';
const DELETE_UNCONFIRMED = "Couldn't confirm the delete";
const DELETE_UNCONFIRMED_MESSAGE = 'It may have gone through. Fuel shows what is saved once it reads the day again; check your connection.';

/** How long Undo stays after a delete, as Train's skip does; longer with VoiceOver. */
const UNDO_MS = 5000;
const UNDO_MS_SCREEN_READER = 20000;

/**
 * The entry just deleted, to take back from the bar at the foot for a few
 * seconds (`key` starts that time again), whether Undo is putting it back,
 * and how many of Fuel's alerts are up: the bar's time stands still behind them.
 */
const useDeletedEntry = create<{ entry: FoodLog | null; key: number; restoring: boolean; alerts: number }>(() => ({ entry: null, key: 0, restoring: false, alerts: 0 }));

/**
 * One of Fuel's alerts: a failure, or Copy again's question. While it is up,
 * the Undo bar keeps whatever it offers then (the alert covers it); once
 * dismissed, by any button, that offer gets its full time again.
 */
function holdingUndoAlert(title: string, message: string, buttons: AlertButton[] = [{ text: 'OK' }]) {
  useDeletedEntry.setState((state) => ({ alerts: state.alerts + 1 }));
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    useDeletedEntry.setState((state) => ({ alerts: Math.max(0, state.alerts - 1), key: state.key + 1 }));
  };
  Alert.alert(
    title,
    message,
    buttons.map((button) => ({
      ...button,
      onPress: (value?: string) => {
        release();
        button.onPress?.(value);
      },
    })),
    { cancelable: true, onDismiss: release },
  );
}

/** Deletes an entry at once and offers Undo at the foot, which puts it back as it was. */
function deleteWithUndo(log: FoodLog) {
  useDeletedEntry.setState((state) => ({ entry: log, key: state.key + 1, restoring: false }));
  // A failed delete keeps its Undo: its answer may have been lost after the
  // row went, and Undo writes the row back as it was either way. Its alert
  // says only what is known; the store reads the day again to show what the
  // server has.
  report(useFuelStore.getState().deleteEntry(log.id), DELETE_UNCONFIRMED, DELETE_UNCONFIRMED_MESSAGE);
}

/**
 * Undo: the bar stays, busy, until the entry is confirmed back. Its failure
 * offers Try again for that entry alone; one a newer delete has taken the
 * bar from only says so. Either alert holds the bar while it is up.
 */
function undoDelete() {
  const { entry, restoring } = useDeletedEntry.getState();
  if (!entry || restoring) return;
  useDeletedEntry.setState({ restoring: true });
  const name = entry.food?.name ?? 'Food';
  void useFuelStore
    .getState()
    .restoreEntry(entry)
    .catch(() => false)
    .then((ok) => {
      // Not when a newer delete has the bar now, or Fuel was left.
      const shown = useDeletedEntry.getState().entry === entry;
      if (ok) {
        if (shown) useDeletedEntry.setState({ entry: null, restoring: false });
        haptics.success();
        announce(`${name} back`);
        return;
      }
      haptics.error();
      if (!shown) {
        holdingUndoAlert('Not put back', `${name} couldn't be put back. Check your connection.`);
        return;
      }
      useDeletedEntry.setState({ restoring: false });
      holdingUndoAlert('Not put back', CHECK_CONNECTION, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Try again',
          onPress: () => {
            if (useDeletedEntry.getState().entry === entry) undoDelete();
          },
        },
      ]);
    });
}

/**
 * The week strip's cells are a fixed seven across: their text stops growing
 * at about iOS's largest standard size, as Calendar's do.
 */
const DAY_CELL_TEXT_MAX = 1.3;

/**
 * A Fuel write's result: a success tick, or an error buzz and an alert, so a
 * failed delete or move is never silent.
 */
function report(write: Promise<boolean>, failure: string, message = CHECK_CONNECTION) {
  void write
    .catch(() => false)
    .then((ok) => {
      if (ok) {
        haptics.success();
        return;
      }
      haptics.error();
      holdingUndoAlert(failure, message);
    });
}

/**
 * A past day's meal (or one entry) logged again today: the same foods and
 * amounts at the same times, in today's matching meal; Fuel then shows today.
 * When today's meal already has all of them, it asks before doubling it.
 */
function copyToToday(logs: FoodLog[], group: NutritionGroup | null) {
  const copy = () => report(useFuelStore.getState().copyToToday(logs, group), 'Not copied');
  const inMeal = todayLogsInMatchingMeal(group);
  if (inMeal && alreadyOnDay(logs, inMeal)) {
    holdingUndoAlert('Copy again?', logs.length === 1 ? "Today's meal already has this food." : "Today's meal already has these foods.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Copy', onPress: copy },
    ]);
    return;
  }
  copy();
}

/**
 * The saved meals this session last read (Log food's Saved list, else You's),
 * so a built saved meal logged from Saved does not offer Save as meal again.
 * Watched, not read once: Save as meal closes without refreshing Fuel, and the
 * offer follows the list it reloads.
 */
function useKnownSavedMeals() {
  const userId = useAuthStore((state) => state.user?.id);
  const logged = useSyncExternalStore(subscribeSavedFoodsCache, () => readSavedFoodsCache(userId));
  const you = useYouMealsStore((state) => state.meals);
  return logged ?? you;
}

/** Opens the meal builder with these foods at the amounts eaten, to keep as a saved meal; nothing is logged. */
function saveAsMeal(logs: FoodLog[]) {
  const ids = logs.filter((log) => log.food).map((log) => log.id);
  if (ids.length > 0) router.push({ pathname: '/log-food', params: { saveEntries: ids.join(',') } });
}

/** Opens the targets with that number's field ready to type, as You's Targets does. */
const editTarget = (focus: 'calories' | 'protein' | 'carbs' | 'fat') => {
  haptics.tap();
  router.push({ pathname: '/targets-edit', params: { focus } });
};

/**
 * Whether the day's entries offer Move to yesterday, read from the clock on
 * every render like today's key: the offer ends at 5 am, and the compiler
 * would otherwise keep the answer until the day's entries change.
 */
function useLateNight(live: boolean, logs: FoodLog[]) {
  return live && offersMoveToPreviousDay(logs);
}

export default function FuelScreen() {
  const target = useAppStore((state) => state.macroTarget);
  const userId = useAuthStore((state) => state.user?.id);
  // Only a saved target is measured against: before the account's targets
  // load nothing is shown, and with none saved, one quiet line asks for one.
  const targetKnown = useAppStore((state) => Boolean(userId) && state.macroTargetLoadedForUserId === userId);
  const kcalTarget = target && target.calories > 0 ? target.calories : null;
  // Bulking, going past a target is a good day, not a red one.
  const goal = useAppStore((state) => state.nutritionProfile?.goal);
  const { selected, logs, groups, loaded, status } = useFuelDay();
  // The latest delete's Undo, for a few seconds; leaving Fuel lets it go.
  const deleted = useDeletedEntry((state) => state.entry);
  const deletedKey = useDeletedEntry((state) => state.key);
  const restoring = useDeletedEntry((state) => state.restoring);
  const workoutBar = useWorkoutBarShown((state) => state.shown);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => {
      const state = useDeletedEntry.getState();
      if (state.key === deletedKey && !state.restoring && state.alerts === 0) useDeletedEntry.setState({ entry: null });
    }, screenReaderRunning() ? UNDO_MS_SCREEN_READER : UNDO_MS);
    return () => clearTimeout(timer);
  }, [deleted, deletedKey]);
  useEffect(() => () => useDeletedEntry.setState({ entry: null, restoring: false }), []);
  const monthLogs = useFuelStore((state) => state.logs);
  const selectedDate = new Date(`${selected}T12:00:00`);
  // Read on every render and handed down, so the rows' "today" changes at
  // midnight with the screen's rather than staying memoized with their entries.
  const todayKey = useTodayKey();
  const live = selected === todayKey;
  const totals = sumMacros(logs);
  const summary = fuelDaySummary({ totals, target, live, selectedDate, goal });
  // Each day's kcal in the loaded month, for the week strip's marks.
  const dayKcal = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const log of monthLogs) byDay.set(log.date, (byDay.get(log.date) ?? 0) + (logMacro(log, 'calories') ?? 0));
    return byDay;
  }, [monthLogs]);
  const lateNight = useLateNight(live, logs);
  // The capped figure and the words beside it outgrow one line from the larger
  // standard sizes on; then the words go under the figure.
  const grown = useWindowDimensions().fontScale > 1;
  const loadFailed = status === 'error' && !loaded;
  useAnnounce(loadFailed ? "This day's food could not load. Pull down to try again." : null);
  const c = useBlanc();
  // Every day is written as Today writes its date ("Monday, November 2"), with the year only when it differs.
  const dayLine = format(selectedDate, selectedDate.getFullYear() === new Date().getFullYear() ? 'EEEE, MMMM d' : 'EEEE, MMMM d, yyyy');
  // A day with nothing logged shows no figures (no 0 kcal, no 0 g): only Nothing logged and Log food.
  const empty = loaded && logs.length === 0;

  // The day's groups in order, Unassigned first when it has entries. Empty
  // named meals stay out of the way; a meal or snack added by hand stays.
  const groupIds = new Set(groups.map((group) => group.id));
  const unassigned = sortLedgerEntries(logs.filter((log) => !log.group_id || !groupIds.has(log.group_id)));
  const sections = groups
    .map((group) => ({ group, logs: sortLedgerEntries(logs.filter((log) => log.group_id === group.id)) }))
    .filter((section) => section.logs.length > 0 || !section.group.label);

  // Pull down: the shown day's month and the targets, fresh.
  const [refreshing, setRefreshing] = useState(false);
  // .finally rather than try/finally, which the React Compiler can't compile.
  const refresh = async () => {
    setRefreshing(true);
    await Promise.all([useFuelStore.getState().refresh(), useAppStore.getState().fetchMacroTarget().catch(() => {})]).finally(() =>
      setRefreshing(false),
    );
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Fuel',
          // The date under the title opens the month, so + stands alone.
          unstable_headerRightItems: () => [
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
        {/* The date under the large title is the month's button, with the
            small chevron Log food's destination line has. It stays in the
            page, so the native large title keeps its collapse. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={dayLine}
          accessibilityHint="Opens the month"
          // a 15-point line, 44 points to touch
          hitSlop={{ top: 12, bottom: 12, left: space.gutter, right: 16 }}
          onPress={openMonth}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: space.gutter, marginTop: 2, opacity: pressed ? 0.5 : 1 })}>
          <BlancText variant="secondary" tone="graphite" style={{ flexShrink: 1 }}>
            {dayLine}
          </BlancText>
          <SymbolView name="chevron.down" size={11} weight="semibold" tintColor={c.graphite} style={{ marginLeft: 4 }} />
        </Pressable>

        <WeekStrip selected={selectedDate} dayKcal={dayKcal} target={kcalTarget} goal={goal} todayKey={todayKey} />

        {/* The day's figure, its line and the macros are one card, so every
            line starts at the card's inset; each part opens the targets, the
            numbers they measure against. */}
        {empty ? null : (
          <Label style={{ overflow: 'hidden', marginTop: 12 }}>
            <Pressable
              accessibilityRole="button"
              // The figure, its target and the line under it, as one fact.
              accessibilityLabel={speak(
                kcalTarget
                  ? loaded
                    ? `${formatWhole(totals.calories)} of ${formatWhole(kcalTarget)} kcal${live ? ` · ${summary.logLine}` : ''}`
                    : `Target ${formatWhole(kcalTarget)} kcal`
                  : loaded
                    ? `${formatWhole(totals.calories)} kcal`
                    : 'Calories',
              )}
              accessibilityHint={kcalTarget ? 'Edits your calorie target' : 'Sets your calorie target'}
              onPress={() => editTarget('calories')}
              // As Today's Fuel card: the figure's line box carries its own room above the digits, so the top is a little less.
              style={({ pressed }) => ({ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, backgroundColor: pressed ? c.pressed : 'transparent' })}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, ...(grown ? { flexWrap: 'wrap' } : null) }}>
                {/* never a 0 that only means "not loaded yet"; a logged food rolls the digits */}
                <RollingText variant="figure" size={56} style={{ ...restingFigure, letterSpacing: -1.25, marginLeft: figureLead(loaded ? formatWhole(totals.calories) : '–', 56, { tabular: false }) }}>
                  {loaded ? formatWhole(totals.calories) : '–'}
                </RollingText>
                <Animated.View layout={figureLayout} style={grown ? { flexShrink: 1 } : undefined}>
                  <BlancText variant="secondary" tone="graphite">
                    {kcalTarget ? `of ${formatWhole(kcalTarget)} kcal` : 'kcal'}
                  </BlancText>
                </Animated.View>
              </View>
              {/* The line appears with the day's food, at its value: it holds its
                  place while the day loads rather than filling from a 0 it never was. */}
              {kcalTarget ? (
                <View style={{ marginTop: 10, height: 3 }}>
                  {loaded ? <Track progress={totals.calories / kcalTarget} warnOver={warnsOverTarget('calories', goal)} /> : null}
                </View>
              ) : null}
              {!kcalTarget && targetKnown ? (
                <BlancText variant="secondary" tone="graphite" style={{ marginTop: 10 }}>
                  Set a calorie target
                </BlancText>
              ) : null}
            </Pressable>
            <Hairline />
            {/* The macros sit side by side under the figure, so the day's food starts on the first screen.
                At the accessibility text sizes they stack as rows. */}
            {grown ? (
              <>
                <MacroRow macro="protein" value={totals.protein} target={target?.protein || null} loaded={loaded} goal={goal} />
                <Hairline />
                <MacroRow macro="carbs" value={totals.carbs} target={target?.carbs || null} loaded={loaded} goal={goal} />
                <Hairline />
                <MacroRow macro="fat" value={totals.fat} target={target?.fat || null} loaded={loaded} goal={goal} />
              </>
            ) : (
              <View style={{ flexDirection: 'row' }}>
                <MacroColumn macro="protein" value={totals.protein} target={target?.protein || null} loaded={loaded} goal={goal} />
                <MacroColumn macro="carbs" value={totals.carbs} target={target?.carbs || null} loaded={loaded} goal={goal} edge />
                <MacroColumn macro="fat" value={totals.fat} target={target?.fat || null} loaded={loaded} goal={goal} edge />
              </View>
            )}
          </Label>
        )}

        {/* One day's list: rows and meals fold away and close up when removed.
            Moving to another day swaps the whole list without that motion. */}
        <LayoutAnimationConfig key={selected} skipEntering skipExiting>
          <View>
            {unassigned.length > 0 ? (
              <Animated.View key="unassigned" entering={rowEnter} exiting={blockExit} layout={rowLayout}>
                <MealSection title={NO_MEAL} logs={unassigned} groups={groups} lateNight={lateNight} day={selected} todayKey={todayKey} />
              </Animated.View>
            ) : null}
            {sections.map(({ group, logs: entries }) => (
              <Animated.View key={group.id} entering={rowEnter} exiting={blockExit} layout={rowLayout}>
                <MealSection title={nutritionGroupTitle(group, groups)} group={group} logs={entries} groups={groups} lateNight={lateNight} day={selected} todayKey={todayKey} />
              </Animated.View>
            ))}

            {loaded && logs.length === 0 ? (
              <Animated.View entering={rowEnter} exiting={blockExit} layout={rowLayout} style={{ marginTop: 36, alignItems: 'center', gap: 6, paddingHorizontal: space.gutter }}>
                <BlancText variant="bodyStrong">{live ? 'Nothing logged yet' : 'Nothing logged'}</BlancText>
                <Capsule title="Log food" onPress={() => logFood(selected)} style={{ marginTop: 12, alignSelf: 'center' }} />
              </Animated.View>
            ) : null}

            {/* More food for a day that has begun; a new meal or snack is made in Log food's destination menu. */}
            {loaded && logs.length > 0 ? (
              <Animated.View entering={rowEnter} exiting={blockExit} layout={rowLayout} style={{ alignItems: 'center', marginTop: 28 }}>
                <Capsule title="Log food" variant="quiet" onPress={() => logFood(selected)} style={{ alignSelf: 'center' }} />
              </Animated.View>
            ) : null}
          </View>
        </LayoutAnimationConfig>

        {loadFailed ? (
          <BlancText variant="secondary" tone="live" style={{ margin: space.gutter }}>
            This day's food could not load. Pull down to try again.
          </BlancText>
        ) : null}
      </TabScroll>

      <UndoBar label={deleted ? `${deleted.food?.name ?? 'Food'} deleted` : null} bottom={tabBarCover(workoutBar) + 8} busy={restoring} onUndo={undoDelete} />
    </>
  );
}

/**
 * Monday-first week, the training week's; swipe for the week before or after.
 * Future days are not selectable. Under each date, the chosen one too, how
 * far its food went toward the target.
 */
function WeekStrip({ selected, dayKcal, target, goal, todayKey }: {
  selected: Date;
  dayKcal: Map<string, number>;
  target: number | null;
  goal: NutritionGoal | undefined;
  todayKey: string;
}) {
  const c = useBlanc();
  const days = weekDays(selected);
  const now = startOfDay(new Date(`${todayKey}T12:00:00`));
  const go = (weeks: number) => {
    const target = addWeeks(selected, weeks);
    const next = isAfter(startOfDay(target), now) ? now : target;
    if (isSameDay(next, selected)) return null;
    haptics.select();
    useFuelStore.getState().select(dayKey(next));
    return next;
  };
  const swipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-14, 14])
    .runOnJS(true)
    .onEnd((event) => {
      if (event.translationX < -50) go(1);
      else if (event.translationX > 50) go(-1);
    });
  // The swipe, for VoiceOver: each day offers the week before and after.
  const weekActions = [
    { name: 'previousWeek', label: 'Previous week' },
    ...(isSameDay(selected, now) ? [] : [{ name: 'nextWeek', label: 'Next week' }]),
  ];

  return (
    <GestureDetector gesture={swipe}>
      {/* Each day is its own button, so VoiceOver can pick any of them. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, marginTop: 12 }}>
        {/* Keyed by weekday, so a week change updates the same buttons and VoiceOver keeps its place. */}
        {days.map((day, index) => {
          const key = dayKey(day);
          const isSelected = isSameDay(day, selected);
          const isToday = isSameDay(day, now);
          const future = isAfter(startOfDay(day), now);
          const kcal = dayKcal.get(key);
          return (
            <Pressable
              key={index}
              disabled={future}
              accessibilityRole="button"
              accessibilityLabel={`${isToday ? 'Today, ' : ''}${format(day, 'EEEE, MMMM d')}${kcal === undefined ? '' : `, ${speak(`${formatWhole(kcal)} kcal`)}`}`}
              accessibilityState={{ selected: isSelected, disabled: future }}
              accessibilityActions={weekActions}
              onAccessibilityAction={(event) => {
                const next = go(event.nativeEvent.actionName === 'nextWeek' ? 1 : -1);
                if (next) announce(`${isSameDay(next, now) ? 'Today, ' : ''}${format(next, 'EEEE, MMMM d')}`);
              }}
              onPress={() => {
                haptics.select();
                useFuelStore.getState().select(key);
              }}
              style={({ pressed }) => ({ width: 46, alignItems: 'center', gap: 6, paddingVertical: 4, opacity: future ? 0.55 : pressed ? 0.5 : 1 })}>
              <BlancText variant="footnote" tone="graphite" maxFontSizeMultiplier={DAY_CELL_TEXT_MAX}>
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
                <BlancText
                  variant="body"
                  weight={isToday || isSelected ? '600' : '400'}
                  tone={isSelected ? 'onCapsule' : 'ink'}
                  maxFontSizeMultiplier={DAY_CELL_TEXT_MAX}
                  style={{ fontVariant: ['tabular-nums'] }}>
                  {format(day, 'd')}
                </BlancText>
              </View>
              {/* Every day shows its food under the date, the chosen one too: on the
                  ground below its circle, so a day with food never reads as empty. */}
              <View style={{ marginTop: 3 }}>
                <DayMark logged={kcal !== undefined} kcal={kcal} target={target} goal={goal} />
              </View>
            </Pressable>
          );
        })}
      </View>
    </GestureDetector>
  );
}

function MealSection({ title, group, logs, groups, lateNight, day, todayKey }: {
  title: string;
  group?: NutritionGroup;
  logs: FoodLog[];
  groups: NutritionGroup[];
  lateNight: boolean;
  day: string;
  todayKey: string;
}) {
  const c = useBlanc();
  const kcal = logs.reduce((sum, log) => sum + (logMacro(log, 'calories') ?? 0), 0);
  const savedMeals = useKnownSavedMeals();
  // A past day's meal can be logged again today, and any day's kept as a
  // saved meal (Unassigned too).
  const copyable = day !== todayKey && logs.some((log) => log.food);
  const savable = canSaveAsMeal(logs, savedMeals);

  const groupMenu = () => {
    const reuse = [
      ...(copyable ? [{ label: 'Copy to today', run: () => copyToToday(logs, group ?? null) }] : []),
      ...(savable ? [{ label: 'Save as meal', run: () => saveAsMeal(logs) }] : []),
    ];
    if (!group) {
      if (reuse.length === 0) return;
      ActionSheetIOS.showActionSheetWithOptions({ title, options: [...reuse.map((action) => action.label), 'Cancel'], cancelButtonIndex: reuse.length }, (index) => {
        if (index < reuse.length) reuse[index].run();
      });
      return;
    }
    const store = useFuelStore.getState();
    const actions: { label: string; run: () => void; destructive?: boolean }[] = [
      ...reuse,
      { label: 'Log food here', run: () => logFood(day, group.id) },
    ];
    if (canReorderNutritionGroup(groups, group.id, -1)) actions.push({ label: 'Move up', run: () => report(store.reorderGroup(group.id, -1), 'Not moved') });
    if (canReorderNutritionGroup(groups, group.id, 1)) actions.push({ label: 'Move down', run: () => report(store.reorderGroup(group.id, 1), 'Not moved') });
    if (!group.label) {
      actions.push({
        label: `Delete ${title}`,
        destructive: true,
        run: () => report(store.deleteGroup(group), DELETE_UNCONFIRMED, DELETE_UNCONFIRMED_MESSAGE),
      });
    }
    const options = [...actions.map((action) => action.label), 'Cancel'];
    const destructive = actions.findIndex((action) => action.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        message: !group.label ? 'Its foods stay on the day, in no meal.' : undefined,
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
      // A day's meals read as one ledger: closer together than a screen's sections.
      style={{ marginTop: 20 }}
      note={logs.length > 0 ? `${formatWhole(kcal)} kcal` : undefined}
      accessory={
        group || copyable || savable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${title} options`}
            hitSlop={6}
            onPress={() => {
              haptics.tap();
              groupMenu();
            }}
            style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
            <SymbolView name="ellipsis" size={17} weight="semibold" tintColor={c.graphite} />
          </Pressable>
        ) : undefined
      }>
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {logs.map((log, index) => (
          <Animated.View key={log.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
            {index > 0 ? <Hairline /> : null}
            <EntryRow log={log} groups={groups} lateNight={lateNight} todayKey={todayKey} />
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

/**
 * An entry's quiet line in parts: what was eaten leads, then the protein, the
 * time and the source word. Only the amount gives way on a narrow line, so
 * the time and "Estimate" (which says how to read the calories) stay whole.
 */
function entryDetail(log: FoodLog): DetailParts {
  const parts = decodeMealComposition(log.food?.description);
  const time = format(getLogDate(log), 'h:mm a');
  const amount = parts ? `${parts.ingredients.length} ingredient${parts.ingredients.length === 1 ? '' : 's'}` : servingLabel(log);
  const protein = Math.round(logMacro(log, 'protein') ?? 0);
  // An AI estimate says so (one word, so the line stays quiet).
  const raw = log.source as string | undefined;
  const source = raw === 'gemini_estimate' || raw === 'gemini_trial' ? 'Estimate' : raw === 'gemini_label' ? 'From label' : null;
  return [amount, ...[protein > 0 ? `${formatWhole(protein)} g protein` : null, time, source].filter((part): part is string => Boolean(part))];
}

/** One entry: tap to edit; swipe for More and Delete (all the way deletes); hold for the menu. */
function EntryRow({ log, groups, lateNight, todayKey }: { log: FoodLog; groups: NutritionGroup[]; lateNight: boolean; todayKey: string }) {
  const c = useBlanc();
  const savedMeals = useKnownSavedMeals();
  const name = log.food?.name ?? 'Food';
  const edit = () => router.push({ pathname: '/log-food', params: { entry: log.id } });
  // The row slides away at once; it comes back if the delete fails, and Undo at the foot brings it back.
  const remove = () => deleteWithUndo(log);

  // Move to opens the day's other meals; the hold menu, the swipe's More
  // and VoiceOver all offer the same list.
  const targets: { id: string | null; label: string }[] = [
    { id: null, label: NO_MEAL },
    ...groups.map((group) => ({ id: group.id, label: nutritionGroupTitle(group, groups) })),
  ].filter((targetGroup) => targetGroup.id !== (log.group_id ?? null));
  const menu: MenuAction[] = [
    { title: 'Edit', symbol: 'pencil', run: edit },
    {
      title: 'Move to',
      symbol: 'arrow.right.square',
      children: targets.map((targetGroup) => ({
        title: targetGroup.label,
        removes: true,
        run: () => report(useFuelStore.getState().moveEntry(log.id, targetGroup.id), 'Not moved'),
      })),
    },
    ...(lateNight
      ? [{ title: 'Move to yesterday', symbol: 'arrow.uturn.backward', removes: true, run: () => report(useFuelStore.getState().moveEntryToYesterday(log.id), 'Not moved') }]
      : []),
    // A past day's entry can be logged again today.
    ...(log.date !== todayKey && log.food
      ? [{ title: 'Copy to today', symbol: 'doc.on.doc', run: () => copyToToday([log], groups.find((group) => group.id === log.group_id) ?? null) }]
      : []),
    // Any entry can be kept as a saved meal, unless it is one already.
    ...(canSaveAsMeal([log], savedMeals) ? [{ title: 'Save as meal', symbol: 'bookmark', run: () => saveAsMeal([log]) }] : []),
    { title: 'Delete', symbol: 'trash', destructive: true, removes: true, run: remove },
  ];

  const detail = entryDetail(log);
  const kcal = formatWhole(logMacro(log, 'calories') ?? 0);
  return (
    <SwipeRow
      name={name}
      actions={[
        { label: 'More', onPress: () => showActionSheet(name, menu) },
        { label: 'Delete', destructive: true, onPress: remove },
      ]}>
      <View style={{ backgroundColor: c.label }}>
        <Row
          title={name}
          detail={detail}
          value={kcal}
          onPress={edit}
          menu={menu}
          accessibilityLabel={`${name}, ${detail.join(' · ')}, ${kcal} kcal`}
        />
      </View>
    </SwipeRow>
  );
}

const MACRO_NAMES: Record<Exclude<FuelMacro, 'calories'>, string> = { protein: 'Protein', carbs: 'Carbs', fat: 'Fat' };

/**
 * One macro against its target; a tap opens that target to change. Its line
 * turns red past target only where that is a warning for the goal: never for
 * protein, never while gaining. Without a saved target it is the grams alone,
 * and "–" until the day has loaded.
 */
function MacroRow({ macro, value, target, loaded, goal }: {
  macro: Exclude<FuelMacro, 'calories'>;
  value: number;
  target: number | null;
  loaded: boolean;
  goal: NutritionGoal | undefined;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const name = MACRO_NAMES[macro];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loaded ? speak(`${name}, ${formatWhole(value)}${target ? ` of ${formatWhole(target)}` : ''} g`) : name}
      accessibilityHint={`Edits your ${name.toLowerCase()} target`}
      onPress={() => editTarget(macro)}
      style={({ pressed }) => ({ paddingHorizontal: 18, paddingVertical: 14, gap: 9, backgroundColor: pressed ? c.pressed : 'transparent' })}>
      {/* At the accessibility sizes the numbers go under the name when they don't fit beside it. */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', ...(large ? { flexWrap: 'wrap', columnGap: 12 } : null) }}>
        <BlancText variant="body">{name}</BlancText>
        <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
          <RollingText variant="secondary" weight="500" style={{ fontVariant: ['tabular-nums'], textAlign: 'right' }}>
            {loaded ? formatWhole(value) : '–'}
          </RollingText>
          <BlancText variant="secondary" tone="graphite" style={{ fontVariant: ['tabular-nums'] }}>
            {target ? ` of ${formatWhole(target)} g` : loaded ? ' g' : ''}
          </BlancText>
        </View>
      </View>
      {/* Its place is held while the day loads, so the line appears at its value. */}
      {target ? loaded ? <Track progress={value / target} warnOver={warnsOverTarget(macro, goal)} /> : <View style={{ height: 3 }} /> : null}
    </Pressable>
  );
}

/** One macro of three side by side: its name, the grams against the target and its line; a tap opens that target. */
function MacroColumn({ macro, value, target, loaded, goal, edge }: {
  macro: Exclude<FuelMacro, 'calories'>;
  value: number;
  target: number | null;
  loaded: boolean;
  goal: NutritionGoal | undefined;
  /** A hairline on its leading side, between it and the column before. */
  edge?: boolean;
}) {
  const c = useBlanc();
  const name = MACRO_NAMES[macro];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={loaded ? speak(`${name}, ${formatWhole(value)}${target ? ` of ${formatWhole(target)}` : ''} g`) : name}
      accessibilityHint={`Edits your ${name.toLowerCase()} target`}
      onPress={() => editTarget(macro)}
      style={({ pressed }) => ({
        flex: 1,
        // The first column's words start where the meal cards' do, and the last
        // column's bar ends where the calorie bar above it does: the card's 18.
        paddingLeft: 18,
        paddingRight: 18,
        paddingTop: 13,
        paddingBottom: 15,
        backgroundColor: pressed ? c.pressed : 'transparent',
        borderLeftWidth: edge ? StyleSheet.hairlineWidth : 0,
        borderLeftColor: c.hairline,
      })}>
      <BlancText variant="footnote" tone="graphite">
        {name}
      </BlancText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 3, marginBottom: 9 }}>
        <RollingText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {loaded ? formatWhole(value) : '–'}
        </RollingText>
        <BlancText variant="footnote" tone="graphite" numberOfLines={1} style={{ fontVariant: ['tabular-nums'], flexShrink: 1 }}>
          {target ? ` of ${formatWhole(target)} g` : loaded ? ' g' : ''}
        </BlancText>
      </View>
      {/* Without a target, or while the day loads, the line's place is held. */}
      {target && loaded ? <Track progress={value / target} warnOver={warnsOverTarget(macro, goal)} /> : <View style={{ height: 3 }} />}
    </Pressable>
  );
}

/** A meal's name on Fuel: "Snack" while it is the day's only snack, "Snack 2" once there are more. */
