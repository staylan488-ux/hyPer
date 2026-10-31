import { Text, type TextProps, type TextStyle } from 'react-native';

import { type Palette, type as typeScale, useBlanc } from '~/theme/blanc';

type Variant = keyof typeof typeScale;
type Tone = 'ink' | 'graphite' | 'upcoming' | 'live' | 'onCapsule';

export type BlancTextProps = TextProps & {
  variant?: Variant;
  tone?: Tone;
  size?: number;
  weight?: TextStyle['fontWeight'];
};

/** A Blanc role's text style, with `size` and `weight` adjusting it in place. */
export function blancTextStyle(c: Palette, variant: Variant = 'body', tone: Tone = 'ink', size?: number, weight?: TextStyle['fontWeight']): TextStyle[] {
  return [
    typeScale[variant],
    { color: c[tone] },
    ...(size !== undefined ? [{ fontSize: size, lineHeight: Math.round(size * 1.08) }] : []),
    ...(weight !== undefined ? [{ fontWeight: weight }] : []),
  ];
}

/** System text in a Blanc role. `size` and `weight` adjust a role in place. */
export function BlancText({ variant = 'body', tone = 'ink', size, weight, style, ...rest }: BlancTextProps) {
  const c = useBlanc();
  return <Text {...rest} style={[...blancTextStyle(c, variant, tone, size, weight), style]} />;
}
