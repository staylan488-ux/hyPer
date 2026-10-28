import { Text, type TextProps, type TextStyle } from 'react-native';

import { type as typeScale, useBlanc } from '~/theme/blanc';

type Variant = keyof typeof typeScale;
type Tone = 'ink' | 'graphite' | 'upcoming' | 'live' | 'onCapsule';

export type BlancTextProps = TextProps & {
  variant?: Variant;
  tone?: Tone;
  size?: number;
  weight?: TextStyle['fontWeight'];
};

/** System text in a Blanc role. `size` and `weight` adjust a role in place. */
export function BlancText({ variant = 'body', tone = 'ink', size, weight, style, ...rest }: BlancTextProps) {
  const c = useBlanc();
  return (
    <Text
      {...rest}
      style={[
        typeScale[variant],
        { color: c[tone] },
        size !== undefined && { fontSize: size, lineHeight: Math.round(size * 1.08) },
        weight !== undefined && { fontWeight: weight },
        style,
      ]}
    />
  );
}
