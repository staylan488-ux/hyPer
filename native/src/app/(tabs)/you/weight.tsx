import { Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { pickerStyle, tag } from '@expo/ui/swift-ui/modifiers';
import { format, isToday } from 'date-fns';
import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Pressable, RefreshControl, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { bodyWeightTrends, weeklyRateLabel } from '@/lib/bodyWeightSummary';
import type { BodyWeightMeasurement } from '@/lib/healthWeights';
import { formatWeight, type WeightUnit } from '@/lib/weightDisplayCore';
import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline, Row } from '~/components/Row';
import { Section } from '~/components/Section';
import { SwipeRow } from '~/components/SwipeRow';
import { TabScroll } from '~/components/TabScroll';
import { WeightChart } from '~/components/WeightChart';
import { haptics } from '~/lib/haptics';
import { rowEnter, rowExit, rowLayout } from '~/lib/motion';
import { deleteWeighIn, loadWeights, setWeightUnit, useHealthStore, usePullRefresh, useWeightStore } from '~/lib/you';
import { space, useBlanc } from '~/theme/blanc';

const RECENT = 6;

/** Body weight: the latest weigh-in, the smoothed trend, 90 days and the recent log. */
export default function WeightScreen() {
  const history = useWeightStore((state) => state.history);
  const loading = useWeightStore((state) => state.loading);
  const failed = useWeightStore((state) => state.failed);
  const unit = useWeightStore((state) => state.unit);
  const health = useHealthStore((state) => state.enabled);
  const { trend, rate } = useMemo(() => bodyWeightTrends(history), [history]);
  const latest = history[0] ?? null;
  const rateLabel = weeklyRateLabel(rate.kgPerWeek, unit);
  const showTrend = trend.latestEwmaKg !== null && trend.fittedDayCount >= 2;
  const { refreshing, refresh } = usePullRefresh(loadWeights);

  useEffect(() => {
    void loadWeights();
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
              accessibilityLabel={`Body weight ${formatWeight(Number(latest.kilograms), unit)} ${unit}, ${measuredLabel(latest)}`}
              accessibilityHint="Logs a weigh-in"
              onPress={() => {
                haptics.tap();
                router.push('/log-weight');
              }}
              style={({ pressed }) => ({ alignSelf: 'flex-start', opacity: pressed ? 0.45 : 1 })}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <BlancText variant="figure" size={64}>
                  {formatWeight(Number(latest.kilograms), unit)}
                </BlancText>
                <BlancText variant="secondary" tone="graphite">
                  {unit}
                </BlancText>
              </View>
              <BlancText variant="secondary" tone="graphite">
                {measuredLabel(latest)}
              </BlancText>
            </Pressable>
          </View>
        ) : (
          <Label style={{ marginTop: 12, padding: 18, gap: 14 }}>
            <View style={{ gap: 2 }}>
              <BlancText variant="headline">{loading ? 'Loading' : failed ? 'Weight not loaded' : 'No weigh-ins yet'}</BlancText>
              <BlancText variant="secondary" tone="graphite">
                {failed
                  ? 'Your earlier weigh-ins are kept.'
                  : 'Regular weigh-ins show your trend and help adaptive targets.'}
              </BlancText>
            </View>
            {loading ? null : failed ? (
              <Capsule title="Try again" fill onPress={() => void loadWeights()} />
            ) : (
              <Capsule title="Log weight" size="large" fill onPress={() => router.push('/log-weight')} />
            )}
          </Label>
        )}

        {showTrend || rateLabel ? (
          <Label style={{ marginTop: 24 }}>
            {showTrend ? (
              <Row title="Trend" value={`${formatWeight(trend.latestEwmaKg!, unit)} ${unit}`} detail={`Smoothed over ${trend.observedDayCount} weigh-in${trend.observedDayCount === 1 ? '' : 's'}`} />
            ) : null}
            {showTrend && rateLabel ? <Hairline /> : null}
            {rateLabel ? <Row title="3-week rate" value={rateLabel} /> : null}
          </Label>
        ) : null}

        {trend.fittedDayCount >= 2 ? (
          <Label style={{ marginTop: space.section, padding: 18 }}>
            <WeightChart points={trend.points} days={90} unit={unit} height={168} summary="Tap or hold to read a day" />
          </Label>
        ) : null}

        {history.length > 0 ? (
          <Animated.View layout={rowLayout}>
            <Recent entries={history.slice(0, RECENT)} unit={unit} />
          </Animated.View>
        ) : null}

        {/* Slides up with the list as a weigh-in leaves it. */}
        <Animated.View layout={rowLayout}>
          <Label style={{ marginTop: space.section }}>
            <UnitRow unit={unit} />
            <Hairline />
            <Row title="Apple Health" value={health ? 'On' : 'Off'} chevron onPress={() => router.push('/you/connections')} />
          </Label>
          {failed && latest ? (
            <BlancText variant="footnote" tone="live" style={{ marginHorizontal: 32, marginTop: 8 }} accessibilityRole="alert">
              Couldn’t refresh your weigh-ins. Earlier ones are kept.
            </BlancText>
          ) : null}
        </Animated.View>
      </TabScroll>
    </>
  );
}

function measuredLabel(entry: BodyWeightMeasurement): string {
  const date = new Date(entry.measured_at);
  const when = `${isToday(date) ? 'Today' : format(date, 'MMM d')}, ${format(date, 'h:mm a')}`;
  return entry.source === 'manual' ? when : `${when} · ${entry.source_name}`;
}

/** The latest weigh-ins. A typed one swipes to delete; Health's stay in Health. */
function Recent({ entries, unit }: { entries: BodyWeightMeasurement[]; unit: WeightUnit }) {
  const c = useBlanc();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());

  const remove = (entry: BodyWeightMeasurement) => {
    setLeaving((current) => new Set(current).add(entry.id));
    void deleteWeighIn(entry).then((deleted) => {
      if (deleted) {
        haptics.success();
      } else {
        haptics.error();
        Alert.alert('Not deleted', 'Check your connection and try again.');
      }
      setLeaving((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    });
  };

  const menu = (entry: BodyWeightMeasurement) => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: `${formatWeight(Number(entry.kilograms), unit)} ${unit}`,
        message: measuredLabel(entry),
        options: ['Delete weigh-in', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) remove(entry);
      },
    );
  };

  const shown = entries.filter((entry) => !leaving.has(entry.id));
  return (
    <Section title="Recent">
      <Label style={{ overflow: 'hidden' }} layout={rowLayout}>
        {shown.map((entry, index) => {
          const title = `${formatWeight(Number(entry.kilograms), unit)} ${unit}`;
          const row = (
            <View style={{ backgroundColor: c.label }}>
              <Row
                title={title}
                detail={measuredLabel(entry)}
                onLongPress={entry.source === 'manual' ? { label: 'More actions', run: () => menu(entry) } : undefined}
                onPress={entry.source === 'manual' ? () => menu(entry) : undefined}
              />
            </View>
          );
          return (
            <Animated.View key={entry.id} entering={rowEnter} exiting={rowExit} layout={rowLayout}>
              {index > 0 ? <Hairline /> : null}
              {entry.source === 'manual' ? (
                <SwipeRow name={title} actions={[{ label: 'Delete', destructive: true, onPress: () => remove(entry) }]}>
                  {row}
                </SwipeRow>
              ) : (
                row
              )}
            </Animated.View>
          );
        })}
      </Label>
    </Section>
  );
}

function UnitRow({ unit }: { unit: WeightUnit }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingLeft: 18, paddingRight: 16, gap: 12 }}>
      <BlancText variant="bodyStrong" style={{ flex: 1 }}>
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
          <SwiftText modifiers={[tag('lb')]}>lb</SwiftText>
          <SwiftText modifiers={[tag('kg')]}>kg</SwiftText>
        </Picker>
      </Host>
    </View>
  );
}
