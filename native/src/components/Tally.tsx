import { useEffect } from 'react';
import { View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { useBlanc } from '~/theme/blanc';

type TallyProps = {
  /** One entry per set; true when that set is logged. */
  marks: readonly boolean[];
  /** 0-based index of the set that is next, or null for none. */
  current: number | null;
  /** Stroke height; the next set's stroke is taller. */
  height?: number;
  accessibilityLabel: string;
  style?: ViewStyle;
};

const spring = { damping: 16, stiffness: 240, mass: 0.7 };
const GROUP = 5;

/**
 * hyPer's set tally, counted the way a paper training log is: one stroke per
 * set in groups of five. Logged strokes are ink, the next set's stroke stands
 * taller, and a group of five logged sets is closed with a diagonal stroke.
 */
export function Tally({ marks, current, height = 18, accessibilityLabel, style }: TallyProps) {
  const groups: number[][] = [];
  marks.forEach((_, index) => {
    if (index % GROUP === 0) groups.push([]);
    groups[groups.length - 1].push(index);
  });

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel}
      style={[{ flexDirection: 'row', alignItems: 'flex-end', gap: 14, minHeight: height + 8 }, style]}>
      {groups.map((indexes, groupIndex) => {
        const closed = indexes.length === GROUP && indexes.every((index) => marks[index]);
        return (
          <View key={groupIndex} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
            {indexes.map((index) => (
              <Stroke key={index} logged={marks[index]} next={index === current} height={height} />
            ))}
            <ClosingStroke closed={closed} height={height} />
          </View>
        );
      })}
    </View>
  );
}

function Stroke({ logged, next, height }: { logged: boolean; next: boolean; height: number }) {
  const c = useBlanc();
  const grow = useSharedValue(next ? 1 : 0);

  useEffect(() => {
    grow.value = withSpring(next ? 1 : 0, spring);
  }, [next, grow]);

  const animated = useAnimatedStyle(() => ({ height: height + grow.value * 8 }));

  return (
    <Animated.View
      style={[
        {
          width: next ? 2.5 : 2,
          borderRadius: 1.25,
          backgroundColor: logged || next ? c.ink : c.track,
        },
        animated,
      ]}
    />
  );
}

/** The diagonal that closes a finished group of five. */
function ClosingStroke({ closed, height }: { closed: boolean; height: number }) {
  const c = useBlanc();
  const drawn = useSharedValue(closed ? 1 : 0);

  useEffect(() => {
    drawn.value = withSpring(closed ? 1 : 0, spring);
  }, [closed, drawn]);

  // Five strokes span 4 gaps of 6 pt plus five widths of 2 pt: about 34 pt.
  const span = 34;
  const length = Math.sqrt(span * span + height * height) + 6;
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
          bottom: height / 2 - 1,
          width: length,
          height: 2,
          borderRadius: 1,
          backgroundColor: c.ink,
          transformOrigin: 'center',
        },
        animated,
      ]}
    />
  );
}
