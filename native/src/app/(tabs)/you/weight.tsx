import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel, pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import type { BodyWeightMeasurement } from '@/lib/healthWeights';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { DEFAULT_WEIGHT_RANGE, WEIGHT_RANGES, weightRange, type WeightRangeKey } from '@/lib/weightHistory';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { HoldMenu, hasHoldMenu, menuAccessibility, showActionSheet, type MenuAction } from '~/components/HoldMenu';
import { Label } from '~/components/Label';
import { RollingText } from '~/components/RollingText';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { TabScroll } from '~/components/TabScroll';
import { measuredLabel, WeighInRows } from '~/components/WeighInRows';
import { WeightChart } from '~/components/WeightChart';
import { announce, speak, useAnnounce, useLargeText } from '~/lib/accessibility';
import { useCurrentDayKey } from '~/lib/accountData';
import { haptics } from '~/lib/haptics';
import { figureLayout, rowLayout } from '~/lib/motion';
import { bodyWeightLine, weightRangeSummary } from '~/lib/weightRate';
import { deleteWeighIn, loadWeights, setWeightUnit, useAllWeighIns, useHealthStore, usePullRefresh, useWeightStore } from '~/lib/you';
import { figureLead, restingFigure, space } from '~/theme/blanc';

const RECENT = 6;

const readAll = () => loadWeights({ all: true });

/**
 * Deletes a typed weigh-in as its row in Recent or All weigh-ins does, with
 * no question first: it leaves at once (the figure moves to the one before),
 * and comes back with an alert if the delete fails.
 */
function removeWeighIn(entry: BodyWeightMeasurement) {
  void deleteWeighIn(entry).then((deleted) => {
    if (deleted) {
      haptics.success();
      // The figure changes under VoiceOver's focus.
      announce('Weigh-in deleted');
    } else {
      haptics.error();
      Alert.alert('Not deleted', 'Check your connection and try again.');
    }
  });
}

/**
 * Body weight: the latest weigh-in, the smoothed trend over a month, three
 * months, six, a year or everything, and the weigh-ins before the latest,
 * which lead to every one.
 */
export default function WeightScreen() {
  const history = useWeightStore((state) => state.history);
  const loading = useWeightStore((state) => state.loading);
  const failed = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  const health = useHealthStore((state) => state.enabled);
  // Every weigh-in once the full read lands; the recent ones until then.
  const everything = useAllWeighIns();
  // The full read failed before one ever landed: only the recent weigh-ins are here.
  const olderMissing = useWeightStore((state) => state.allFailed && state.all === null);
  const entries = everything ?? history;
  // The line drawn looks both ways from each day, so it runs through the
  // weigh-ins instead of trailing them; the change above it reads the same line.
  const { trend, line } = useMemo(() => bodyWeightLine(entries), [entries]);
  const latest = entries[0] ?? null;
  // The figure is the latest weigh-in, so Recent starts at the one before it.
  const recent = entries.slice(1, 1 + RECENT);
  const [rangeKey, setRangeKey] = useState<WeightRangeKey>(DEFAULT_WEIGHT_RANGE);
  const range = weightRange(rangeKey);
  // Handed to the rows and the chart, so "Today" and the range move on at midnight.
  const todayKey = useCurrentDayKey();
  // The chart's resting line: "+4.1 lb since Aug 7 · +0.3 lb/wk", the rate
  // averaged over the same days, at a summary's one decimal. You's card reads
  // the default range the same way. Gaining reads like losing, in ink:
  // whether it's good is the goal's to say.
  const { calendar, change, rate: rateLabel } = useMemo(
    () => weightRangeSummary(line, range.days, todayKey, unit),
    [line, range.days, todayKey, unit],
  );
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

  // The latest weigh-in holds for what its row would offer, since Recent starts
  // after it. A typed one can be deleted; Apple Health's stay in Health.
  const heroMenu: MenuAction[] =
    latest?.source === 'manual'
      ? [{ title: 'Delete weigh-in', symbol: 'trash', destructive: true, removes: true, run: () => removeWeighIn(latest) }]
      : [];
  const held = heroMenu.length > 0 ? menuAccessibility(heroMenu) : null;

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
            {/* The figure is where a weigh-in starts: a tap logs the next one; a hold offers the latest's own Delete, as its row would. */}
            {/* The lifted figure keeps a little room around it, which the margins give back so it stays where it was. */}
            <HoldMenu actions={heroMenu} style={{ alignSelf: 'flex-start', marginHorizontal: -HERO_ROOM.x, marginVertical: -HERO_ROOM.y }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={speak(`Body weight ${formatWeight(Number(latest.kilograms), unit)} ${unit}, ${measuredLabel(latest, todayKey)}`)}
                accessibilityHint="Logs a weigh-in"
                accessibilityActions={held ? held.actions : undefined}
                onAccessibilityAction={(event) => held?.run(event.nativeEvent.actionName)}
                onPress={() => {
                  haptics.tap();
                  router.push('/log-weight');
                }}
                // A build without iOS's context menu shows the same choice as a sheet.
                onLongPress={
                  held && !hasHoldMenu
                    ? () => {
                        haptics.select();
                        showActionSheet(undefined, heroMenu);
                      }
                    : undefined
                }
                style={({ pressed }) => ({ paddingHorizontal: HERO_ROOM.x, paddingVertical: HERO_ROOM.y, opacity: pressed ? 0.45 : 1 })}>
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
            </HoldMenu>
            {refreshFailed ? (
              <BlancText variant="footnote" tone="live" style={{ marginTop: 4 }} accessibilityRole="alert">
                {refreshFailed}
              </BlancText>
            ) : null}
          </View>
        ) : !settled ? (
          <ActivityIndicator style={{ marginTop: 40 }} />
        ) : (
          <Label style={{ marginTop: 12, padding: 18, paddingRight: 16, gap: 14 }}>
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
            <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={{ marginHorizontal: space.inset }}>
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
            <Label style={{ marginTop: 12, padding: 18, paddingRight: 16, paddingBottom: 12 }}>
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

        {/* All weigh-ins is always offered: the latest one's row, and its Delete, are there now. Row plays the tap's haptic itself. */}
        {latest ? (
          <Animated.View layout={rowLayout}>
            {recent.length > 0 ? (
              <Section title="Recent">
                <WeighInRows
                  entries={recent}
                  unit={unit}
                  todayKey={todayKey}
                  footer={<Row title="All weigh-ins" chevron onPress={() => router.push('/you/weigh-ins')} />}
                />
              </Section>
            ) : (
              // One weigh-in: the figure above is all Recent would list.
              <Label style={{ marginTop: space.section }}>
                <Row title="All weigh-ins" chevron onPress={() => router.push('/you/weigh-ins')} />
              </Label>
            )}
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

/** The room around the figure when a hold lifts it, in points. */
const HERO_ROOM = { x: 12, y: 8 } as const;

/** Two segments of about the chart range's width (five across a card, some 70 pt each). */
const UNIT_CONTROL_WIDTH = 140;

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
      {/* The chart range's segmented control, at the row's trailing edge: the host gives
          it its width (a host that matches its contents both ways shrinks a segmented
          control to its smallest), its segments about as wide as the range's. At the
          accessibility text sizes it spans the row under its label, as the range spans the card. */}
      <Host ignoreSafeArea="all" matchContents={{ vertical: true }} style={large ? { alignSelf: 'stretch' } : { width: UNIT_CONTROL_WIDTH }}>
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
