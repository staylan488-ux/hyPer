import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { useIncreaseContrast } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { markHintDone, useHintScope } from '~/lib/hints';
import { palettes, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

export type SwipeAction = { label: string; destructive?: boolean; onPress: () => void };

/**
 * The swipe actions of the row around a Row, so the Row (the element
 * VoiceOver focuses) offers them as its own actions. A plain wrapper view
 * that is not an accessibility element cannot.
 */
const SwipeActionsContext = createContext<SwipeAction[] | null>(null);
export const useSwipeActions = () => useContext(SwipeActionsContext);

// As in Mail: one row open at a time. Opening another, scrolling, tapping
// another row or leaving the screen closes it first. Each row registers a
// handle of its own (stable for its life), never the swipeable's ref, which
// React clears before the row's cleanup runs.
type OpenRow = { close: () => void };
let openRow: OpenRow | null = null;
// The finger that swipes a row also lifts as a press on the row under it
// (React Native's press handling is not told the swipe took the touch), so a
// press during a swipe or just after it belongs to the swipe.
let swipeStartedAt = 0;
let swipeEndedAt = 0;
const SWIPE_PRESS_GRACE = 350;
const SWIPE_LONGEST = 2000;

function markSwipeStart() {
  swipeStartedAt = Date.now();
}
function markSwipeEnd() {
  swipeEndedAt = Date.now();
}

// A row lifted to be dragged into place takes its touch the same way.
let rowHeld = false;
/** A row gesture (a drag to reorder) has the touch: rows ignore presses until released. */
export function holdRowPresses() {
  rowHeld = true;
}
/** The row gesture let go; the press that ends it is still ignored. */
export function releaseRowPresses() {
  rowHeld = false;
  markSwipeEnd();
}

/**
 * For a row's tap or long press: true when the touch is not the row's own, so
 * the row does nothing. That is a touch that swiped (now or a moment ago), or
 * one that only closes the row left open (as in Mail).
 */
export function closeOpenSwipeRow(): boolean {
  const now = Date.now();
  const swiping = swipeStartedAt > swipeEndedAt && now - swipeStartedAt < SWIPE_LONGEST;
  if (rowHeld || swiping || now - swipeEndedAt < SWIPE_PRESS_GRACE) return true;
  return dismissOpenSwipeRow();
}

/** For a scroll: closes the row left open, if any (true when there was one). */
export function dismissOpenSwipeRow(): boolean {
  if (!openRow) return false;
  const row = openRow;
  openRow = null;
  row.close();
  return true;
}

const ACTION_WIDTH = 84;
// After a full swipe the red takes the whole row before the row leaves.
const FILL_MS = 140;
// Past this much of the row, letting go runs the destructive action, as in Mail.
const FULL_SWIPE_SHARE = 0.55;
const FULL_SWIPE_MIN = 160;

/**
 * A row with iOS swipe actions: swipe left for its actions (destructive last,
 * in red); swipe past about half the row to run the destructive one, which
 * then fills the row. The actions are also VoiceOver custom actions (a Row
 * inside takes them as its own). Give the row's container the shared row
 * motion (`rowExit`, `rowLayout` in lib/motion) so a removed row leaves and
 * the rows below close up. Every action plays its own success or error
 * haptic once it has run.
 */
export function SwipeRow({ actions, name, children }: { actions: SwipeAction[]; name: string; children: ReactNode }) {
  const swipeable = useRef<SwipeableMethods>(null);
  const [self] = useState<OpenRow>(() => ({ close: () => swipeable.current?.close() }));
  const armed = useRef(false);
  const mounted = useRef(true);
  // A swipe by the finger, as against a close from code (a tap, a scroll).
  const dragging = useRef(false);
  const startDrag = () => {
    dragging.current = true;
    markSwipeStart();
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    markSwipeEnd();
  };
  const fullSwipe = useSharedValue(Number.POSITIVE_INFINITY);
  const rowWidth = useSharedValue(0);
  // 0 while swiping; 1 once a full swipe has committed: the row's face fades
  // and the red fills the row, as in Mail.
  const committed = useSharedValue(0);
  const face = useAnimatedStyle(() => ({ opacity: 1 - committed.get() }));
  const destructive = actions.find((action) => action.destructive);
  const hint = useHintScope();

  useEffect(
    () => () => {
      mounted.current = false;
      if (openRow === self) openRow = null;
    },
    [self],
  );
  // A row left open on a screen that goes out of sight closes, so it can't
  // take the first tap on the next screen.
  useFocusEffect(
    useCallback(
      () => () => {
        if (openRow === self) dismissOpenSwipeRow();
      },
      [self],
    ),
  );

  const run = (action: SwipeAction) => {
    if (openRow === self) openRow = null;
    swipeable.current?.close();
    action.onPress();
  };
  // A full swipe fills the row with red, then runs the action, which removes
  // the row (it slides away); one that asks first (or fails) comes back.
  const runFull = (action: SwipeAction) => {
    if (openRow === self) openRow = null;
    committed.set(withTiming(1, { duration: FILL_MS }));
    setTimeout(() => {
      action.onPress();
      setTimeout(() => {
        if (!mounted.current) return;
        committed.set(withTiming(0, { duration: FILL_MS }));
        swipeable.current?.close();
      }, 450);
    }, FILL_MS);
  };
  // One firm tick as the red takes over, none as it lets go. Made once, so
  // the actions' reaction to the swipe keeps running across renders.
  const onArm = (next: boolean) => {
    if (next && !armed.current) haptics.tap();
    armed.current = next;
  };

  return (
    <View
      accessible={false}
      accessibilityActions={actions.map((action) => ({ name: action.label, label: action.label }))}
      onAccessibilityAction={(event) => {
        const action = actions.find((candidate) => candidate.label === event.nativeEvent.actionName);
        if (action) run(action);
      }}
      onLayout={(event) => {
        rowWidth.set(event.nativeEvent.layout.width);
        fullSwipe.set(Math.max(FULL_SWIPE_MIN, event.nativeEvent.layout.width * FULL_SWIPE_SHARE));
      }}>
      <ReanimatedSwipeable
        ref={swipeable}
        // A row whose actions run out (a movement's last set logged) stays mounted with the
        // swipe turned off, so what it holds (a tally mid-spring) doesn't remount.
        enabled={actions.length > 0}
        // The row follows the finger one to one, as iOS lists do.
        friction={1}
        rightThreshold={44}
        overshootRight={Boolean(destructive)}
        overshootFriction={1}
        onSwipeableOpenStartDrag={() => {
          startDrag();
          if (openRow && openRow !== self) dismissOpenSwipeRow();
        }}
        onSwipeableCloseStartDrag={startDrag}
        onSwipeableWillClose={endDrag}
        // Decided at release: the row then springs back past the threshold
        // to its open width, which would disarm it before it settles. The
        // tick when it armed was the feedback; the action reports its result.
        onSwipeableWillOpen={() => {
          endDrag();
          // The swipe its block's hint taught has been found.
          if (hint) markHintDone(hint);
          if (armed.current && destructive) {
            armed.current = false;
            runFull(destructive);
            return;
          }
          openRow = self;
        }}
        onSwipeableClose={() => {
          if (openRow === self) openRow = null;
        }}
        renderRightActions={(_progress, translation) => (
          <Actions
            actions={actions}
            name={name}
            translation={translation}
            fullSwipe={fullSwipe}
            rowWidth={rowWidth}
            committed={committed}
            onArm={onArm}
            onRun={run}
          />
        )}>
        <SwipeActionsContext.Provider value={actions}>
          <Animated.View style={face}>{children}</Animated.View>
        </SwipeActionsContext.Provider>
      </ReanimatedSwipeable>
    </View>
  );
}

function Actions({ actions, name, translation, fullSwipe, rowWidth, committed, onArm, onRun }: {
  actions: SwipeAction[];
  name: string;
  translation: SharedValue<number>;
  fullSwipe: SharedValue<number>;
  rowWidth: SharedValue<number>;
  committed: SharedValue<number>;
  onArm: (armed: boolean) => void;
  onRun: (action: SwipeAction) => void;
}) {
  const c = useBlanc();
  // White on the red needs the deeper red in dark mode with Increase Contrast.
  const destructiveFill = useIncreaseContrast() ? palettes.lightContrast.live : c.live;
  // A label grown with the text size shrinks to fit its fixed column.
  const fits = useWindowDimensions().fontScale > 1;
  const hasDestructive = actions.some((action) => action.destructive);
  useAnimatedReaction(
    () => hasDestructive && translation.get() < -fullSwipe.get(),
    (now, before) => {
      if (now !== before) runOnJS(onArm)(now);
    },
  );
  // On a long swipe the red action grows to fill the row, like iOS, and takes
  // all of it once the swipe commits. The other actions' width is worked out
  // here, so the style captures a number rather than the actions themselves.
  const othersWidth = (actions.length - 1) * ACTION_WIDTH;
  const grow = useAnimatedStyle(() => {
    const swiped = Math.max(ACTION_WIDTH, -translation.get() - othersWidth);
    return { width: swiped + (Math.max(swiped, rowWidth.get()) - swiped) * committed.get() };
  });
  // Rows sit on the page with no card behind them, so nothing may show
  // through a row at rest: the actions slide in with the row's trailing
  // edge, filling only the gap it leaves, and wait off the row's end until
  // then. Once a full swipe commits, the red takes the whole row in place.
  const actionsWidth = hasDestructive ? othersWidth : actions.length * ACTION_WIDTH;
  const reveal = useAnimatedStyle(() => {
    const swiped = -translation.get();
    const width = hasDestructive ? actionsWidth + Math.max(ACTION_WIDTH, swiped - actionsWidth) : actionsWidth;
    return { transform: [{ translateX: Math.max(0, width - swiped) * (1 - committed.get()) }] };
  });

  return (
    // Hidden from VoiceOver: under a closed row it would still find them, and
    // its double tap would land on the row. The row offers them as actions.
    <Animated.View style={[{ flexDirection: 'row' }, reveal]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {actions.map((action) => {
        const face = (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${action.label} ${name}`}
            onPress={() => {
              haptics.tap();
              onRun(action);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: action.destructive ? destructiveFill : c.fill }}>
            <BlancText
              variant="footnote"
              weight="600"
              numberOfLines={fits ? 1 : undefined}
              adjustsFontSizeToFit={fits}
              style={{ color: action.destructive ? '#FFFFFF' : c.ink, ...(fits ? { paddingHorizontal: 6 } : null) }}>
              {action.label}
            </BlancText>
          </Pressable>
        );
        return action.destructive ? (
          <Animated.View key={action.label} style={[{ width: ACTION_WIDTH }, grow]}>
            {face}
          </Animated.View>
        ) : (
          <View key={action.label} style={{ width: ACTION_WIDTH }}>
            {face}
          </View>
        );
      })}
    </Animated.View>
  );
}
