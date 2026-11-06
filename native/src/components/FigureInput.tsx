import { useState, type Ref } from 'react';
import { Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';

import { figureLead, type as typeScale, useBlanc } from '~/theme/blanc';
import { FIGURE_MAX_SCALE } from '~/theme/textSize';

import { numberPadReturnKey, type TextField } from './Form';

type FigureInputProps = Omit<TextInputProps, 'style'> & { ref?: Ref<TextField>; value: string; fontSize: number };

/**
 * A big thin number you can type into. A text input keeps the width it was
 * first given, so an invisible copy of the text measures the width the
 * number needs and the field hugs it as the value changes, so a "9" sits
 * beside its unit. A figure narrower than a fingertip reaches 44 pt to touch
 * through hit slop, inside a box that overhangs it by the same amount (a
 * touch outside the parent's box would not land). Number pads get iOS's
 * Done bar unless the screen brings its own keys. It grows with the text
 * size like the figures it sits among, up to their cap.
 */
export function FigureInput({ ref, value, fontSize, placeholder = '–', keyboardType, returnKeyType, ...rest }: FigureInputProps) {
  const c = useBlanc();
  const [width, setWidth] = useState(0);
  const fieldWidth = Math.ceil(width) + 2;
  const slop = Math.max(0, Math.ceil((44 - fieldWidth) / 2));
  const style: TextStyle[] = [
    typeScale.figure,
    { fontSize, lineHeight: Math.round(fontSize * 1.1), letterSpacing: -fontSize * 0.026, color: c.ink, padding: 0 },
  ];

  return (
    // Pulled left by the first digit's side bearing, so the ink (not the box) starts where the ruled line does.
    <View style={{ paddingHorizontal: slop, marginLeft: -slop + figureLead(value || placeholder, fontSize), marginRight: -slop }}>
      <Text
        maxFontSizeMultiplier={FIGURE_MAX_SCALE}
        style={[...style, { position: 'absolute', opacity: 0 }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {value || placeholder}
      </Text>
      <TextInput
        selectionColor={c.ink}
        ref={ref}
        {...rest}
        keyboardType={keyboardType}
        returnKeyType={numberPadReturnKey(keyboardType, returnKeyType)}
        maxFontSizeMultiplier={FIGURE_MAX_SCALE}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={c.upcoming}
        hitSlop={{ left: slop, right: slop }}
        style={[...style, { width: fieldWidth }]}
      />
    </View>
  );
}
