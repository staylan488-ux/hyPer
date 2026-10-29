import { useEffect, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '~/lib/haptics';
import { blockExit, rowEnter } from '~/lib/motion';
import { radius, useBlanc } from '~/theme/blanc';

import { dismissOpenSwipeRow, holdRowPresses, releaseRowPresses } from './SwipeRow';

export type DragItem = { key: string; node: ReactNode };

/** How long a finger rests on a row before it lifts. */
const LIFT_MS = 320;
/** A row lifted and let go within this distance counts as held, not moved. */
const HOLD_SLOP = 8;
/** Until a row has measured itself. */
const FALLBACK_HEIGHT = 64;
const SETTLE = { duration: 200 };

type Shared = {
  /** Round the first row's top and the last row's bottom (the list starts or ends its card). */
  roundTop: boolean;
  roundBottom: boolean;
  order: SharedValue<string[]>;
  heights: SharedValue<Record<string, number>>;
  active: SharedValue<string | null>;
  startTop: SharedValue<number>;
  dragY: SharedValue<number>;
  lift: SharedValue<number>;
};

/** Where a row sits: the heights of the rows before it, in the order shown. */
function topOf(key: string, order: string[], heights: Record<string, number>): number {
  'worklet';
  let top = 0;
  for (const other of order) {
    if (other === key) return top;
    top += heights[other] ?? FALLBACK_HEIGHT;
  }
  return top;
}

function totalOf(order: string[], heights: Record<string, number>): number {
  'worklet';
  let total = 0;
  for (const key of order) total += heights[key] ?? FALLBACK_HEIGHT;
  return total;
}

/**
 * A list whose rows are held to lift and dragged into place, as in Reminders:
 * the row lifts under the finger with a firm tick, the others slide out of
 * its way with a light tick at each new place, and letting go sets it down
 * there. Held and let go without moving, a row offers its options instead
 * (`onHold`). Rows stay tappable and swipeable; a quick swipe never lifts.
 *
 * The rows are placed by position, not by layout order, so a drop never
 * jumps while the new order saves; the list follows `items` again whenever
 * their order changes (a save landed, or failed and put the old order back).
 */
export function DragList({ items, enabled, onMove, onHold, onDragging, revision = 0, roundTop = true, roundBottom = true }: {
  items: DragItem[];
  /** Bump to put the rows back in the items' order (a move that did not save). */
  revision?: number;
  roundTop?: boolean;
  roundBottom?: boolean;
  /** False while a move saves: rows don't lift. */
  enabled: boolean;
  /** A row was set down in a new place: its key and its index there. */
  onMove: (key: string, index: number) => void;
  /** A row held and let go without moving. */
  onHold?: (key: string) => void;
  /** A row lifted or set down: the page should hold still meanwhile. */
  onDragging?: (dragging: boolean) => void;
}) {
  const keys = items.map((item) => item.key);
  const signature = keys.join('|');
  const order = useSharedValue<string[]>(keys);
  const heights = useSharedValue<Record<string, number>>({});
  const active = useSharedValue<string | null>(null);
  const startTop = useSharedValue(0);
  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);
  const shared = useMemo<Shared>(
    () => ({ roundTop, roundBottom, order, heights, active, startTop, dragY, lift }),
    [roundTop, roundBottom, order, heights, active, startTop, dragY, lift],
  );

  // Follow the items' own order whenever it changes (not mid-drag).
  useEffect(() => {
    if (active.value === null) order.value = signature ? signature.split('|') : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, revision]);

  // The list's height follows its rows, gliding when one comes or goes.
  const height = useSharedValue<number | null>(null);
  useAnimatedReaction(
    () => totalOf(order.value, heights.value),
    (next) => {
      height.value = height.value === null ? next : withTiming(next, SETTLE);
    },
  );
  const box = useAnimatedStyle(() => ({ height: height.value ?? totalOf(order.value, heights.value) }));

  return (
    <Animated.View style={box}>
      {items.map((item) => (
        <DragRow
          key={item.key}
          id={item.key}
          shared={shared}
          enabled={enabled && items.length > 1}
          onMove={onMove}
          onHold={onHold}
          onDragging={onDragging}>
          {item.node}
        </DragRow>
      ))}
    </Animated.View>
  );
}

function DragRow({ id, shared, enabled, onMove, onHold, onDragging, children }: {
  id: string;
  shared: Shared;
  enabled: boolean;
  onMove: (key: string, index: number) => void;
  onHold?: (key: string) => void;
  onDragging?: (dragging: boolean) => void;
  children: ReactNode;
}) {
  const c = useBlanc();
  const { order, heights, active, startTop, dragY, lift } = shared;
  // This row's resting place; it glides to a new one as rows move around it.
  const top = useSharedValue<number | null>(null);
  const startIndex = useSharedValue(-1);

  useAnimatedReaction(
    () => topOf(id, order.value, heights.value),
    (next, previous) => {
      if (top.value === null || previous === null) top.value = next;
      else if (next !== previous) top.value = withTiming(next, SETTLE);
    },
  );

  const lifted = () => {
    holdRowPresses();
    dismissOpenSwipeRow();
    haptics.lift();
    onDragging?.(true);
  };
  const setDown = (moved: boolean, index: number, held: boolean) => {
    releaseRowPresses();
    onDragging?.(false);
    if (moved) {
      haptics.land();
      onMove(id, index);
    } else if (held) {
      onHold?.(id);
    }
  };

  const pan = Gesture.Pan()
    .enabled(enabled)
    .activateAfterLongPress(LIFT_MS)
    .onStart(() => {
      active.value = id;
      startTop.value = topOf(id, order.value, heights.value);
      startIndex.value = order.value.indexOf(id);
      dragY.value = 0;
      lift.value = withSpring(1, { damping: 18, stiffness: 320 });
      runOnJS(lifted)();
    })
    .onUpdate((event) => {
      const list = order.value;
      const own = heights.value[id] ?? FALLBACK_HEIGHT;
      const total = totalOf(list, heights.value);
      // Kept within the list, as iOS keeps a dragged row in its table.
      const y = Math.min(Math.max(event.translationY, -startTop.value), total - own - startTop.value);
      dragY.value = y;
      // The place whose middle the row's middle has passed.
      const middle = startTop.value + y + own / 2;
      const others = list.filter((key) => key !== id);
      let index = 0;
      let edge = 0;
      for (const key of others) {
        const height = heights.value[key] ?? FALLBACK_HEIGHT;
        if (middle > edge + height / 2) index += 1;
        edge += height;
      }
      if (list.indexOf(id) !== index) {
        others.splice(index, 0, id);
        order.value = others;
        runOnJS(haptics.select)();
      }
    })
    .onEnd((event) => {
      const index = order.value.indexOf(id);
      const moved = index !== startIndex.value;
      const held = Math.abs(event.translationY) < HOLD_SLOP && Math.abs(event.translationX) < HOLD_SLOP;
      runOnJS(setDown)(moved, index, held);
    })
    .onFinalize(() => {
      if (active.value !== id) return;
      // Glide into the place it was dropped, then rest there.
      const final = topOf(id, order.value, heights.value);
      lift.value = withTiming(0, SETTLE);
      dragY.value = withTiming(final - startTop.value, SETTLE, (done) => {
        if (done && active.value === id) active.value = null;
      });
    });

  const { roundTop, roundBottom } = shared;
  const place = useAnimatedStyle(() => {
    const isActive = active.value === id;
    const y = isActive ? startTop.value + dragY.value : (top.value ?? 0);
    const raised = isActive ? lift.value : 0;
    // The card's corners belong to whichever rows sit first and last; a
    // lifted row is a card of its own.
    const index = order.value.indexOf(id);
    const first = roundTop && index === 0 ? radius.label : 0;
    const last = roundBottom && index === order.value.length - 1 ? radius.label : 0;
    const lifted = radius.label * raised;
    return {
      transform: [{ translateY: y }, { scale: 1 + 0.025 * raised }],
      zIndex: isActive ? 10 : 0,
      borderTopLeftRadius: Math.max(first, lifted),
      borderTopRightRadius: Math.max(first, lifted),
      borderBottomLeftRadius: Math.max(last, lifted),
      borderBottomRightRadius: Math.max(last, lifted),
      boxShadow: raised > 0 ? `0 ${8 * raised}px ${24 * raised}px rgba(0, 0, 0, ${0.16 * raised})` : undefined,
    };
  });
  // The rule above a row shows only where a row sits above it, and never on a lifted one.
  const rule = useAnimatedStyle(() => ({
    opacity: order.value.indexOf(id) > 0 && active.value !== id ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={rowEnter}
        exiting={blockExit}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          if (heights.value[id] !== height) heights.value = { ...heights.value, [id]: height };
        }}
        style={[{ position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: c.label, overflow: 'hidden', borderCurve: 'continuous' }, place]}>
        <Animated.View style={[{ height: StyleSheet.hairlineWidth, marginLeft: 18, backgroundColor: c.hairline }, rule]} />
        <View>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
