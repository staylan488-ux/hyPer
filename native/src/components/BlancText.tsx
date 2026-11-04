import { Children, type ReactNode } from 'react';
import { Text, type TextProps, type TextStyle } from 'react-native';

import { spokenLabel } from '~/lib/accessibility';
import { type Palette, type as typeScale, useBlanc } from '~/theme/blanc';
import { ROLE_MAX_SCALE, ROLE_RAMPS } from '~/theme/textSize';

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

/**
 * How a role grows with iOS's text size: as its iOS text style does, and no
 * further than its cap (big figures). See theme/textSize.
 */
export function textSizing(variant: Variant): Pick<TextProps, 'dynamicTypeRamp' | 'maxFontSizeMultiplier'> {
  return { dynamicTypeRamp: ROLE_RAMPS[variant] ?? undefined, maxFontSizeMultiplier: ROLE_MAX_SCALE[variant] };
}

/** Plain text children ("In progress · ", 12, " min") as one string; null when they hold anything else. */
function plainText(children: ReactNode): string | null {
  let text = '';
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') text += String(child);
    else return null;
  }
  return text;
}

/**
 * System text in a Blanc role. `size` and `weight` adjust a role in place.
 * It grows with iOS's text size like its iOS text style, and VoiceOver reads
 * Blanc's shorthand in words ("8–10 reps · 135 lb" as "8 to 10 reps, 135
 * pounds") unless a label is given.
 */
export function BlancText({ variant = 'body', tone = 'ink', size, weight, style, children, accessibilityLabel, ...rest }: BlancTextProps) {
  const c = useBlanc();
  const plain = accessibilityLabel === undefined ? plainText(children) : null;
  return (
    <Text
      {...textSizing(variant)}
      {...rest}
      accessibilityLabel={accessibilityLabel ?? (plain ? spokenLabel(plain) : undefined)}
      style={[...blancTextStyle(c, variant, tone, size, weight), style]}>
      {children}
    </Text>
  );
}
