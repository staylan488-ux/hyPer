import { addMonths, format, isSameMonth, isToday, parseISO, startOfMonth } from 'date-fns';
import { router, Stack, useFocusEffect } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatDistanceMi } from '@/lib/activityMetrics';
import { formatActivityDuration, formatActivityStartTime, getActivitySessionDateKey, resolveActivityTitle, sortActivitySessionsByStart } from '@/lib/activitySessions';
import { buildCalendarDays, historyDayKey, historyWorkoutTitle, progressFromSets, type HistoryWorkout } from '@/lib/historyMonth';
import { formatWorkoutDuration, getWorkoutDurationMs } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySession } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { announce, spokenClock, useAnnounce, useIncreaseContrast, useReduceMotion } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import {
  confirmDeleteActivity,
  confirmDeleteWorkout,
  followToday,
  loadHistoryMonth,
  mergeActivities,
  selectHistoryDay,
  syncActivities,
  useHistoryStore,
  workoutsOnDay,
} from '~/lib/history';
import { blockExit, rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { isPreviewActive } from '~/platform/previewFlag';
import { useBlanc, type Palette } from '~/theme/blanc';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** A length the rows show as "1h 5m", in words: VoiceOver reads "5m" as meters. */
const spokenMinutes = (seconds: number) => spokenClock(Math.max(1, Math.round(seconds / 60)) * 60);

/** History: a month of training at a glance, and each day's workouts and activities. */
export default function HistoryScreen() {
  const month = useHistoryStore((state) => state.month);
  const day = useHistoryStore((state) => state.day);
  const workouts = useHistoryStore((state) => state.workouts);
  const activities = useHistoryStore((state) => state.activities);
  const loading = useHistoryStore((state) => state.loading);
  const failed = useHistoryStore((state) => state.failed);
  const whoop = useAppStore((state) => state.whoopConnection);
  const [syncing, setSyncing] = useState(false);
  // Only while the person's own pull runs.
  const [refreshing, setRefreshing] = useState(false);
  const syncAvailable = isPreviewActive() || Boolean(whoop);

  useEffect(() => {
    // Left on a today that has passed, it opens on the new today (and reads it).
    if (!followToday()) void loadHistoryMonth();
    void useAppStore.getState().fetchWhoopConnection();
  }, []);
  // The same when it shows again without opening anew (back from a sheet or a run).
  useFocusEffect(
    useCallback(() => {
      followToday();
    }, []),
  );

  const dayWorkouts = useMemo(() => workoutsOnDay(workouts, day), [workouts, day]);
  const dayActivities = useMemo(
    () => sortActivitySessionsByStart(activities.filter((activity) => getActivitySessionDateKey(activity) === day)),
    [activities, day],
  );
  const date = parseISO(day);
  const onToday = isToday(date);
  useAnnounce(failed && !loading ? "Couldn't load this month" : null);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    const message = await syncActivities();
    setSyncing(false);
    // A sync that worked shows itself in the rows; only a failure needs words
    // (VoiceOver hears the result, "Up to date" or "2 new · 1 updated").
    if (message === 'Sync failed' || message === 'Sync unavailable') {
      haptics.error();
      Alert.alert(message);
    } else {
      haptics.success();
      announce(message);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await loadHistoryMonth();
    setRefreshing(false);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'History',
          unstable_headerRightItems: () => [
            ...(!onToday
              ? [
                  {
                    type: 'button' as const,
                    label: 'Today',
                    onPress: () => {
                      haptics.tap();
                      selectHistoryDay(new Date());
                    },
                  },
                ]
              : []),
            ...(syncAvailable
              ? [
                  {
                    type: 'button' as const,
                    label: syncing ? 'Syncing' : 'Sync WHOOP',
                    icon: { type: 'sfSymbol' as const, name: 'arrow.triangle.2.circlepath' as const },
                    disabled: syncing,
                    onPress: () => {
                      haptics.tap();
                      void sync();
                    },
                  },
                ]
              : []),
          ],
        }}
      />
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        <Calendar month={month} day={day} workouts={workouts} activities={activities} />

        <Section
          title={format(date, 'EEEE, MMMM d')}
          accessory={<AddActivityButton day={day} />}>
          <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
            {loading ? (
              <Animated.View key="loading" entering={rowEnter} exiting={blockExit}>
                <Row title="Loading…" quiet />
              </Animated.View>
            ) : failed && dayWorkouts.length === 0 && dayActivities.length === 0 ? (
              <Animated.View key="failed" entering={rowEnter} exiting={blockExit}>
                <Row title="Couldn't load this month" detail="Tap to try again" quiet onPress={() => void loadHistoryMonth()} />
              </Animated.View>
            ) : dayWorkouts.length === 0 && dayActivities.length === 0 ? (
              <Animated.View key="empty" entering={rowEnter} exiting={blockExit}>
                <Row title="Nothing logged" quiet />
              </Animated.View>
            ) : null}
            {!loading &&
              dayWorkouts.map((workout, index) => (
                <Animated.View key={workout.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                  {index > 0 ? <Hairline /> : null}
                  <WorkoutRow workout={workout} />
                </Animated.View>
              ))}
            {!loading &&
              dayActivities.map((activity, index) => (
                <Animated.View key={activity.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
                  {index > 0 || dayWorkouts.length > 0 ? <Hairline /> : null}
                  <ActivityRow activity={activity} sameDay={dayActivities} />
                </Animated.View>
              ))}
          </Label>
        </Section>
      </TabScroll>
    </>
  );
}

/**
 * The month grid: tap a day; swipe sideways or use the arrows to change month.
 * Three pages (last, this, next month) in a native paging scroll view, so the
 * swipe wins over iOS's swipe-back the way Apple's own pagers do, and it
 * recentres on this month after every page turn.
 */
/**
 * Today's key, read from the clock on every render. A hook by name, so the
 * React Compiler runs it each time and the bold day follows midnight.
 */
function useTodayKey(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function Calendar({ month, day, workouts, activities }: { month: Date; day: string; workouts: HistoryWorkout[]; activities: ActivitySession[] }) {
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const reduceMotion = useReduceMotion();
  // An arrow ticks as it is pressed, so the page turn it starts stays quiet.
  const arrowTurn = useRef(false);
  const [width, setWidth] = useState(0);
  const todayKey = useTodayKey();
  // Each day's workouts (how many) and activities (their names, for VoiceOver).
  const marks = useMemo(() => {
    const lifts = new Map<string, number>();
    workouts.forEach((workout) => lifts.set(historyDayKey(workout), (lifts.get(historyDayKey(workout)) ?? 0) + 1));
    const other = new Map<string, string[]>();
    sortActivitySessionsByStart(activities).forEach((activity) => {
      const key = getActivitySessionDateKey(activity);
      other.set(key, [...(other.get(key) ?? []), resolveActivityTitle(activity)]);
    });
    return { lifts, other };
  }, [workouts, activities]);
  const pages = useMemo(() => [addMonths(month, -1), month, addMonths(month, 1)], [month]);

  // VoiceOver hears the new month however it turned (an arrow, a swipe, a
  // day of the next month, Today), since focus stays where it was.
  const monthName = format(month, 'MMMM yyyy');
  const shownMonth = useRef(monthName);
  useEffect(() => {
    if (shownMonth.current !== monthName) announce(monthName);
    shownMonth.current = monthName;
  }, [monthName]);

  // A new month sits on the middle page; jump there without animation, in the
  // same frame as the new grids, so the turn looks seamless.
  useLayoutEffect(() => {
    if (width > 0) scroller.current?.scrollTo({ x: width, animated: false });
  }, [month, width]);

  // A turned page selects its first day, or today in this month, like Calendar.
  const turn = (step: 1 | -1) => {
    if (arrowTurn.current) arrowTurn.current = false;
    else haptics.select();
    const target = startOfMonth(addMonths(month, step));
    selectHistoryDay(isSameMonth(target, new Date()) ? new Date() : target);
  };

  return (
    <Label style={{ marginTop: 6, paddingTop: 6, paddingBottom: 10, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6 }}>
        <BlancText variant="headline" style={{ flex: 1 }} accessibilityRole="header">
          {monthName}
        </BlancText>
        <MonthArrow
          symbol="chevron.left"
          label="Previous month"
          onPress={() => {
            // Reduce Motion: change the month in place instead of sliding the grid.
            if (reduceMotion) {
              arrowTurn.current = true;
              turn(-1);
              return;
            }
            arrowTurn.current = width > 0;
            scroller.current?.scrollTo({ x: 0, animated: true });
          }}
        />
        <MonthArrow
          symbol="chevron.right"
          label="Next month"
          onPress={() => {
            if (reduceMotion) {
              arrowTurn.current = true;
              turn(1);
              return;
            }
            arrowTurn.current = width > 0;
            scroller.current?.scrollTo({ x: width * 2, animated: true });
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, marginTop: 4 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAYS.map((weekday, index) => (
          <BlancText key={index} variant="footnote" tone="graphite" style={{ flex: 1, textAlign: 'center' }}>
            {weekday}
          </BlancText>
        ))}
      </View>
      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollsToTop={false}
        // As tall as this month's weeks; the neighbours clip while they slide in.
        style={{ height: (buildCalendarDays(month).length / 7) * 46 + 2 }}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onScrollBeginDrag={() => {
          arrowTurn.current = false;
        }}
        // Also fires after the arrows' animated scroll.
        onMomentumScrollEnd={(event) => {
          if (width <= 0) return;
          const page = Math.round(event.nativeEvent.contentOffset.x / width);
          if (page !== 1) turn(page === 0 ? -1 : 1);
        }}>
        {pages.map((page, index) => (
          <View key={index} style={{ width: width || undefined }}>
            {/* The chosen day is always in this month, and a cell shows it only in its own
                month, so the neighbours never draw it and a tap redraws one grid. */}
            <MonthGrid
              month={page}
              day={index === 1 ? day : null}
              todayKey={todayKey}
              marks={marks}
              interactive={index === 1}
            />
          </View>
        ))}
      </ScrollView>
    </Label>
  );
}

function MonthGrid({
  month,
  day,
  todayKey,
  marks,
  interactive,
}: {
  month: Date;
  day: string | null;
  todayKey: string;
  marks: { lifts: Map<string, number>; other: Map<string, string[]> };
  interactive: boolean;
}) {
  const c = useBlanc();
  const contrast = useIncreaseContrast();
  // Each cell's date and words, worked out once per month.
  const cells = useMemo(
    () =>
      buildCalendarDays(month).map((date) => ({
        date,
        key: format(date, 'yyyy-MM-dd'),
        label: format(date, 'EEEE, MMMM d'),
        number: format(date, 'd'),
        inMonth: isSameMonth(date, month),
      })),
    [month],
  );
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, marginTop: 2 }}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!interactive}>
      {cells.map((cell) => (
        <DayCell
          key={cell.key}
          date={cell.date}
          label={cell.label}
          number={cell.number}
          inMonth={cell.inMonth}
          selected={cell.key === day}
          today={cell.key === todayKey}
          lifts={marks.lifts.get(cell.key) ?? 0}
          activities={marks.other.get(cell.key)?.join(', ') ?? ''}
          contrast={contrast}
          c={c}
        />
      ))}
    </View>
  );
}

/** One day of the month grid; it redraws only when its own look changes. */
function DayCell({
  date,
  label,
  number,
  inMonth,
  selected,
  today,
  lifts,
  activities,
  contrast,
  c,
}: {
  date: Date;
  label: string;
  number: string;
  inMonth: boolean;
  selected: boolean;
  today: boolean;
  /** Workouts that day. */
  lifts: number;
  /** The day's activities by name ("Running, Cycling"), or empty. */
  activities: string;
  contrast: boolean;
  c: Palette;
}) {
  const lift = lifts > 0;
  const other = activities.length > 0;
  // The date, then what the dots show: "Tuesday, November 4, today, workout, Running".
  const spoken = [label, today ? 'today' : null, lift && inMonth ? (lifts > 1 ? `${lifts} workouts` : 'workout') : null, other && inMonth ? activities : null];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={spoken.filter(Boolean).join(', ')}
      onPress={() => {
        haptics.select();
        selectHistoryDay(date);
      }}
      style={{ width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: 17,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: selected && inMonth ? c.ink : 'transparent',
        }}>
        <BlancText
          variant="body"
          weight={today || (selected && inMonth) ? '600' : undefined}
          // The grid's 34-point circles hold the number; the day's title
          // below carries the date at the full text size.
          maxFontSizeMultiplier={1.3}
          style={{
            fontVariant: ['tabular-nums'],
            color: selected && inMonth ? c.label : inMonth ? c.ink : c.upcoming,
            // Increase Contrast keeps the neighbouring months' days legible.
            opacity: inMonth || contrast ? 1 : 0.55,
          }}>
          {number}
        </BlancText>
      </View>
      <View style={{ flexDirection: 'row', gap: 3, height: 5, marginTop: 1 }}>
        {lift && inMonth ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.ink }} /> : null}
        {other && inMonth ? <View style={{ width: 5, height: 5, borderRadius: 2.5, borderWidth: 1, borderColor: c.graphite }} /> : null}
      </View>
    </Pressable>
  );
}

function MonthArrow({ symbol, label, onPress }: { symbol: 'chevron.left' | 'chevron.right'; label: string; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
      <SymbolView name={symbol} size={16} weight="semibold" tintColor={c.ink} />
    </Pressable>
  );
}

function AddActivityButton({ day }: { day: string }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add an activity"
      hitSlop={6}
      onPress={() => {
        haptics.tap();
        router.push({ pathname: '/activity', params: { day } });
      }}
      style={({ pressed }) => ({ width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: pressed ? 0.45 : 1 })}>
      <SymbolView name="plus" size={18} weight="semibold" tintColor={c.ink} />
    </Pressable>
  );
}


/** A workout: tap to open; swipe to delete (asks first); hold for the menu. */
function WorkoutRow({ workout }: { workout: HistoryWorkout }) {
  const c = useBlanc();
  const title = historyWorkoutTitle(workout);
  const progress = progressFromSets(workout.sets);
  const durationMs = getWorkoutDurationMs(workout);
  const duration = formatWorkoutDuration(durationMs);
  const sets = progress.completed ? `${progress.totalSets} sets` : `${progress.completedSets} of ${progress.totalSets} sets`;
  const detail = [duration === '—' ? null : duration, progress.totalSets > 0 ? sets : 'No sets'].filter(Boolean).join(' · ');
  const spoken = [title, durationMs ? spokenMinutes(durationMs / 1000) : null, progress.totalSets > 0 ? sets : 'No sets']
    .filter(Boolean)
    .join(', ');
  const open = () => router.push({ pathname: '/train/past', params: { id: workout.id } });
  const remove = () => void confirmDeleteWorkout(title, workout.id, { onDeleted: () => announce(`${title} deleted`) });
  const menu: MenuAction[] = [
    { title: 'Open', symbol: 'arrow.up.right.square', run: open },
    { title: 'Delete workout', symbol: 'trash', destructive: true, run: remove },
  ];

  return (
    <SwipeRow name={title} actions={[{ label: 'Delete', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row title={title} detail={detail} chevron onPress={open} menu={menu} accessibilityLabel={spoken} />
      </View>
    </SwipeRow>
  );
}

/** "7:05 AM · 45m · 3.10 mi · Strain 12.3"; `spoken` gives the length in words for VoiceOver. */
function activityDetail(activity: ActivitySession, spoken = false): string {
  const duration = formatActivityDuration(activity.duration_seconds);
  return [
    formatActivityStartTime(activity.started_at),
    duration === '-' ? null : spoken ? spokenMinutes(activity.duration_seconds ?? 0) : duration,
    formatDistanceMi(activity.distance_m),
    activity.strain != null ? `Strain ${activity.strain.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** An activity: tap to open it; swipe to merge or delete (asks first); hold for the menu. */
function ActivityRow({ activity, sameDay }: { activity: ActivitySession; sameDay: ActivitySession[] }) {
  const c = useBlanc();
  const title = resolveActivityTitle(activity);
  const others = sameDay.filter((entry) => entry.id !== activity.id);
  const open = () => router.push({ pathname: '/train/activity-view', params: { id: activity.id } });
  const edit = () => router.push({ pathname: '/activity', params: { id: activity.id } });
  const remove = () => void confirmDeleteActivity(activity, { onDeleted: () => announce(`${title} deleted`) });
  // The day's other activities, to merge one WHOOP split into several.
  const mergeChoices: MenuAction[] = others.map((entry) => ({
    title: resolveActivityTitle(entry),
    subtitle: (entry.started_at && formatActivityStartTime(entry.started_at)) || undefined,
    run: () =>
      void mergeActivities([activity, entry]).then((ok) => {
        if (ok) haptics.success();
        else {
          haptics.error();
          Alert.alert('Not merged', 'Check your connection and try again.');
        }
      }),
  }));
  const merge = () =>
    showActionSheet(
      `Merge ${title} with`,
      mergeChoices.map((choice) => ({ ...choice, title: choice.subtitle ? `${choice.title} · ${choice.subtitle}` : choice.title })),
      'For one session WHOOP recorded as several.',
    );
  const menu: MenuAction[] = [
    { title: 'Open', symbol: 'arrow.up.right.square', run: open },
    { title: 'Edit', symbol: 'pencil', run: edit },
    ...(others.length > 0 ? [{ title: 'Merge with', symbol: 'arrow.triangle.merge', children: mergeChoices }] : []),
    { title: 'Delete', symbol: 'trash', destructive: true, run: remove },
  ];

  const detail = activityDetail(activity);
  return (
    <SwipeRow
      name={title}
      actions={[...(others.length > 0 ? [{ label: 'Merge', onPress: merge }] : []), { label: 'Delete', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row
          title={title}
          detail={detail || undefined}
          chevron
          onPress={open}
          menu={menu}
          accessibilityLabel={[title, activityDetail(activity, true)].filter(Boolean).join(', ')}
        />
      </View>
    </SwipeRow>
  );
}
