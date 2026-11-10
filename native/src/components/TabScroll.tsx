import { useEffect, useRef, useState, type ComponentRef, type ReactNode, type Ref, type RefObject } from 'react';
import { Platform, ScrollView, Settings, View, type ScrollViewProps } from 'react-native';
import { initialWindowMetrics } from 'react-native-safe-area-context';

import { scrollRoomExtra } from '~/lib/scrollRoom';
import { useWorkoutBarShown } from '~/lib/workoutBar';

import { glassDemoOn, useDemoScrollTarget } from './GlassDemo';
import { makeGlassScrollStir } from './GlassField';
import { dismissOpenSwipeRow } from './SwipeRow';

const END_SPACE = 48;
// What iOS 26 covers beyond the window's safe area on a tab page, measured
// from scroll offsets on iPhone 17 Pro. The safe-area hooks can't be used:
// inside a tab they report different values depending on which tab is showing.
const NAV_BAR_WITH_LARGE_TITLE = 106;
const TAB_BAR = 49;
const WORKOUT_ACCESSORY = 56;
const windowInsets = initialWindowMetrics?.insets ?? { top: 59, bottom: 34 };

/** How far a tab page has scrolled from rest, under a large title. */
export function scrolledFromRest(offsetY: number): number {
  return offsetY + windowInsets.top + NAV_BAR_WITH_LARGE_TITLE;
}

/** How much of a tab page the tab bar (and the workout bar above it) covers at the foot. */
export function tabBarCover(accessory: boolean): number {
  return windowInsets.bottom + TAB_BAR + (accessory ? WORKOUT_ACCESSORY : 0);
}

// Debug builds log the sizing with the launch argument `-hyperTrace 1`.
const trace = __DEV__ && Settings.get('hyperTrace') === '1';

type TabScrollProps = Omit<ScrollViewProps, 'contentContainerStyle'> & {
  ref?: Ref<ComponentRef<typeof ScrollView>>;
  children: ReactNode;
};

/**
 * The scroll view for a tab's root page. A page that scrolls at all gets enough
 * quiet space at the end for iOS to shrink the tab bar reliably
 * ([scroll room](../lib/scrollRoom.ts)); pages that fit are left alone.
 */
export function TabScroll({ children, onLayout, ref, ...props }: TabScrollProps) {
  // Scrolling stirs the glass behind the page a little (one tracker per scroll view).
  const [stir] = useState(makeGlassScrollStir);
  // The caller's ref, plus our own for the debug demo (-hyperDemo glass), which scrolls the page on screen.
  const own = useRef<ComponentRef<typeof ScrollView> | null>(null);
  const outer = useRef(ref);
  outer.current = ref;
  const [merged] = useState(() => (node: ComponentRef<typeof ScrollView> | null) => {
    own.current = node;
    const r = outer.current;
    if (typeof r === 'function') r(node);
    else if (r) (r as RefObject<ComponentRef<typeof ScrollView> | null>).current = node;
  });
  useDemoScrollTarget(own);
  // The workout bar's height counts only while it is showing (it steps aside on Today and Train).
  const accessory = useWorkoutBarShown((state) => state.shown);
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const extra =
    Platform.OS === 'ios'
      ? scrollRoomExtra({
          viewport,
          content,
          endSpace: END_SPACE,
          insetTop: windowInsets.top + NAV_BAR_WITH_LARGE_TITLE,
          insetBottom: tabBarCover(accessory),
        })
      : 0;

  useEffect(() => {
    if (trace) console.log(`[room] viewport=${viewport} content=${content} accessory=${accessory} extra=${extra}`);
  }, [viewport, content, accessory, extra]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      scrollEventThrottle={16}
      // No scroll bar: on a page with no cards it reads as a web page's (the large title and the
      // tab bar already answer a scroll). A page that needs one can ask for it.
      showsVerticalScrollIndicator={false}
      {...props}
      ref={merged}
      // The demo scrolls back up under the large title, past React Native's clamp at 0.
      scrollToOverflowEnabled={glassDemoOn || props.scrollToOverflowEnabled}
      onScroll={(event) => {
        stir(event);
        props.onScroll?.(event);
      }}
      // Scrolling closes a row left swiped open, as iOS lists do.
      onScrollBeginDrag={(event) => {
        dismissOpenSwipeRow();
        props.onScrollBeginDrag?.(event);
      }}
      onLayout={(event) => {
        setViewport(event.nativeEvent.layout.height);
        onLayout?.(event);
      }}
      contentContainerStyle={{ paddingBottom: END_SPACE + extra }}>
      <View onLayout={(event) => setContent(event.nativeEvent.layout.height)}>{children}</View>
    </ScrollView>
  );
}
