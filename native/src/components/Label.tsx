import type { ComponentProps } from 'react';
import Animated from 'react-native-reanimated';

import { space } from '~/theme/blanc';

type LabelProps = ComponentProps<typeof Animated.View> & {
  /** Inside a parent that already keeps the gutter: no outer margin. */
  bleed?: boolean;
};

/**
 * A block of content on the page. Blanc has no cards: what used to be the
 * white label is now only a grouping, with no fill, corners or edge, so its
 * rows and figures sit straight on the ground (and the glass behind it).
 * Hierarchy comes from type, space and hairlines.
 *
 * Its content keeps the label's 18 pt inner edge (`space.labelPad`), so the
 * block reaches 2 pt past the screen's left edge and that inner edge lands on
 * the 16 pt gutter, in line with the large title and the section headers. A
 * row's press highlight runs the screen's full width, as in iOS's own plain
 * lists. It takes Reanimated's `layout`, so a group grows and shrinks with
 * its rows instead of snapping.
 */
export function Label({ bleed, style, children, ...rest }: LabelProps) {
  return (
    <Animated.View {...rest} style={[bleed ? null : { marginLeft: space.gutter - space.labelPad, marginRight: 0 }, style]}>
      {children}
    </Animated.View>
  );
}
