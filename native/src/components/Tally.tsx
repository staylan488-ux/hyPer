import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';

import { useReduceMotion } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useBlanc } from '~/theme/blanc';

type TallyProps = {
  /** One entry per set; true when that set is logged. */
  marks: readonly boolean[];
  /** 0-based index of the set that is next, or null for none. */
  current: number | null;
  /** Stroke height; the next set's stroke is taller. */
  height?: number;
  /** The small size for a list row: thin strokes, height 12, tight gaps. */
  compact?: boolean;
  /** Draw the strokes in one by one as it appears, each group's diagonal after its fifth, with one haptic as the last lands. */
  drawIn?: boolean;
  accessibilityLabel: string;
  style?: ViewStyle;
};

const spring = { damping: 16, stiffness: 240, mass: 0.7 };
/** Drawing in: damped almost to critical, so a written stroke lands at its height instead of bobbing past it. */
const drawSpring = { damping: 24, stiffness: 240, mass: 0.7 };
const GROUP = 5;
/** Drawing in: wait for a full-screen modal to slide in, then one stroke every 45 ms. */
const DRAW_START = 350;
const DRAW_STEP = 45;
/**
 * However many sets, every stroke and diagonal starts drawing within this of
 * the first, so a long session's reveal stays as quick as a short one's: its
 * strokes come closer together instead (30 sets, about 23 ms apart).
 */
export const DRAW_SPAN = 700;
/** About when the last stroke's spring lands after it starts: the reveal's one haptic plays then. */
const DRAW_LAND = 120;

/** The time between strokes drawing in, for a tally of `count` sets. */
function drawStep(count: number): number {
  return count > 0 ? Math.min(DRAW_STEP, DRAW_SPAN / count) : DRAW_STEP;
}

/**
 * How much taller a compact tally's next stroke stands, and so the room it
 * keeps above its strokes: half again the 12 pt stroke, as on Today's card
 * (16 + 8). At 4 pt (a third) the next stroke read as the same height in a row.
 */
export const COMPACT_RISE = 6;

/** Stroke width, gaps and how much taller the next stroke stands, per size. */
const SIZES = {
  regular: { width: 2, nextWidth: 2.5, gap: 6, groupGap: 14, rowGap: 10, grow: 8, closing: 2 },
  compact: { width: 1.5, nextWidth: 2, gap: 4, groupGap: 8, rowGap: 6, grow: COMPACT_RISE, closing: 1.5 },
};
type Size = (typeof SIZES)['regular'];

/**
 * hyPer's set tally, counted the way a paper training log is: one stroke per
 * set in groups of five. Logged strokes are ink, the next set's stroke stands
 * taller in the live red, the sets still to do are in `mark`, and a group of
 * five logged sets is closed with a diagonal stroke. One grammar wherever a
 * tally appears: a finished movement recedes through its name, never its strokes.
 */
export function Tally({ marks, current, height: tall, compact, drawIn, accessibilityLabel, style }: TallyProps) {
  // Followed live: turning Reduce Motion on draws the next tally at once.
  const reduced = useReduceMotion();
  const draw = drawIn && !reduced;
  const size = compact ? SIZES.compact : SIZES.regular;
  const height = tall ?? (compact ? 12 : 18);
  const groups: number[][] = [];
  marks.forEach((_, index) => {
    if (index % GROUP === 0) groups.push([]);
    groups[groups.length - 1].push(index);
  });
  const step = drawStep(marks.length);
  const isClosed = (indexes: number[]) => indexes.length === GROUP && indexes.every((index) => marks[index]);
  // The last mark to draw in: the final group's diagonal when it closes, else the final stroke.
  const lastGroup = groups[groups.length - 1];
  const lastMark = lastGroup && isClosed(lastGroup) ? marks.length : marks.length - 1;
  const landed = DRAW_START + lastMark * step + DRAW_LAND;

  // One haptic as the reveal completes, not a tick per group: a long session
  // would otherwise buzz all the way through it. Drawn at once (Reduce
  // Motion), there is no reveal to feel.
  const count = marks.length;
  useEffect(() => {
    if (!draw || count === 0) return;
    const timer = setTimeout(haptics.land, landed);
    return () => clearTimeout(timer);
  }, [draw, count, landed]);

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      // A long session wraps onto a second line instead of running off the edge.
      style={[
        { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', columnGap: size.groupGap, rowGap: size.rowGap, minHeight: height + size.grow },
        style,
      ]}>
      {groups.map((indexes, groupIndex) => (
        // Each group keeps room for the taller next stroke, so wrapped lines never shift.
        <View key={groupIndex} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: size.gap, minHeight: height + size.grow }}>
          {indexes.map((index) => (
            <Stroke key={index} logged={marks[index]} next={index === current} height={height} size={size} appear={draw ? DRAW_START + index * step : null} />
          ))}
          <ClosingStroke
            closed={isClosed(indexes)}
            height={height}
            size={size}
            appear={draw ? DRAW_START + (indexes[indexes.length - 1] + 1) * step : null}
          />
        </View>
      ))}
    </View>
  );
}

/** `appear`: ms after mounting to draw the stroke in, or null to show it drawn. */
function Stroke({ logged, next, height, size, appear }: { logged: boolean; next: boolean; height: number; size: Size; appear: number | null }) {
  const c = useBlanc();
  const grow = useSharedValue(next ? 1 : 0);
  const shown = useSharedValue(appear === null ? 1 : 0);

  useEffect(() => {
    grow.value = withSpring(next ? 1 : 0, spring);
  }, [next, grow]);

  useEffect(() => {
    shown.value = appear === null ? 1 : withDelay(appear, withSpring(1, drawSpring));
  }, [appear, shown]);

  const rise = size.grow;
  const animated = useAnimatedStyle(() => ({ height: height * shown.value + grow.value * rise }));

  return (
    <Animated.View
      style={[
        {
          width: next ? size.nextWidth : size.width,
          borderRadius: size.nextWidth / 2,
          // Ink counts what is logged; the next set is the live one, taller and in the live red, so the ink strokes always equal the sets done.
          backgroundColor: logged ? c.ink : next ? c.live : c.mark,
        },
        animated,
      ]}
    />
  );
}

/** The diagonal that closes a finished group of five; drawn in after `appear` ms. */
function ClosingStroke({ closed, height, size, appear }: { closed: boolean; height: number; size: Size; appear: number | null }) {
  const c = useBlanc();
  const drawn = useSharedValue(closed && appear === null ? 1 : 0);

  useEffect(() => {
    drawn.value = appear === null || !closed ? withSpring(closed ? 1 : 0, spring) : withDelay(appear, withSpring(1, drawSpring));
  }, [closed, appear, drawn]);

  // Five strokes span 4 gaps plus five widths: about 34 pt, 23.5 compact.
  const span = 4 * size.gap + 5 * size.width;
  const length = Math.sqrt(span * span + height * height) + size.gap;
  const angle = `${-Math.atan2(height, span)}rad`;

  const animated = useAnimatedStyle(() => ({
    opacity: drawn.value,
    transform: [{ rotate: angle }, { scaleX: drawn.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          left: span / 2 - length / 2,
          bottom: height / 2 - size.closing / 2,
          width: length,
          height: size.closing,
          borderRadius: size.closing / 2,
          backgroundColor: c.ink,
          transformOrigin: 'center',
        },
        animated,
      ]}
    />
  );
}
