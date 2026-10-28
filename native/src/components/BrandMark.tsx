import { useEffect, useRef, type ComponentRef } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { windowFrame } from '../../modules/hyper-view';
import { markShown, registerMarkAnchor } from '~/lib/brand';
import { markBox, markInkInsets, PAD } from '~/lib/brandGeometry';
import { useBlanc } from '~/theme/blanc';

/**
 * Fraunces Mark: the P in Medium Italic, and Light only while the intro spells
 * the word. Named by family, weight and style: given a face name alone, React
 * Native's renderer drops the italic and picks the upright Light instead.
 */
export const markFace = { fontFamily: 'Fraunces Mark', fontWeight: '500', fontStyle: 'italic' } as const;
export const wordFace = { fontFamily: 'Fraunces Mark', fontWeight: '300', fontStyle: 'normal' } as const;

/** Font sizes: Today's corner, and the emblem on sign-in and offline. */
export const HEADER_MARK_SIZE = 30;
export const EMBLEM_MARK_SIZE = 48;

/**
 * The corner mark's header item. iOS centres an item narrower than 44 points
 * in a 44-point slot; filling the slot puts the P at the bar's leading edge.
 */
export const headerMarkSlot = { width: 44, alignItems: 'flex-start' } as const;

type BrandMarkProps = {
  /** Font size in points. */
  size: number;
  /** The launch intro lands here; hidden until it hands over. */
  anchor?: boolean;
  /** Lay out by the ink, not the text box: no room above the cap, below the baseline or before the stem. */
  tight?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** hyPer's mark: the red italic P. */
export function BrandMark({ size, anchor = false, tight = false, style }: BrandMarkProps) {
  const c = useBlanc();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const box = markBox(size);
  const ink = markInkInsets(size);

  useEffect(() => {
    if (!anchor) return;
    return registerMarkAnchor(async () => {
      const frame = await windowFrame(ref.current);
      return frame ? { ...frame, size } : null;
    });
  }, [anchor, size]);

  const shown = useAnimatedStyle(() => ({ opacity: anchor ? markShown.value : 1 }));

  // The outer view is the caller's to lay out; the inner one is the P's text
  // box, which the intro measures and lands on.
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="hyPer" style={style}>
      <View
        ref={ref}
        collapsable={false}
        style={[
          { width: box.width, height: box.height },
          tight && { marginTop: -ink.top, marginBottom: -ink.bottom, marginLeft: -ink.left },
        ]}>
        <Animated.Text
          allowFontScaling={false}
          style={[markFace, { fontSize: size, color: c.brand, paddingHorizontal: PAD * size }, shown]}>
          P
        </Animated.Text>
      </View>
    </View>
  );
}
