import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated';

import { formatWeight } from '@/lib/weightDisplayCore';
import { weighInsByMonth } from '@/lib/weightHistory';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { WeighInRows } from '~/components/WeighInRows';
import { useAnnounce } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { blockExit, rowLayout } from '~/lib/motion';
import { loadWeights, useAllWeighIns, usePullRefresh, useWeightStore } from '~/lib/you';
import { space } from '~/theme/blanc';

const readAll = () => loadWeights({ all: true });

// Years of weigh-ins don't render at once. The screen opens with about a
// screenful (each row is a swipe row with its own menu, and iOS waits for the
// first draw before sliding the screen in), and more rows are added well
// before the end comes into view.
const FIRST_ROWS = 16;
const ROWS_PER_PAGE = 40;
const NEAR_END = 1_200;

/**
 * All weigh-ins: every one, newest first, by month, each month with its
 * average. A typed weigh-in swipes to delete (a full swipe deletes), holds
 * for the same, or asks on a tap; Apple Health's stay in Health.
 */
export default function WeighInsScreen() {
  const everything = useAllWeighIns();
  const unit = useWeightStore((state) => state.unit);
  const loading = useWeightStore((state) => state.loading);
  const failed = useWeightStore((state) => state.failed);
  const all = useWeightStore((state) => state.all);
  const allFailed = useWeightStore((state) => state.allFailed);
  const todayKey = useCurrentDayKey();
  const months = useMemo(() => weighInsByMonth(everything ?? [], todayKey), [everything, todayKey]);
  const { refreshing, refresh } = usePullRefresh(readAll);
  const [budget, setBudget] = useState(FIRST_ROWS);
  // Only older weigh-ins are missing when the full read failed; a failed refresh keeps the list.
  const note = allFailed
    ? all
      ? 'Couldn’t refresh your weigh-ins. Earlier ones are kept.'
      : 'Couldn’t load your older weigh-ins. Pull down to try again.'
    : null;
  useAnnounce(note);

  useEffect(() => {
    void readAll();
  }, []);

  // The newest rows, up to the budget; a month's average is always its whole month's.
  const { shown, rows, more } = useMemo(() => firstRows(months, budget), [months, budget]);
  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!more) return;
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    // One more page per page drawn, however many scroll events arrive before it is.
    if (contentOffset.y + layoutMeasurement.height > contentSize.height - NEAR_END) setBudget(rows + ROWS_PER_PAGE);
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'All weigh-ins',
          unstable_headerRightItems: () => [
            {
              type: 'button',
              label: 'Log weight',
              icon: { type: 'sfSymbol', name: 'plus' },
              onPress: () => {
                haptics.tap();
                router.push('/log-weight');
              },
            },
          ],
        }}
      />
      <TabScroll onScroll={onScroll} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {note ? (
          <BlancText variant="footnote" tone="live" style={{ marginTop: 12, paddingHorizontal: space.gutter }} accessibilityRole="alert">
            {note}
          </BlancText>
        ) : null}

        {everything === null ? (
          // The first full read; a failed one shows the recent weigh-ins instead.
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : months.length === 0 ? (
          <Label style={{ marginTop: 12, padding: 18, gap: 14 }}>
            <View style={{ gap: 2 }}>
              <BlancText variant="headline">{failed ? 'Weight not loaded' : 'No weigh-ins yet'}</BlancText>
              <BlancText variant="secondary" tone="graphite">
                {failed ? 'Your earlier weigh-ins are kept.' : 'Regular weigh-ins show your trend and help adaptive targets.'}
              </BlancText>
            </View>
            {failed ? (
              <Capsule title="Try again" fill busy={loading} onPress={() => void readAll()} />
            ) : (
              <Capsule title="Log weight" size="large" fill onPress={() => router.push('/log-weight')} />
            )}
          </Label>
        ) : (
          shown.map((month, index) => (
            // A month drawn with the screen or added while scrolling appears as it is; a weigh-in logged later still fades in.
            <LayoutAnimationConfig key={month.key} skipEntering>
              <Animated.View exiting={blockExit} layout={rowLayout}>
                <Section
                  title={month.title}
                  // Kept on one line: "avg 172.4 lb" never breaks inside.
                  note={month.averageKg === null ? undefined : `avg\u00a0${formatWeight(month.averageKg, unit)}\u00a0${unit}`}
                  style={index === 0 ? { marginTop: 12 } : undefined}>
                  <WeighInRows entries={month.entries} unit={unit} todayKey={todayKey} />
                </Section>
              </Animated.View>
            </LayoutAnimationConfig>
          ))
        )}
      </TabScroll>
    </>
  );
}

/** The months holding the newest `budget` rows (the last one cut short), how many rows that is, and whether any are left out. */
function firstRows<M extends { entries: unknown[] }>(months: M[], budget: number) {
  const shown: M[] = [];
  let rows = 0;
  for (const month of months) {
    if (rows >= budget) break;
    const entries = month.entries.slice(0, budget - rows);
    shown.push(entries.length === month.entries.length ? month : { ...month, entries });
    rows += entries.length;
  }
  const total = months.reduce((sum, month) => sum + month.entries.length, 0);
  return { shown, rows, more: rows < total };
}
