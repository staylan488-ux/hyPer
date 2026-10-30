import { Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  animation,
  Animation,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  kerning,
  lineLimit,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { figureAlignment, ROLL_SECONDS, rollsDown } from '~/lib/rollingFigure';
import { useBlanc } from '~/theme/blanc';

import { BlancText, blancTextStyle, type BlancTextProps } from './BlancText';

type SwiftWeight = 'ultraLight' | 'thin' | 'light' | 'regular' | 'medium' | 'semibold' | 'bold' | 'heavy' | 'black';
const WEIGHTS: Record<string, SwiftWeight> = {
  '100': 'ultraLight',
  '200': 'thin',
  '300': 'light',
  '400': 'regular',
  normal: 'regular',
  '500': 'medium',
  '600': 'semibold',
  '700': 'bold',
  bold: 'bold',
  '800': 'heavy',
  '900': 'black',
};

// Styles that place the figure among its neighbours belong to the wrapper;
// the rest draw the text.
const PLACEMENT = new Set([
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical',
  'marginStart', 'marginEnd', 'alignSelf', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'position',
  'top', 'bottom', 'left', 'right', 'zIndex',
]);

/**
 * Text whose digits roll when it changes, the way iOS's own figures do (the
 * Clock timer, Health's totals): each changed digit slides out and the new
 * one slides in, up when the number grows and down when it shrinks. It is
 * SwiftUI's numeric text transition, drawn over a hidden copy of the same
 * React Native text, so layout, baselines and VoiceOver stay exactly as a
 * BlancText's. Reduce Motion swaps the roll for a plain change.
 *
 * One line only. `countsDown` fixes the direction (a countdown); otherwise
 * it follows the number. The hidden copy takes its new width at once, so
 * text beside a figure that can gain or lose a digit moves with the roll
 * (`figureLayout`), and a figure whose right edge is fixed aligns right.
 */
export function RollingText({ children, countsDown, style, variant = 'body', tone = 'ink', size, weight, ...rest }: Omit<BlancTextProps, 'children'> & {
  children: string;
  countsDown?: boolean;
}) {
  const c = useBlanc();
  const { fontScale } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const text = children;

  // Each change is one step of the animation, with its own direction.
  const [step, setStep] = useState({ text, count: 0, down: false });
  if (step.text !== text) {
    setStep({ text, count: step.count + 1, down: rollsDown(step.text, text) });
  }

  const flat = StyleSheet.flatten([blancTextStyle(c, variant, tone, size, weight), style]) as TextStyle;
  const placement: Record<string, unknown> = {};
  const drawing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(flat)) (PLACEMENT.has(key) ? placement : drawing)[key] = value;
  const textStyle = drawing as TextStyle;

  const fontSize = (textStyle.fontSize ?? 17) * fontScale;
  const alignment = figureAlignment(textStyle.textAlign);
  const tabular = Array.isArray(textStyle.fontVariant) && textStyle.fontVariant.includes('tabular-nums');
  const color = typeof textStyle.color === 'string' ? textStyle.color : c[tone];

  const modifiers = [
    font({
      size: fontSize,
      weight: WEIGHTS[String(textStyle.fontWeight ?? '400')] ?? 'regular',
      ...(textStyle.fontFamily ? { family: textStyle.fontFamily } : {}),
    }),
    ...(tabular ? [monospacedDigit()] : []),
    ...(textStyle.letterSpacing ? [kerning(textStyle.letterSpacing * fontScale)] : []),
    foregroundStyle(color),
    lineLimit(1),
    fixedSize(),
    accessibilityHidden(true),
    ...(reducedMotion
      ? []
      : [contentTransition('numericText', { countsDown: countsDown ?? step.down }), animation(Animation.smooth({ duration: ROLL_SECONDS }), step.count)]),
  ];

  return (
    <View style={placement as StyleProp<ViewStyle>}>
      <BlancText {...rest} numberOfLines={1} style={[textStyle, { color: 'transparent' }]}>
        {text}
      </BlancText>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        {/* Safe areas ignored: a figure scrolled under the bars must not shift inside its box. */}
        <Host style={StyleSheet.absoluteFill} alignment={alignment} ignoreSafeArea="all" pointerEvents="none">
          <SwiftText modifiers={modifiers}>{text}</SwiftText>
        </Host>
      </View>
    </View>
  );
}
