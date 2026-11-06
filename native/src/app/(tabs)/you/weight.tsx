import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import {
  DEFAULT_WEIGHT_RANGE,
  WEIGHT_RANGES,
  weightChangeLabel,
  weightChartWindow,
  weightRange,
  weightHistoryTrend,
  weightRangeKgPerWeek,
  type WeightRangeKey,
} from '@/lib/weightHistory';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { measuredLabel, WeighInRows } from '~/components/WeighInRows';
import { WeightChart } from '~/components/WeightChart';
import { speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { figureLayout, rowLayout } from '~/lib/motion';
import { summaryRateLabel } from '~/lib/weightRate';
import { centredTrendLine } from '~/lib/weightTrendLine';
import { loadWeights, setWeightUnit, useAllWeighIns, useHealthStore, usePullRefresh, useWeightStore } from '~/lib/you';
import { figureLead, restingFigure, space } from '~/theme/blanc';

const RECENT = 6;

const readAll = () => loadWeights({ all: true });

/**
 * Body weight: the latest weigh-in, the smoothed trend over a month, three
 * months, six, a year or everything, and the recent log, which leads to
 * every weigh-in.
 */
export default function WeightScreen() {
  const history = useWeightStore((state) => state.history);
  const loading = useWeightStore((state) => state.loading);
  const failed = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  const health = useHealthStore((state) => state.enabled);
  // Every weigh-in once the full read lands; the recent ones until then.
  const everything = useAllWeighIns();
  const allRead = useWeightStore((state) => state.all !== null);
  // The full read failed before one ever landed: only the recent weigh-ins are here.
  const olderMissing = useWeightStore((state) => state.allFailed && state.all === null);
  const entries = everything ?? history;
  const trend = useMemo(() => weightHistoryTrend(entries), [entries]);
  // The line drawn looks both ways from each day, so it runs through the
  // weigh-ins instead of trailing them; the change above it reads the same line.
  const line = useMemo(() => centredTrendLine(trend.points), [trend.points]);
  const latest = entries[0] ?? null;
  const [rangeKey, setRangeKey] = useState<WeightRangeKey>(DEFAULT_WEIGHT_RANGE);
  const range = weightRange(rangeKey);
  // Handed to the rows and the chart, so "Today" and the range move on at midnight.
  const todayKey = useCurrentDayKey();
  const calendar = useMemo(() => weightChartWindow(line, range.days, todayKey), [line, range.days, todayKey]);
  // The chart's resting line: "+4.1 lb since Aug 7 · +0.3 lb/wk", the
  // rate averaged over the same days, at a summary's one decimal (as You's card). Gaining reads like losing, in ink:
  // whether it's good is the goal's to say.
  const change = weightChangeLabel(calendar.series, unit);
  const rateLabel = summaryRateLabel(weightRangeKgPerWeek(calendar.series), unit);
  const trendLine = change
    ? // The dot stays with the words before it when the line wraps at the largest text sizes.
      [change, rateLabel].filter(Boolean).join('\u00a0· ')
    : calendar.series.length === 0
      ? `No weigh-ins in the last ${range.spoken}`
      : undefined;
  const { refreshing, refresh } = usePullRefresh(readAll);
  const large = useLargeText();
  // Missing history matters more than a stale refresh: the chart's All would look complete.
  const refreshFailed = !latest
    ? null
    : olderMissing
      ? 'Couldn’t load your older weigh-ins. Pull down to try again.'
      : failed
        ? 'Couldn’t refresh your weigh-ins. Earlier ones are kept.'
        : null;
  // The failure arrives after the screen does (a load, a pull to refresh).
  useAnnounce(refreshFailed);
  // Only the first read shows a spinner; a pull to refresh keeps the page as it is.
  const [settled, setSettled] = useState(!loading);
  if (!settled && !loading) setSettled(true);

  useEffect(() => {
    void readAll();
  }, []);

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Body weight',
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
      <TabScroll refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}>
        {latest ? (
          <View style={{ paddingHorizontal: space.gutter, paddingTop: 12 }}>
            {/* The figure is where a weigh-in starts: a tap logs the next one. */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={speak(`Body weight ${formatWeight(Number(latest.kilograms), unit)} ${unit}, ${measuredLabel(latest, todayKey)}`)}
              accessibilityHint="Logs a weigh-in"
              onPress={() => {
                haptics.tap();
                router.push('/log-weight');
              }}
              style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.45 : 1 })}>
              {/* At the accessibility text sizes the unit may wrap below the capped figure. */}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, ...(large ? { flexWrap: 'wrap', rowGap: 0 } : null) }}>
                <RollingText variant="figure" size={56} style={{ ...restingFigure, marginLeft: figureLead(formatWeight(Number(latest.kilograms), unit), 56, { tabular: false }) }}>
                  {formatWeight(Number(latest.kilograms), unit)}
                </RollingText>
                <Animated.View layout={figureLayout}>
                  <BlancText variant="secondary" tone="graphite">
                    {unit}
                  </BlancText>
                </Animated.View>
              </View>
              <BlancText variant="secondary" tone="graphite">
                {measuredLabel(latest, todayKey)}
              </BlancText>
            </Pressable>
            {refreshFailed ? (
              <BlancText variant="footnote" tone="live" style={{ marginTop: 4 }} accessibilityRole="alert">
                {refreshFailed}
              </BlancText>
            ) : null}
          </View>
        ) : !settled ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Label style={{ marginTop: 12, padding: 18, gap: 14 }}>
            <View style={{ gap: 2 }}>
              {/* Older weigh-ins may be all there is: a failed full read isn't "none yet". */}
              <BlancText variant="headline">{failed || olderMissing ? 'Weight not loaded' : 'No weigh-ins yet'}</BlancText>
              <BlancText variant="secondary" tone="graphite">
                {failed || olderMissing
                  ? 'Your earlier weigh-ins are kept.'
                  : 'Regular weigh-ins show your trend and help adaptive targets.'}
              </BlancText>
            </View>
            {failed || olderMissing ? (
              <Capsule title="Try again" fill busy={loading} onPress={() => void readAll()} />
            ) : (
              <Capsule title="Log weight" size="large" fill onPress={() => router.push('/log-weight')} />
            )}
          </Label>
        )}

        {/* Two days weighed draw a line, mis-reads or not: the dots show which is which. */}
        {trend.observedDayCount >= 2 ? (
          <View style={{ marginTop: 24 }}>
            {/* How far back the chart looks, as Health's own charts choose it. */}
            <Host matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset }}>
              <Picker
                selection={rangeKey}
                onSelectionChange={(next) => {
                  if (next === rangeKey) return;
                  haptics.select();
                  setRangeKey(next as WeightRangeKey);
                }}
                modifiers={[pickerStyle('segmented'), accessibilityLabel('Chart range')]}>
                {WEIGHT_RANGES.map((option) => (
                  <SwiftText key={option.key} modifiers={[tag(option.key), accessibilityLabel(option.key === 'all' ? 'All time' : `Last ${option.spoken}`)]}>
                    {option.label}
                  </SwiftText>
                ))}
              </Picker>
            </Host>
            <Label style={{ marginTop: 12, padding: 18, paddingBottom: 12 }}>
              <WeightChart
                points={line}
                calendar={calendar}
                span={range.key !== 'all' ? `last ${range.spoken}` : olderMissing ? 'recent weigh-ins only' : 'since the first weigh-in'}
                unit={unit}
                height={168}
                summary={trendLine}
              />
            </Label>
          </View>
        ) : null}

        {entries.length > 0 ? (
          <Animated.View layout={rowLayout}>
            <Section title="Recent">
              <WeighInRows
                entries={entries.slice(0, RECENT)}
                unit={unit}
                todayKey={todayKey}
                footer={
                  // Until every weigh-in is read, there may be more than these.
                  !allRead || entries.length > RECENT ? (
                    // Row plays the tap's haptic itself.
                    <Row title="All weigh-ins" chevron onPress={() => router.push('/you/weigh-ins')} />
                  ) : undefined
                }
              />
            </Section>
          </Animated.View>
        ) : null}

        {/* Slides up with the list as a weigh-in leaves it. */}
        <Animated.View layout={rowLayout}>
          <Label style={{ marginTop: space.section }}>
            <UnitRow unit={unit} />
            <Hairline />
            <Row title="Apple Health" value={health ? 'On' : 'Off'} chevron onPress={() => router.push('/you/connections')} />
          </Label>
        </Animated.View>
      </TabScroll>
    </>
  );
}

function UnitRow({ unit }: { unit: WeightUnit }) {
  // At the accessibility text sizes the switch sits under its label.
  const large = useLargeText();
  return (
    <View
      style={
        large
          ? { alignItems: 'flex-start', minHeight: 60, paddingVertical: 12, paddingLeft: 18, paddingRight: 16, gap: 8 }
          : { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingLeft: 18, paddingRight: 16, gap: 12 }
      }>
      <BlancText variant="bodyStrong" style={large ? undefined : { flex: 1 }}>
        Units
      </BlancText>
      <Host matchContents style={{ width: 120 }}>
        <Picker
          selection={unit}
          onSelectionChange={(next) => {
            if (next === unit) return;
            haptics.select();
            setWeightUnit(next as WeightUnit);
          }}
          modifiers={[pickerStyle('segmented')]}>
          <SwiftText modifiers={[tag('lb'), accessibilityLabel('Pounds')]}>lb</SwiftText>
          <SwiftText modifiers={[tag('kg'), accessibilityLabel('Kilograms')]}>kg</SwiftText>
        </Picker>
      </Host>
    </View>
  );
}
