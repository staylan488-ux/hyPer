import { Host, Text as SwiftText } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  animation,
  Animation,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  monospacedDigit,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import { figureFrame, ROLL_SECONDS, rollsDown } from '~/lib/rollingFigure';
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

/** Where the screen-wide Host sits on the figure's box: from the edge the text aligns to. */
function hostSide(textAlign: TextStyle['textAlign'], room: number): ViewStyle {
  if (textAlign === 'right') return { right: 0 };
  if (textAlign === 'center') return { left: '50%', marginLeft: -room / 2 };
  return { left: 0 };
}

/**
 * Text whose digits roll when it changes, the way iOS's own figures do (the
 * Clock timer, Health's totals): each changed digit slides out and the new
 * one slides in, up when the number grows and down when it shrinks. It is
 * SwiftUI's numeric text transition, drawn over a hidden copy of the same
 * React Native text, so layout, baselines and VoiceOver stay exactly as a
 * BlancText's. Reduce Motion swaps the roll for a plain change.
 *
 * One line only. `countsDown` fixes the direction (a countdown); otherwise
 * it follows the number. When the figure gains or loses a digit, its
 * drawn frame grows or shrinks over the roll while the hidden copy takes
 * the new width at once: text beside it moves on the same spring
 * (`figureLayout`), and a figure whose right edge is fixed aligns right.
 */
export function RollingText({ children, countsDown, style, variant = 'body', tone = 'ink', size, weight, ...rest }: Omit<BlancTextProps, 'children'> & {
  children: string;
  countsDown?: boolean;
}) {
  const c = useBlanc();
  const { fontScale, width: room } = useWindowDimensions();
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
  const placed = figureFrame(textStyle.textAlign, textStyle.fontSize ?? 17, textStyle.lineHeight);
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
    ...(reducedMotion ? [] : [contentTransition('numericText', { countsDown: countsDown ?? step.down })]),
    // The copy keeps its place in the Host's box however tall or wide it is
    // (the Host would centre an overflow)...
    frame({ minWidth: 0, maxWidth: Infinity, minHeight: 0, maxHeight: Infinity, alignment: placed }),
    // ...and the animation takes its frame from the old width to the new one
    // along with the digits, as a SwiftUI figure in a row does.
    ...(reducedMotion ? [] : [animation(Animation.smooth({ duration: ROLL_SECONDS }), step.count)]),
  ];

  return (
    <View style={placement as StyleProp<ViewStyle>}>
      <BlancText {...rest} numberOfLines={1} style={[textStyle, { color: 'transparent' }]}>
        {text}
      </BlancText>
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        {/*
          The Host is a screen wide, from the edge the figure keeps (its
          start, end or middle), so its box never changes with the text and the
          figure's frame can grow or shrink inside it. Safe areas ignored: a
          figure scrolled under the bars must not shift.
        */}
        <Host style={[{ position: 'absolute', top: 0, bottom: 0, width: room }, hostSide(textStyle.textAlign, room)]} ignoreSafeArea="all" pointerEvents="none">
          <SwiftText modifiers={modifiers}>{text}</SwiftText>
        </Host>
      </View>
    </View>
  );
}
