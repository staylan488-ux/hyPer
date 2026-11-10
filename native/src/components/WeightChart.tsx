import { format, parseISO } from 'date-fns';
import { useMemo, useState } from 'react';
import { useWindowDimensions, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { indexAtX, linearScale, monotonePath, xAtIndex } from '@/lib/chartGeometry';
import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import { weightChartTicks, type WeightChartPoint, type WeightChartWindow } from '@/lib/weightHistory';
import type { WeightTrendPoint } from '@/lib/weightTrend';
import { speak, spokenUnit, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { sparklineDomain, weightScale } from '~/lib/weightChartScale';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

// The full chart's top scale line sits this far down, so its label draws whole.
const PAD_Y = 8;
// The sparkline's room above and below: its end dot's radius and a little more.
const SPARK_PAD_Y = 4;
// The weigh-in dots' largest radius; the lowest one keeps a little more than this above the axis.
const DOT_RADIUS = 2;
// The full chart's days start and end this far in, so the first and last
// day's dots (and the chosen day's ring) draw whole: iOS clips the drawing
// to its frame.
const PAD_X = 6;
// The date axis: a short tick hanging from the baseline, its label beside it.
const TICK = 5;
const AXIS_GAP = 4;
// Axis labels stop growing here, like the big figures; VoiceOver reads the days instead.
const AXIS_MAX_SCALE = 1.3;
// About how wide a footnote character draws, to keep labels from running together.
const AXIS_CHAR = 7.2;
// The weight scale on the right: its column, and the room between it and the line.
const SCALE_COLUMN = 34;
const SCALE_GAP = 8;

/**
 * The smoothed body-weight line in ink with the day's weigh-ins as dots in
 * `mark` at full strength (a mis-read hollow, its ring the same tone): 3:1 or
 * more on the card in every palette, the line leading by its weight. The full chart reads any day: tap it (tap that day again to let
 * go), or hold and slide; VoiceOver swipes up and down through the days. The
 * day read is the chart's value, which VoiceOver speaks as it changes, so the
 * readout line above is hidden from it. Given a `calendar` (Body weight's
 * ranges), the days sit on a calendar axis with dates under it, so the line
 * starts where the weigh-ins do and stops at the last one. The compact one is
 * a quiet sparkline: the line alone, scaled tightly to the line, so a few
 * weeks' trend shows its shape, ending on a dot at the latest trend. The
 * full chart has a quiet weight scale on the right, round weights that
 * enclose every dot with the lowest as the axis, and a key under the dates.
 */
export function WeightChart({
  points,
  days,
  calendar,
  span,
  unit,
  height,
  compact,
  summary,
}: {
  points: WeightTrendPoint[];
  /** Without a calendar: the last this many days of `points`, edge to edge. */
  days?: number;
  /** The calendar days to show, as weightChartWindow gives them. */
  calendar?: WeightChartWindow;
  /** VoiceOver's name for the days shown, after "Body weight trend": "last 3 months". */
  span?: string;
  unit: WeightUnit;
  height: number;
  compact?: boolean;
  /** The readout line when no day is selected. */
  summary?: string;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  // The day read, by date, for the days it was read in: another range starts from its summary.
  const view = calendar ? `${calendar.startDay}/${calendar.slots}` : 'last';
  const [reading, setReading] = useState<{ date: string; view: string } | null>(null);
  const active = reading?.view === view ? reading.date : null;
  const setActive = (update: string | null | ((current: string | null) => string | null)) =>
    setReading((current) => {
      const before = current?.view === view ? current.date : null;
      const date = typeof update === 'function' ? update(before) : update;
      return date === null ? null : { date, view };
    });
  const { slots, series } = useMemo((): { slots: number; series: WeightChartPoint[] } => {
    if (calendar) return { slots: calendar.slots, series: calendar.series };
    const shown = days === undefined ? points : points.slice(-days);
    return { slots: shown.length, series: shown.map((point, index) => ({ ...point, slot: index })) };
  }, [points, days, calendar]);
  const ticks = useMemo(() => (calendar && !compact ? weightChartTicks(calendar.startDay, calendar.slots) : []), [calendar, compact]);

  // The sparkline keeps room for its end dot, so the dot is never cut in half.
  const padX = compact ? 4 : PAD_X;
  // The full chart keeps a column on the right for its scale.
  const plotRight = compact ? width : width - SCALE_COLUMN - SCALE_GAP;
  const plotWidth = Math.max(1, plotRight - 2 * padX);
  const geometry = useMemo(() => {
    if (series.length === 0 || width <= 0) return null;
    const toUnit = (kg: number) => kgToUnit(kg, unit);
    const values = series.flatMap((point) => [
      toUnit(point.ewmaKg),
      // The sparkline holds its weigh-ins too, so they sit inside it.
      ...(point.observedKg != null && !(compact && point.isOutlier) ? [toUnit(point.observedKg)] : []),
    ]);
    // At least 2 lb (1 kg) top to bottom, half that for the sparkline.
    const minSpan = (unit === 'lb' ? 2 : 1) / (compact ? 2 : 1);
    // The full chart's lowest scale line is its axis, on the bottom edge.
    const bottom = height - 0.5;
    const scale = compact ? null : weightScale(values, { minSpan, plotHeight: bottom - PAD_Y, clearance: DOT_RADIUS + 1.5 });
    const domain = scale ? scale.domain : sparklineDomain(values, minSpan);
    const y = linearScale(domain, compact ? [height - SPARK_PAD_Y, SPARK_PAD_Y] : [bottom, PAD_Y]);
    const x = (slot: number) => padX + xAtIndex(slot, plotWidth, slots, 'point');
    // Dots shrink as the days crowd together, so a year reads as a band around the line.
    const radius = Math.max(1.25, Math.min(DOT_RADIUS, (plotWidth / Math.max(1, slots)) * 0.9));
    const line = series.map((point) => ({ x: x(point.slot), y: y(toUnit(point.ewmaKg)) }));
    // The sparkline shows its weigh-ins behind the trend (mis-reads left out), as the full chart does.
    const dots = series.flatMap((point, index) =>
      point.observedKg == null || (compact && point.isOutlier) ? [] : [{ index, x: line[index].x, y: y(toUnit(point.observedKg)), outlier: point.isOutlier }],
    );
    const axis = ticks.map((tick) => ({ ...tick, x: x(tick.slot) }));
    const grid = scale ? scale.ticks.map((value, index) => ({ value, y: y(value), axis: index === 0, label: value.toFixed(scale.step < 1 ? 1 : 0) })) : [];
    // A long break leaves the days without a line: it stops there and starts again.
    const runs: Array<typeof line> = [];
    series.forEach((point, index) => {
      if (index === 0 || point.slot - series[index - 1].slot > 1) runs.push([]);
      runs[runs.length - 1].push(line[index]);
    });
    return { line, path: runs.map(monotonePath).join(''), dots, radius, axis, grid };
  }, [series, slots, width, plotWidth, padX, height, unit, compact, ticks]);

  // A label may run on past the plot's edge into the gap before the weight
  // scale, so the month a range runs into (Nov 1 on a 3M range ending Nov 6)
  // is named; one that would reach the scale's column, under its lowest
  // figure, or run into the label before it is left out.
  const axisLabels = useMemo(() => {
    if (!geometry) return [];
    const char = AXIS_CHAR * Math.min(fontScale, AXIS_MAX_SCALE);
    const room = plotRight + SCALE_GAP;
    const shown: Array<{ slot: number; label: string; x: number }> = [];
    let end = -Infinity;
    for (const tick of geometry.axis) {
      const right = tick.x + AXIS_GAP + tick.label.length * char;
      if (tick.x < end + 8 || right > room) continue;
      shown.push(tick);
      end = right;
    }
    return shown;
  }, [geometry, fontScale, plotRight]);

  // Without a calendar the chart needs two days; with one, an empty range still shows its days.
  if (series.length < (calendar && !compact ? 0 : 2)) return null;

  const indexOfActive = active === null ? -1 : series.findIndex((point) => point.date === active);
  const choose = (index: number) =>
    setActive((current) => {
      const date = series[index].date;
      if (current !== date) haptics.select();
      return date;
    });
  // The day under a finger, or the nearest one with the line: before its first day, after its last or in a break.
  const indexAt = (x: number) => {
    const slot = indexAtX(x - padX, plotWidth, slots, 'point');
    if (slot === null || series.length === 0) return null;
    return nearestSlot(series, slot);
  };
  const select = (x: number) => {
    const index = indexAt(x);
    if (index !== null) choose(index);
  };
  // A tap on the day already read puts the summary back.
  const tap = (x: number) => {
    const index = indexAt(x);
    if (index === null) return;
    const date = series[index].date;
    setActive((current) => {
      haptics.select();
      return current === date ? null : date;
    });
  };
  // VoiceOver: the first swipe reads the latest day, then one day at a time.
  const step = (direction: 1 | -1) => {
    if (series.length === 0) return;
    const last = series.length - 1;
    const next = indexOfActive === -1 ? last : Math.min(last, Math.max(0, indexOfActive + direction));
    if (next !== indexOfActive) haptics.select();
    setActive(series[next].date);
  };
  // A tap reads one day; holding then sliding reads day by day. Sliding
  // straight away is left to the page (scrolling, or iOS's swipe back).
  const gesture = Gesture.Exclusive(
    Gesture.Pan()
      .activateAfterLongPress(160)
      .runOnJS(true)
      .onStart((event) => select(event.x))
      .onUpdate((event) => select(event.x))
      // End, not finalize: finalize also runs when a plain tap fails the
      // hold, and would clear the day the tap just chose.
      .onEnd(() => setActive(null)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((event) => tap(event.x)),
  );

  const selected = indexOfActive >= 0 ? series[indexOfActive] : null;
  // A year or more back, the day names its year too.
  const yearly = slots > 330;
  const readout = selected
    ? // Each dot stays with the words before it when the line wraps at the largest text sizes.
      `${format(parseISO(selected.date), yearly ? 'MMM d, yyyy' : 'EEE, MMM d')}\u00a0· ${
        selected.observedKg != null ? `weighed ${kgToUnit(selected.observedKg, unit).toFixed(1)}\u00a0· ` : ''
      }trend ${kgToUnit(selected.ewmaKg, unit).toFixed(1)} ${unit}`
    : summary;
  // The same day in words. With no day chosen it reads the summary (the
  // change and its weekly rate), and the hint tells VoiceOver how to start.
  const spokenReadout = selected
    ? `${format(parseISO(selected.date), yearly ? 'MMMM d, yyyy' : 'EEEE, MMMM d')}, ${
        selected.observedKg != null ? `weighed ${kgToUnit(selected.observedKg, unit).toFixed(1)} ${spokenUnit(unit)}, ` : ''
      }trend ${kgToUnit(selected.ewmaKg, unit).toFixed(1)} ${spokenUnit(unit)}`
    : speak(summary ?? '');
  const activePoint = indexOfActive >= 0 && geometry ? geometry.line[indexOfActive] : null;
  const axisHeight = Math.ceil(18 * Math.min(fontScale, AXIS_MAX_SCALE)) + AXIS_GAP;

  const chart = (
    <View
      style={{ height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Body weight trend, ${span ?? `last ${series.length} days`}`}
      {...(compact
        ? {}
        : {
            accessibilityRole: 'adjustable' as const,
            accessibilityHint: series.length > 0 ? 'Swipe up or down to read a day.' : undefined,
            accessibilityValue: { text: spokenReadout },
            accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
            onAccessibilityAction: (event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === 'increment') step(1);
              if (event.nativeEvent.actionName === 'decrement') step(-1);
            },
          })}>
      {width > 0 ? (
        <Svg width={width} height={height} style={{ overflow: 'visible' }}>
          {/* The lowest scale line is the axis the dates hang from; a range with no weigh-ins keeps the axis alone. */}
          {!compact && !geometry ? <Line x1={0} x2={plotRight} y1={height - 0.5} y2={height - 0.5} stroke={c.hairline} strokeWidth={1} /> : null}
          {geometry?.grid.map((tick) => (
            <Line key={tick.value} x1={0} x2={plotRight} y1={tick.y} y2={tick.y} stroke={c.hairline} strokeWidth={tick.axis ? 1 : 0.5} />
          ))}
          {geometry?.dots.map((dot) => (
            <Circle
              key={dot.index}
              cx={dot.x}
              cy={dot.y}
              r={compact ? 1.25 : geometry.radius}
              fill={dot.outlier ? 'none' : c.mark}
              stroke={dot.outlier ? c.mark : 'none'}
              strokeWidth={1}
            />
          ))}
          {geometry && geometry.line.length > 1 ? (
            <Path d={geometry.path} stroke={c.ink} strokeWidth={compact ? 1.5 : 2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          {compact && geometry ? (
            <Circle cx={geometry.line[geometry.line.length - 1].x} cy={geometry.line[geometry.line.length - 1].y} r={3} fill={c.ink} />
          ) : null}
          {activePoint ? (
            <>
              <Line x1={activePoint.x} x2={activePoint.x} y1={0} y2={height} stroke={c.hairline} strokeWidth={1} />
              <Circle cx={activePoint.x} cy={activePoint.y} r={4.5} fill={c.ink} stroke={c.ground} strokeWidth={2} />
            </>
          ) : null}
        </Svg>
      ) : null}
      {/* The weight scale, for sight; VoiceOver reads each day's weight instead. */}
      {geometry?.grid.map((tick) => (
        <View
          key={tick.value}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ position: 'absolute', right: 0, width: SCALE_COLUMN, top: tick.y - 8, height: 16, justifyContent: 'center' }}>
          <BlancText
            variant="footnote"
            tone="graphite"
            size={12}
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={AXIS_MAX_SCALE}
            style={{ textAlign: 'right', fontVariant: ['tabular-nums'] }}>
            {tick.label}
          </BlancText>
        </View>
      ))}
    </View>
  );

  return (
    <View>
      {compact ? null : (
        <BlancText
          variant="footnote"
          tone={selected ? 'ink' : 'graphite'}
          numberOfLines={large ? undefined : 1}
          accessibilityElementsHidden
          importantForAccessibility="no"
          style={{ minHeight: 18, marginBottom: 10, fontVariant: ['tabular-nums'] }}>
          {readout ?? ' '}
        </BlancText>
      )}
      {compact ? chart : <GestureDetector gesture={gesture}>{chart}</GestureDetector>}
      {ticks.length > 0 ? (
        // The dates under the line, for sight; VoiceOver reads each day's date instead.
        <View style={{ height: axisHeight }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none">
          {axisLabels.map((tick) => (
            <View key={tick.slot} style={{ position: 'absolute', left: tick.x, top: 0, flexDirection: 'row' }}>
              <View style={{ width: 1, height: TICK, backgroundColor: c.hairline }} />
              <BlancText variant="footnote" tone="graphite" maxFontSizeMultiplier={AXIS_MAX_SCALE} numberOfLines={1} style={{ marginLeft: AXIS_GAP - 1, marginTop: 1 }}>
                {tick.label}
              </BlancText>
            </View>
          ))}
        </View>
      ) : null}
      {compact ? null : (
        // What the marks are, for sight; VoiceOver's day reading names the weigh-in and the trend.
        <View
          style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4, marginTop: 8 }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: c.ink }} />
            <BlancText variant="footnote" tone="graphite">
              Trend
            </BlancText>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 2 * DOT_RADIUS, height: 2 * DOT_RADIUS, borderRadius: DOT_RADIUS, backgroundColor: c.mark }} />
            <BlancText variant="footnote" tone="graphite">
              Weigh-ins
            </BlancText>
          </View>
          {series.some((point) => point.isOutlier) ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 2 * DOT_RADIUS + 1, height: 2 * DOT_RADIUS + 1, borderRadius: DOT_RADIUS + 0.5, borderWidth: 1, borderColor: c.mark }} />
              <BlancText variant="footnote" tone="graphite">
                Mis-read
              </BlancText>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

/** The index of the day nearest `slot` (the earlier on a tie); `series` is sorted by slot. */
function nearestSlot(series: WeightChartPoint[], slot: number): number {
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].slot < slot) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && slot - series[lo - 1].slot <= series[lo].slot - slot ? lo - 1 : lo;
}
