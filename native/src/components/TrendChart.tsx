import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { useMemo, useState } from 'react';
import { useWindowDimensions, View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Line, Path } from 'react-native-svg';

import { linearScale, monotonePath } from '@/lib/chartGeometry';
import { speak, useLargeText } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { weightScale } from '~/lib/weightChartScale';
import { useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

// The top scale line sits this far down, so its label draws whole.
const PAD_Y = 8;
// The sessions start and end this far in, so the first and last dots (and the chosen one's ring) draw whole.
const PAD_X = 6;
const DOT_RADIUS = 2.5;
// The scale on the right: its column, and the room between it and the line.
const SCALE_COLUMN = 34;
const SCALE_GAP = 8;
// Axis labels stop growing here, like the big figures; VoiceOver reads each session's date instead.
const AXIS_MAX_SCALE = 1.3;

export type TrendChartPoint = {
  /** yyyy-MM-dd. */
  day: string;
  value: number;
  /** The readout for this point, after its date: "225 lb × 5 · est. max 262 lb". */
  label: string;
};

/**
 * One movement's sessions over time: each session's value as a dot in
 * `mark`, joined by the line in ink, on a calendar axis from the first
 * session to the last, with a quiet scale on the right. It reads one session
 * at a time as Body weight's chart does: tap it (tap it again to let go), or
 * hold and slide; VoiceOver swipes up and down through the sessions.
 */
export function TrendChart({
  points,
  height,
  summary,
  name,
  minSpan,
}: {
  /** Oldest first. */
  points: TrendChartPoint[];
  height: number;
  /** The readout line when no session is chosen. */
  summary: string;
  /** VoiceOver's name for the chart: "Estimated max by session". */
  name: string;
  /** The least the scale spans top to bottom, so a steady lift stays nearly flat. */
  minSpan: number;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const chosen = active !== null && active < points.length ? active : null;

  const plotRight = width - SCALE_COLUMN - SCALE_GAP;
  const plotWidth = Math.max(1, plotRight - 2 * PAD_X);
  const geometry = useMemo(() => {
    if (points.length < 2 || width <= 0) return null;
    const first = parseISO(points[0].day);
    const span = Math.max(0, differenceInCalendarDays(parseISO(points[points.length - 1].day), first));
    // On a calendar axis; sessions all on one day sit evenly instead.
    const slot = (index: number) => (span > 0 ? differenceInCalendarDays(parseISO(points[index].day), first) / span : index / (points.length - 1));
    const bottom = height - 0.5;
    const scale = weightScale(
      points.map((point) => point.value),
      { minSpan, plotHeight: bottom - PAD_Y, clearance: DOT_RADIUS + 1.5 },
    );
    const y = linearScale(scale.domain, [bottom, PAD_Y]);
    const line = points.map((point, index) => ({ x: PAD_X + slot(index) * plotWidth, y: y(point.value) }));
    // Dots shrink as the sessions crowd together.
    const radius = Math.max(1.25, Math.min(DOT_RADIUS, (plotWidth / points.length) * 0.9));
    const grid = scale.ticks.map((value, index) => ({ value, y: y(value), axis: index === 0, label: value.toFixed(scale.step < 1 ? 1 : 0) }));
    return { line, path: monotonePath(line), radius, grid };
  }, [points, width, plotWidth, height, minSpan]);

  if (points.length < 2) return null;

  // The session nearest a finger.
  const indexAt = (x: number): number | null => {
    if (!geometry) return null;
    let best = 0;
    geometry.line.forEach((point, index) => {
      if (Math.abs(point.x - x) < Math.abs(geometry.line[best].x - x)) best = index;
    });
    return best;
  };
  const select = (x: number) => {
    const index = indexAt(x);
    if (index === null) return;
    setActive((current) => {
      if (current !== index) haptics.select();
      return index;
    });
  };
  // A tap on the session already read puts the summary back.
  const tap = (x: number) => {
    const index = indexAt(x);
    if (index === null) return;
    haptics.select();
    setActive((current) => (current === index ? null : index));
  };
  // VoiceOver: the first swipe reads the latest session, then one at a time.
  const step = (direction: 1 | -1) => {
    const last = points.length - 1;
    const next = chosen === null ? last : Math.min(last, Math.max(0, chosen + direction));
    if (next !== chosen) haptics.select();
    setActive(next);
  };
  // A tap reads one session; holding then sliding reads them in turn. Sliding
  // straight away is left to the page (scrolling, or iOS's swipe back).
  const gesture = Gesture.Exclusive(
    Gesture.Pan()
      .activateAfterLongPress(160)
      .runOnJS(true)
      .onStart((event) => select(event.x))
      .onUpdate((event) => select(event.x))
      .onEnd(() => setActive(null)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((event) => tap(event.x)),
  );

  const selected = chosen !== null ? points[chosen] : null;
  const firstDay = parseISO(points[0].day);
  const lastDay = parseISO(points[points.length - 1].day);
  // Across years, the dates name theirs.
  const yearly = firstDay.getFullYear() !== lastDay.getFullYear();
  const dateLabel = (day: Date) => format(day, yearly ? 'MMM d, yyyy' : 'MMM d');
  // Each dot stays with the words before it when the line wraps at the largest text sizes.
  const readout = selected ? `${format(parseISO(selected.day), yearly ? 'MMM d, yyyy' : 'EEE, MMM d')}\u00a0· ${selected.label}` : summary;
  const spokenReadout = selected ? speak(`${format(parseISO(selected.day), 'EEEE, MMMM d, yyyy')}, ${selected.label}`) : speak(summary);
  const activePoint = chosen !== null && geometry ? geometry.line[chosen] : null;

  return (
    <View>
      <BlancText
        variant="footnote"
        tone={selected ? 'ink' : 'graphite'}
        numberOfLines={large ? undefined : 1}
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ minHeight: 18, marginBottom: 10, fontVariant: ['tabular-nums'] }}>
        {readout}
      </BlancText>
      <GestureDetector gesture={gesture}>
        <View
          style={{ height }}
          onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          accessible
          accessibilityLabel={`${name}, ${points.length} sessions`}
          accessibilityRole="adjustable"
          accessibilityHint="Swipe up or down to read a session."
          accessibilityValue={{ text: spokenReadout }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event: AccessibilityActionEvent) => {
            if (event.nativeEvent.actionName === 'increment') step(1);
            if (event.nativeEvent.actionName === 'decrement') step(-1);
          }}>
          {width > 0 && geometry ? (
            <Svg width={width} height={height} style={{ overflow: 'visible' }}>
              {geometry.grid.map((tick) => (
                <Line key={tick.value} x1={0} x2={plotRight} y1={tick.y} y2={tick.y} stroke={c.hairline} strokeWidth={tick.axis ? 1 : 0.5} />
              ))}
              <Path d={geometry.path} stroke={c.ink} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              {geometry.line.map((point, index) => (
                <Circle key={index} cx={point.x} cy={point.y} r={geometry.radius} fill={c.mark} />
              ))}
              {activePoint ? (
                <>
                  <Line x1={activePoint.x} x2={activePoint.x} y1={0} y2={height} stroke={c.hairline} strokeWidth={1} />
                  <Circle cx={activePoint.x} cy={activePoint.y} r={4.5} fill={c.ink} stroke={c.label} strokeWidth={2} />
                </>
              ) : null}
            </Svg>
          ) : null}
          {/* The scale, for sight; VoiceOver reads each session's figures instead. */}
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
      </GestureDetector>
      {/* The first and last session's dates under the line, for sight. */}
      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, marginRight: SCALE_COLUMN + SCALE_GAP }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none">
        <BlancText variant="footnote" tone="graphite" maxFontSizeMultiplier={AXIS_MAX_SCALE} numberOfLines={1}>
          {dateLabel(firstDay)}
        </BlancText>
        {Math.min(fontScale, AXIS_MAX_SCALE) * 2 * 70 < plotWidth ? (
          <BlancText variant="footnote" tone="graphite" maxFontSizeMultiplier={AXIS_MAX_SCALE} numberOfLines={1}>
            {dateLabel(lastDay)}
          </BlancText>
        ) : null}
      </View>
    </View>
  );
}
