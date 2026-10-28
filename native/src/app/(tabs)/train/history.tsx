import { addMonths, format, isSameMonth, isToday, parseISO, startOfMonth } from 'date-fns';
import { router, Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { ActionSheetIOS, Alert, Pressable, ScrollView, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { formatDistanceMi } from '@/lib/activityMetrics';
import { formatActivityDuration, formatActivityStartTime, getActivitySessionDateKey, resolveActivityTitle, sortActivitySessionsByStart } from '@/lib/activitySessions';
import { buildCalendarDays, historyDayKey, historyWorkoutTitle, progressFromSets, type HistoryWorkout } from '@/lib/historyMonth';
import { formatWorkoutDuration, getWorkoutDurationMs } from '@/lib/workoutSessions';
import { useAppStore } from '@/stores/appStore';
import type { ActivitySession } from '@/types';
import { BlancText } from '~/components/BlancText';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import {
  confirmDeleteWorkout,
  deleteActivity,
  loadHistoryMonth,
  mergeActivities,
  selectHistoryDay,
  syncActivities,
  useHistoryStore,
  workoutsOnDay,
} from '~/lib/history';
import { isPreviewActive } from '~/platform/previewFlag';
import { useBlanc } from '~/theme/blanc';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  const syncAvailable = isPreviewActive() || Boolean(whoop);

  useEffect(() => {
    void loadHistoryMonth();
    void useAppStore.getState().fetchWhoopConnection();
  }, []);

  const dayWorkouts = useMemo(() => workoutsOnDay(workouts, day), [workouts, day]);
  const dayActivities = useMemo(
    () => sortActivitySessionsByStart(activities.filter((activity) => getActivitySessionDateKey(activity) === day)),
    [activities, day],
  );
  const date = parseISO(day);
  const onToday = isToday(date);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    const message = await syncActivities();
    setSyncing(false);
    if (message === 'Sync failed' || message === 'Sync unavailable') haptics.error();
    else haptics.success();
    Alert.alert(message);
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
      <TabScroll>
        <Calendar month={month} day={day} workouts={workouts} activities={activities} />

        <Section
          title={format(date, 'EEEE, MMMM d')}
          accessory={<AddActivityButton day={day} />}>
          <Label style={{ overflow: 'hidden' }}>
            {loading ? (
              <Row title="Loading…" quiet />
            ) : failed && dayWorkouts.length === 0 && dayActivities.length === 0 ? (
              <Row title="Couldn't load this month" detail="Tap to try again" quiet onPress={() => void loadHistoryMonth()} />
            ) : dayWorkouts.length === 0 && dayActivities.length === 0 ? (
              <Row title="Nothing logged" quiet />
            ) : null}
            {!loading &&
              dayWorkouts.map((workout, index) => (
                <Animated.View key={workout.id} entering={FadeIn.duration(160)} exiting={FadeOut.duration(180)} layout={LinearTransition.duration(220)}>
                  {index > 0 ? <Hairline /> : null}
                  <WorkoutRow workout={workout} />
                </Animated.View>
              ))}
            {!loading &&
              dayActivities.map((activity, index) => (
                <Animated.View key={activity.id} entering={FadeIn.duration(160)} exiting={FadeOut.duration(180)} layout={LinearTransition.duration(220)}>
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
function Calendar({ month, day, workouts, activities }: { month: Date; day: string; workouts: HistoryWorkout[]; activities: ActivitySession[] }) {
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(0);
  const marks = useMemo(() => {
    const lifts = new Set(workouts.map(historyDayKey));
    const other = new Set(activities.map(getActivitySessionDateKey));
    return { lifts, other };
  }, [workouts, activities]);
  const pages = useMemo(() => [addMonths(month, -1), month, addMonths(month, 1)], [month]);

  // A new month sits on the middle page; jump there without animation, in the
  // same frame as the new grids, so the turn looks seamless.
  useLayoutEffect(() => {
    if (width > 0) scroller.current?.scrollTo({ x: width, animated: false });
  }, [month, width]);

  // A turned page selects its first day, or today in this month, like Calendar.
  const turn = (step: 1 | -1) => {
    haptics.select();
    const target = startOfMonth(addMonths(month, step));
    selectHistoryDay(isSameMonth(target, new Date()) ? new Date() : target);
  };

  return (
    <Label style={{ marginTop: 6, paddingTop: 6, paddingBottom: 10, overflow: 'hidden' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6 }}>
        <BlancText variant="headline" style={{ flex: 1 }} accessibilityRole="header">
          {format(month, 'MMMM yyyy')}
        </BlancText>
        <MonthArrow symbol="chevron.left" label="Previous month" onPress={() => scroller.current?.scrollTo({ x: 0, animated: true })} />
        <MonthArrow symbol="chevron.right" label="Next month" onPress={() => scroller.current?.scrollTo({ x: width * 2, animated: true })} />
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, marginTop: 4 }} importantForAccessibility="no-hide-descendants">
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
        // Also fires after the arrows' animated scroll.
        onMomentumScrollEnd={(event) => {
          if (width <= 0) return;
          const page = Math.round(event.nativeEvent.contentOffset.x / width);
          if (page !== 1) turn(page === 0 ? -1 : 1);
        }}>
        {pages.map((page, index) => (
          <View key={index} style={{ width: width || undefined }}>
            <MonthGrid month={page} day={day} marks={marks} interactive={index === 1} />
          </View>
        ))}
      </ScrollView>
    </Label>
  );
}

function MonthGrid({ month, day, marks, interactive }: { month: Date; day: string; marks: { lifts: Set<string>; other: Set<string> }; interactive: boolean }) {
  const c = useBlanc();
  const days = useMemo(() => buildCalendarDays(month), [month]);
  return (
    <View
      style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, marginTop: 2 }}
      importantForAccessibility={interactive ? 'auto' : 'no-hide-descendants'}
      accessibilityElementsHidden={!interactive}>
      {days.map((date) => {
        const key = format(date, 'yyyy-MM-dd');
        const selected = key === day;
        const inMonth = isSameMonth(date, month);
        const lift = marks.lifts.has(key);
        const other = marks.other.has(key);
        const today = isToday(date);
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`${format(date, 'EEEE, MMMM d')}${lift ? ', workout' : ''}${other ? ', activity' : ''}`}
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
                style={{
                  fontVariant: ['tabular-nums'],
                  color: selected && inMonth ? c.label : inMonth ? c.ink : c.upcoming,
                  opacity: inMonth ? 1 : 0.55,
                }}>
                {format(date, 'd')}
              </BlancText>
            </View>
            <View style={{ flexDirection: 'row', gap: 3, height: 5, marginTop: 1 }}>
              {lift && inMonth ? <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: c.ink }} /> : null}
              {other && inMonth ? <View style={{ width: 5, height: 5, borderRadius: 2.5, borderWidth: 1, borderColor: c.graphite }} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

function MonthArrow({ symbol, label, onPress }: { symbol: 'chevron.left' | 'chevron.right'; label: string; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
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
  const duration = formatWorkoutDuration(getWorkoutDurationMs(workout));
  const sets = progress.completed ? `${progress.totalSets} sets` : `${progress.completedSets} of ${progress.totalSets} sets`;
  const detail = [duration === '—' ? null : duration, progress.totalSets > 0 ? sets : 'No sets'].filter(Boolean).join(' · ');
  const open = () => router.push({ pathname: '/train/past', params: { id: workout.id } });
  const remove = () => confirmDeleteWorkout(title, workout.id);
  const menu = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: ['Open', 'Delete workout', 'Cancel'], cancelButtonIndex: 2, destructiveButtonIndex: 1 },
      (index) => {
        if (index === 0) open();
        if (index === 1) remove();
      },
    );

  return (
    <SwipeRow name={title} actions={[{ label: 'Delete', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row title={title} detail={detail} chevron onPress={open} onLongPress={{ label: 'More actions', run: menu }} />
      </View>
    </SwipeRow>
  );
}

function activityDetail(activity: ActivitySession): string {
  const duration = formatActivityDuration(activity.duration_seconds);
  return [
    formatActivityStartTime(activity.started_at),
    duration === '-' ? null : duration,
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
  // As on the web, and as workouts do: an activity added by hand is gone for good.
  const remove = () =>
    Alert.alert(`Delete ${title}?`, activity.source === 'whoop' ? 'It is hidden from History; WHOOP will not bring it back.' : 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          void deleteActivity(activity).then((ok) => {
            if (ok) haptics.success();
            else {
              haptics.error();
              Alert.alert('Not deleted', 'Check your connection and try again.');
            }
          }),
      },
    ]);
  const merge = () => {
    const options = [...others.map((entry) => `${resolveActivityTitle(entry)}${entry.started_at ? ` · ${formatActivityStartTime(entry.started_at)}` : ''}`), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions(
      { title: `Merge ${title} with`, message: 'For one session WHOOP recorded as several.', options, cancelButtonIndex: others.length },
      (index) => {
        if (index >= others.length) return;
        void mergeActivities([activity, others[index]]).then((ok) => {
          if (ok) haptics.success();
          else {
            haptics.error();
            Alert.alert('Not merged', 'Check your connection and try again.');
          }
        });
      },
    );
  };
  const menu = () => {
    const actions: { label: string; run: () => void }[] = [{ label: 'Open', run: open }, { label: 'Edit', run: edit }];
    if (others.length > 0) actions.push({ label: 'Merge with…', run: merge });
    actions.push({ label: 'Delete', run: remove });
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...actions.map((action) => action.label), 'Cancel'], cancelButtonIndex: actions.length, destructiveButtonIndex: actions.length - 1 },
      (index) => {
        if (index < actions.length) actions[index].run();
      },
    );
  };

  const detail = activityDetail(activity);
  return (
    <SwipeRow
      name={title}
      actions={[...(others.length > 0 ? [{ label: 'Merge', onPress: merge }] : []), { label: 'Delete', destructive: true, onPress: remove }]}>
      <View style={{ backgroundColor: c.label }}>
        <Row title={title} detail={detail || undefined} chevron onPress={open} onLongPress={{ label: 'More actions', run: menu }} />
      </View>
    </SwipeRow>
  );
}
