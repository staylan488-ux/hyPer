import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { haptics } from '~/lib/haptics';
import { liftShadow } from '~/lib/liftShadow';
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
/** Where the rule between rows stops: the right gutter, as Hairline's. */
const RULE_END = 16;

type Shared = {
  /** Where the rule between rows starts: the rows' text edge. */
  ruleInset: number;
  order: SharedValue<string[]>;
  /** An order that came while a dropped row settled; it takes over once the row rests. */
  pending: SharedValue<string[] | null>;
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
export function DragList({ items, enabled, onMove, onHold, onDragging, revision = 0, ruleInset = 18 }: {
  items: DragItem[];
  /** Bump to put the rows back in the items' order (a move that did not save). */
  revision?: number;
  /** Where the rule between rows starts, as Hairline's inset: the rows' text edge. */
  ruleInset?: number;
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
  const pending = useSharedValue<string[] | null>(null);
  const heights = useSharedValue<Record<string, number>>({});
  const active = useSharedValue<string | null>(null);
  const startTop = useSharedValue(0);
  const dragY = useSharedValue(0);
  const lift = useSharedValue(0);
  const shared = useMemo<Shared>(
    () => ({ ruleInset, order, pending, heights, active, startTop, dragY, lift }),
    [ruleInset, order, pending, heights, active, startTop, dragY, lift],
  );

  // Follow the items' own order whenever it changes. Not mid-drag; one that
  // comes while a dropped row settles (a save that failed at once puts the
  // old order back) waits for the row to rest. Decided on the UI thread, where
  // the row settles. The shared values never change, so this runs as the
  // signature or revision does.
  useEffect(() => {
    const next = signature ? signature.split('|') : [];
    runOnUI(() => {
      'worklet';
      if (active.get() === null) order.set(next);
      else pending.set(next);
    })();
  }, [signature, revision, active, order, pending]);

  // The rows call the latest handlers through these stable ones, so a parent
  // that passes new handlers on every render (Train does, on every logged set)
  // does not rebuild each row's drag gesture.
  const handlers = useRef({ onMove, onHold, onDragging });
  useLayoutEffect(() => {
    handlers.current = { onMove, onHold, onDragging };
  }, [onMove, onHold, onDragging]);
  const move = (key: string, index: number) => handlers.current.onMove(key, index);
  const hold = (key: string) => handlers.current.onHold?.(key);
  const dragging = (lifted: boolean) => handlers.current.onDragging?.(lifted);

  // The list's height follows its rows, gliding when one comes or goes.
  const height = useSharedValue<number | null>(null);
  useAnimatedReaction(
    () => totalOf(order.get(), heights.get()),
    (next) => {
      height.set(height.get() === null ? next : withTiming(next, SETTLE));
    },
  );
  const box = useAnimatedStyle(() => ({ height: height.get() ?? totalOf(order.get(), heights.get()) }));

  return (
    <Animated.View style={box}>
      {items.map((item) => (
        <DragRow
          key={item.key}
          id={item.key}
          shared={shared}
          enabled={enabled && items.length > 1}
          onMove={move}
          onHold={hold}
          onDragging={dragging}>
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
  const { order, pending, heights, active, startTop, dragY, lift } = shared;
  // This row's resting place; it glides to a new one as rows move around it.
  const top = useSharedValue<number | null>(null);
  const startIndex = useSharedValue(-1);

  useAnimatedReaction(
    () => topOf(id, order.get(), heights.get()),
    (next, previous) => {
      if (top.get() === null || previous === null) top.set(next);
      else if (next !== previous) top.set(withTiming(next, SETTLE));
    },
  );

  // Built once per row, and again only when the row can or can't lift, so a
  // parent's re-render doesn't re-send the gesture and its worklets. (Left to
  // the React Compiler it would be rebuilt every render, because the row's own
  // startIndex counts as mutable to it.) DragList's handlers are stable.
  const pan = useMemo(() => {
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

    return Gesture.Pan()
      .enabled(enabled)
      .activateAfterLongPress(LIFT_MS)
      .onStart(() => {
        active.set(id);
        startTop.set(topOf(id, order.get(), heights.get()));
        startIndex.set(order.get().indexOf(id));
        dragY.set(0);
        lift.set(withSpring(1, { damping: 18, stiffness: 320 }));
        runOnJS(lifted)();
      })
      .onUpdate((event) => {
        const list = order.get();
        const own = heights.get()[id] ?? FALLBACK_HEIGHT;
        const total = totalOf(list, heights.get());
        // Kept within the list, as iOS keeps a dragged row in its table.
        const y = Math.min(Math.max(event.translationY, -startTop.get()), total - own - startTop.get());
        dragY.set(y);
        // The place whose middle the row's middle has passed.
        const middle = startTop.get() + y + own / 2;
        const others = list.filter((key) => key !== id);
        let index = 0;
        let edge = 0;
        for (const key of others) {
          const height = heights.get()[key] ?? FALLBACK_HEIGHT;
          if (middle > edge + height / 2) index += 1;
          edge += height;
        }
        if (list.indexOf(id) !== index) {
          others.splice(index, 0, id);
          order.set(others);
          runOnJS(haptics.select)();
        }
      })
      .onEnd((event) => {
        // An order from before the drop would undo it.
        pending.set(null);
        const index = order.get().indexOf(id);
        const moved = index !== startIndex.get();
        const held = Math.abs(event.translationY) < HOLD_SLOP && Math.abs(event.translationX) < HOLD_SLOP;
        runOnJS(setDown)(moved, index, held);
      })
      .onFinalize(() => {
        if (active.get() !== id) return;
        // Glide into the place it was dropped, then rest there.
        const final = topOf(id, order.get(), heights.get());
        lift.set(withTiming(0, SETTLE));
        dragY.set(
          withTiming(final - startTop.get(), SETTLE, (done) => {
            if (!done || active.get() !== id) return;
            active.set(null);
            // An order that came while the row settled takes over now.
            const next = pending.get();
            if (next) {
              order.set(next);
              pending.set(null);
            }
          }),
        );
      });
  }, [enabled, id, onDragging, onMove, onHold, active, startTop, startIndex, order, pending, heights, dragY, lift]);

  const place = useAnimatedStyle(() => {
    const isActive = active.get() === id;
    const y = isActive ? startTop.get() + dragY.get() : (top.get() ?? 0);
    const raised = isActive ? lift.get() : 0;
    // Rows sit on the page with no card; a lifted row is a card of its own.
    const corner = radius.label * raised;
    return {
      transform: [{ translateY: y }, { scale: 1 + 0.025 * raised }],
      zIndex: isActive ? 10 : 0,
      borderRadius: corner,
      boxShadow: liftShadow(raised),
    };
  });
  // The lifted row's own surface: it fades in as the row rises and out as it
  // settles, so a row at rest is transparent like the page under it.
  const surface = useAnimatedStyle(() => ({ opacity: active.get() === id ? lift.get() : 0 }));
  // The rule above a row shows only where a row sits above it, and never on a lifted one.
  const rule = useAnimatedStyle(() => ({
    opacity: order.get().indexOf(id) > 0 && active.get() !== id ? 1 : 0,
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={rowEnter}
        exiting={blockExit}
        onLayout={(event) => {
          const height = event.nativeEvent.layout.height;
          // Merged on the UI thread: a write from here lands later, so rows laid
          // out together would each copy the same old heights and drop the others.
          heights.modify((value) => {
            'worklet';
            return value[id] === height ? value : { ...value, [id]: height };
          }, false);
        }}
        style={[{ position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden', borderCurve: 'continuous' }, place]}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.label }, surface]} />
        <Animated.View style={[{ height: StyleSheet.hairlineWidth, marginLeft: shared.ruleInset, marginRight: RULE_END, backgroundColor: c.hairline }, rule]} />
        <View>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
