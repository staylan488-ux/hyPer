import { format, parseISO } from 'date-fns';
import { useMemo, useState } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { indexAtX, linearScale, monotonePath, paddedDomain, xAtIndex } from '@/lib/chartGeometry';
import { kgToUnit, type WeightUnit } from '@/lib/weightDisplayCore';
import type { WeightTrendPoint } from '@/lib/weightTrend';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

const PAD_Y = 8;

/**
 * The smoothed body-weight line with the day's weigh-ins as dots (a mis-read
 * hollow). The full chart reads any day: tap it (tap that day again to let
 * go), or hold and slide; VoiceOver swipes up and down through the days. The
 * compact one is a quiet sparkline.
 */
export function WeightChart({
  points,
  days,
  unit,
  height,
  compact,
  summary,
}: {
  points: WeightTrendPoint[];
  days: number;
  unit: WeightUnit;
  height: number;
  compact?: boolean;
  /** The readout line when no day is selected. */
  summary?: string;
}) {
  const c = useBlanc();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const series = useMemo(() => points.slice(-days), [points, days]);

  const geometry = useMemo(() => {
    if (series.length < 2 || width <= 0) return null;
    const toUnit = (kg: number) => kgToUnit(kg, unit);
    const values = series.flatMap((point) => [
      toUnit(point.ewmaKg),
      ...(point.observedKg != null ? [toUnit(point.observedKg)] : []),
    ]);
    const y = linearScale(paddedDomain(values, 0.14, unit === 'lb' ? 2 : 1), [height - PAD_Y, PAD_Y]);
    const x = (index: number) => xAtIndex(index, width, series.length, 'point');
    const line = series.map((point, index) => ({ x: x(index), y: y(toUnit(point.ewmaKg)) }));
    const dots = series.flatMap((point, index) =>
      point.observedKg == null ? [] : [{ index, x: x(index), y: y(toUnit(point.observedKg)), outlier: point.isOutlier }],
    );
    return { line, path: monotonePath(line), dots };
  }, [series, width, height, unit]);

  if (series.length < 2) return null;

  const choose = (index: number) =>
    setActive((current) => {
      if (current !== index) haptics.select();
      return index;
    });
  const select = (x: number) => {
    const index = indexAtX(x, width, series.length, 'point');
    if (index !== null) choose(index);
  };
  // A tap on the day already read puts the summary back.
  const tap = (x: number) => {
    const index = indexAtX(x, width, series.length, 'point');
    if (index === null) return;
    setActive((current) => {
      haptics.select();
      return current === index ? null : index;
    });
  };
  // VoiceOver: the first swipe reads the latest day, then one day at a time.
  const step = (direction: 1 | -1) => {
    const last = series.length - 1;
    setActive((current) => {
      const next = current === null ? last : Math.min(last, Math.max(0, current + direction));
      if (next !== current) haptics.select();
      return next;
    });
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

  const selected = active !== null ? series[active] : null;
  const readout = selected
    ? `${format(parseISO(selected.date), 'EEE, MMM d')} · ${
        selected.observedKg != null ? `weighed ${kgToUnit(selected.observedKg, unit).toFixed(1)} · ` : ''
      }trend ${kgToUnit(selected.ewmaKg, unit).toFixed(1)} ${unit}`
    : summary;
  const activePoint = active !== null && geometry ? geometry.line[active] : null;

  const chart = (
    <View
      style={{ height }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Body weight trend, last ${series.length} days`}
      {...(compact
        ? {}
        : {
            accessibilityRole: 'adjustable' as const,
            accessibilityValue: { text: readout ?? '' },
            accessibilityActions: [{ name: 'increment' }, { name: 'decrement' }],
            onAccessibilityAction: (event: AccessibilityActionEvent) => {
              if (event.nativeEvent.actionName === 'increment') step(1);
              if (event.nativeEvent.actionName === 'decrement') step(-1);
            },
          })}>
      {geometry ? (
        <Svg width={width} height={height} style={{ overflow: 'visible' }}>
          {compact ? null : <Line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke={c.hairline} strokeWidth={1} />}
          {geometry.dots.map((dot) => (
            <Circle
              key={dot.index}
              cx={dot.x}
              cy={dot.y}
              r={compact ? 1.5 : 2.5}
              fill={dot.outlier ? 'none' : c.graphite}
              stroke={dot.outlier ? c.graphite : 'none'}
              strokeWidth={1}
              opacity={compact ? 0.45 : 0.6}
            />
          ))}
          <Path d={geometry.path} stroke={c.ink} strokeWidth={compact ? 1.5 : 2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          {activePoint ? (
            <>
              <Line x1={activePoint.x} x2={activePoint.x} y1={0} y2={height} stroke={c.hairline} strokeWidth={1} />
              <Circle cx={activePoint.x} cy={activePoint.y} r={4.5} fill={c.ink} stroke={c.label} strokeWidth={2} />
            </>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );

  return (
    <View>
      {compact ? null : (
        <BlancText
          variant="footnote"
          tone={selected ? 'ink' : 'graphite'}
          numberOfLines={1}
          accessibilityLiveRegion="polite"
          style={{ minHeight: 18, marginBottom: 10, fontVariant: ['tabular-nums'] }}>
          {readout ?? ' '}
        </BlancText>
      )}
      {compact ? chart : <GestureDetector gesture={gesture}>{chart}</GestureDetector>}
    </View>
  );
}
