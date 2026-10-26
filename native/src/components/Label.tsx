import { View, type ViewProps } from 'react-native';

import { radius, space, useBlanc } from '~/theme/blanc';

type LabelProps = ViewProps & {
  /** Sit flush with the screen gutter instead of the card inset. */
  bleed?: boolean;
};

/** The white label: Blanc's one container. */
export function Label({ bleed, style, children, ...rest }: LabelProps) {
  const c = useBlanc();
  return (
    <View
      {...rest}
      style={[
        {
          marginHorizontal: bleed ? 0 : space.inset,
          backgroundColor: c.label,
          borderRadius: radius.label,
          borderCurve: 'continuous',
          boxShadow: `0 0 0 0.5px ${c.labelEdge}, 0 1px 2px rgba(0, 0, 0, 0.03)`,
        },
        style,
      ]}>
      {children}
    </View>
  );
}
