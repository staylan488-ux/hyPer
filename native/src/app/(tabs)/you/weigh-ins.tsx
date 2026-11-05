import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated from 'react-native-reanimated';

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

// Rows drawn at first, and added each time the end of the list comes near:
// years of weigh-ins don't all render at once.
const ROWS_PER_PAGE = 90;
const NEAR_END = 900;

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
  const [budget, setBudget] = useState(ROWS_PER_PAGE);
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

  // Whole months, until the rows drawn reach the budget.
  const { shown, rows } = useMemo(() => wholeMonths(months, budget), [months, budget]);
  const more = shown.length < months.length;
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
            <Animated.View key={month.key} exiting={blockExit} layout={rowLayout}>
              <Section
                title={month.title}
                note={month.averageKg === null ? undefined : `avg ${formatWeight(month.averageKg, unit)} ${unit}`}
                style={index === 0 ? { marginTop: 12 } : undefined}>
                <WeighInRows entries={month.entries} unit={unit} todayKey={todayKey} />
              </Section>
            </Animated.View>
          ))
        )}
      </TabScroll>
    </>
  );
}

/** The first months whose rows reach `budget`, and how many rows they hold. */
function wholeMonths<M extends { entries: unknown[] }>(months: M[], budget: number) {
  let rows = 0;
  let count = 0;
  while (count < months.length && rows < budget) {
    rows += months[count].entries.length;
    count += 1;
  }
  return { shown: months.slice(0, count), rows };
}
