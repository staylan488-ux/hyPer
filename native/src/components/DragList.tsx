import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, useColorScheme, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  runOnUI,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useReduceMotion } from '~/lib/accessibility';
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

// A page's groups (`cards`): while one is held, every group is a glass card.
/** A card's corners: the tab bar's roundness, scaled to a block. */
const CARD_RADIUS = 26;
/** How far a card reaches above and below its group's own edges. */
const CARD_PAD = 12;
/** The groups draw in a little while they are cards, so each card has the page around it. */
const CARD_SHRINK = 0.05;
const CARDS_IN_MS = 260;
/** After the held group is set down the cards stay a moment, then fade slowly until they are gone. */
const CARDS_STAY_MS = 350;
const CARDS_OUT_MS = 900;

// Liquid Glass needs iOS 26; before it a card is the lifted surface's fill.
const glassAvailable = (() => {
  try {
    return isLiquidGlassAvailable();
  } catch {
    return false;
  }
})();

type Shared = {
  /** Where the rule between rows starts: the rows' text edge. */
  ruleInset: number;
  /** Space between one row and the next. */
  gap: number;
  /** The rows are a page's groups: glass cards while one is held, with no rules between them. */
  cards: boolean;
  /** The cards' presence, from 0 (the bare page) to 1. */
  shown: SharedValue<number>;
  /** Whether the cards' glass is there, for the views that draw it. */
  glass: boolean;
  /** How far the groups draw in as cards (none with Reduce Motion). */
  shrink: number;
  order: SharedValue<string[]>;
  /** An order that came while a dropped row settled; it takes over once the row rests. */
  pending: SharedValue<string[] | null>;
  heights: SharedValue<Record<string, number>>;
  active: SharedValue<string | null>;
  startTop: SharedValue<number>;
  dragY: SharedValue<number>;
  lift: SharedValue<number>;
};

/** Where a row sits: the heights of the rows before it, in the order shown, and the gaps between them. */
function topOf(key: string, order: string[], heights: Record<string, number>, gap: number): number {
  'worklet';
  let top = 0;
  for (const other of order) {
    if (other === key) return top;
    top += (heights[other] ?? FALLBACK_HEIGHT) + gap;
  }
  return top;
}

function totalOf(order: string[], heights: Record<string, number>, gap: number): number {
  'worklet';
  let total = 0;
  for (const key of order) total += heights[key] ?? FALLBACK_HEIGHT;
  return total + gap * Math.max(0, order.length - 1);
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
 *
 * With `cards` the rows are a page's groups (Today's training, Fuel and
 * Progress). The page has no cards at rest; holding a group brings a glass
 * card in behind every group, the held one lifts, and once it is set down
 * the cards fade slowly until they are gone.
 */
export function DragList({ items, enabled, onMove, onHold, onDragging, revision = 0, ruleInset = 18, gap = 0, cards = false }: {
  items: DragItem[];
  /** Space between one row and the next (a page's groups: `space.group`). */
  gap?: number;
  /** The rows are a page's groups: glass cards while one is held. */
  cards?: boolean;
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
  const shown = useSharedValue(0);
  // The glass itself can't fade by opacity; it arrives and leaves by its own animation.
  const [glass, setGlass] = useState(false);
  const shrink = useReduceMotion() ? 0 : CARD_SHRINK;
  const shared = useMemo<Shared>(
    () => ({ ruleInset, gap, cards, shown, glass, shrink, order, pending, heights, active, startTop, dragY, lift }),
    [ruleInset, gap, cards, shown, glass, shrink, order, pending, heights, active, startTop, dragY, lift],
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
  // The glass stays as long as the cards do: a group held again before they have gone keeps them.
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = (lifted: boolean) => {
    handlers.current.onDragging?.(lifted);
    if (!cards) return;
    if (leaving.current) clearTimeout(leaving.current);
    leaving.current = null;
    if (lifted) setGlass(true);
    else leaving.current = setTimeout(() => setGlass(false), SETTLE.duration + CARDS_STAY_MS + CARDS_OUT_MS);
  };
  useEffect(
    () => () => {
      if (leaving.current) clearTimeout(leaving.current);
    },
    [],
  );

  // The list's height follows its rows, gliding when one comes or goes.
  const height = useSharedValue<number | null>(null);
  useAnimatedReaction(
    () => totalOf(order.get(), heights.get(), gap),
    (next) => {
      height.set(height.get() === null ? next : withTiming(next, SETTLE));
    },
  );
  const box = useAnimatedStyle(() => ({ height: height.get() ?? totalOf(order.get(), heights.get(), gap) }));

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
  const dark = useColorScheme() === 'dark';
  const { order, pending, heights, active, startTop, dragY, lift, gap, cards, shown, shrink } = shared;
  // This row's resting place; it glides to a new one as rows move around it.
  const top = useSharedValue<number | null>(null);
  const startIndex = useSharedValue(-1);

  useAnimatedReaction(
    () => topOf(id, order.get(), heights.get(), gap),
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
        if (cards) shown.set(withTiming(1, { duration: CARDS_IN_MS }));
        startTop.set(topOf(id, order.get(), heights.get(), gap));
        startIndex.set(order.get().indexOf(id));
        dragY.set(0);
        lift.set(withSpring(1, { damping: 18, stiffness: 320 }));
        runOnJS(lifted)();
      })
      .onUpdate((event) => {
        const list = order.get();
        const own = heights.get()[id] ?? FALLBACK_HEIGHT;
        const total = totalOf(list, heights.get(), gap);
        // Kept within the list, as iOS keeps a dragged row in its table.
        const y = Math.min(Math.max(event.translationY, -startTop.get()), total - own - startTop.get());
        dragY.set(y);
        if (cards) {
          // Groups differ in height, so the held one trades places with a
          // neighbour once its leading edge passes that neighbour's middle, as
          // they lie now: a tall group can still go above a short first one.
          const heldTop = startTop.get() + y;
          let next = list;
          let at = next.indexOf(id);
          for (let step = 0; step < next.length; step += 1) {
            const below = at < next.length - 1 ? next[at + 1] : null;
            const above = at > 0 ? next[at - 1] : null;
            const middleOf = (key: string) => topOf(key, next, heights.get(), gap) + (heights.get()[key] ?? FALLBACK_HEIGHT) / 2;
            const to = below !== null && heldTop + own > middleOf(below) ? at + 1 : above !== null && heldTop < middleOf(above) ? at - 1 : at;
            if (to === at) break;
            const moved = next.filter((key) => key !== id);
            moved.splice(to, 0, id);
            next = moved;
            at = to;
          }
          if (next !== list) {
            order.set(next);
            runOnJS(haptics.select)();
          }
          return;
        }
        // The place whose middle the row's middle has passed.
        const middle = startTop.get() + y + own / 2;
        const others = list.filter((key) => key !== id);
        let index = 0;
        let edge = 0;
        for (const key of others) {
          const height = heights.get()[key] ?? FALLBACK_HEIGHT;
          if (middle > edge + height / 2) index += 1;
          edge += height + gap;
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
        const final = topOf(id, order.get(), heights.get(), gap);
        lift.set(withTiming(0, SETTLE));
        // Set down, the cards stay a moment and then fade until they are gone.
        if (cards) shown.set(withDelay(SETTLE.duration + CARDS_STAY_MS, withTiming(0, { duration: CARDS_OUT_MS })));
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
  }, [enabled, id, onDragging, onMove, onHold, active, startTop, startIndex, order, pending, heights, dragY, lift, gap, cards, shown]);

  const place = useAnimatedStyle(() => {
    const isActive = active.get() === id;
    const y = isActive ? startTop.get() + dragY.get() : (top.get() ?? 0);
    const raised = isActive ? lift.get() : 0;
    if (cards) {
      // A group draws in a little as its card arrives; the held one stays nearer its own size, above the rest.
      return { transform: [{ translateY: y }, { scale: 1 - shrink * shown.get() + 0.02 * raised }], zIndex: isActive ? 10 : 0 };
    }
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
  // A group's card: its edge and (before Liquid Glass) its fill fade with the cards; the held one casts the lift's shadow.
  const card = useAnimatedStyle(() => ({ boxShadow: liftShadow(active.get() === id ? lift.get() : 0) }));
  const cardFace = useAnimatedStyle(() => ({ opacity: shown.get() }));
  // The rule above a row shows only where a row sits above it, and never on a lifted one.
  const rule = useAnimatedStyle(() => ({
    opacity: order.get().indexOf(id) > 0 && active.get() !== id ? 1 : 0,
  }));

  const measure = (height: number) => {
    // Merged on the UI thread: a write from here lands later, so rows laid
    // out together would each copy the same old heights and drop the others.
    heights.modify((value) => {
      'worklet';
      return value[id] === height ? value : { ...value, [id]: height };
    }, false);
  };

  if (cards) {
    const corners = { borderRadius: CARD_RADIUS, borderCurve: 'continuous' as const };
    return (
      <GestureDetector gesture={pan}>
        <Animated.View
          entering={rowEnter}
          exiting={blockExit}
          onLayout={(event) => measure(event.nativeEvent.layout.height)}
          style={[{ position: 'absolute', left: 0, right: 0, top: 0 }, place]}>
          {/* The card fades with `shown`; its glass is only there while the cards are, so the bare page draws no glass at all. */}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: -CARD_PAD, bottom: -CARD_PAD }, corners, card, cardFace]}>
            {glassAvailable ? (
              shared.glass ? <GlassView glassEffectStyle="regular" tintColor={dark ? undefined : 'rgba(255,255,255,0.9)'} style={[StyleSheet.absoluteFill, corners]} /> : null
            ) : (
              <View style={[StyleSheet.absoluteFill, corners, { backgroundColor: c.label }]} />
            )}
            {/* A hairline edge, so a card reads on true black, where glass has nothing behind it to bend. */}
            <View style={[StyleSheet.absoluteFill, corners, { borderWidth: StyleSheet.hairlineWidth, borderColor: c.hairline }]} />
          </Animated.View>
          <View>{children}</View>
        </Animated.View>
      </GestureDetector>
    );
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        entering={rowEnter}
        exiting={blockExit}
        onLayout={(event) => measure(event.nativeEvent.layout.height)}
        style={[{ position: 'absolute', left: 0, right: 0, top: 0, overflow: 'hidden', borderCurve: 'continuous' }, place]}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: c.label }, surface]} />
        <Animated.View style={[{ height: StyleSheet.hairlineWidth, marginLeft: shared.ruleInset, marginRight: RULE_END, backgroundColor: c.hairline }, rule]} />
        <View>{children}</View>
      </Animated.View>
    </GestureDetector>
  );
}
