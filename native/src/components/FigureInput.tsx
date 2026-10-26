import { useState } from 'react';
import { Text, TextInput, View, type TextInputProps, type TextStyle } from 'react-native';

import { type as typeScale, useBlanc } from '~/theme/blanc';

type FigureInputProps = Omit<TextInputProps, 'style'> & { value: string; fontSize: number };

/**
 * A big thin number you can type into. A text input keeps the width it was
 * first given, so an invisible copy of the text measures the width the
 * number needs and the field hugs it as the value changes.
 */
export function FigureInput({ value, fontSize, placeholder = '0', ...rest }: FigureInputProps) {
  const c = useBlanc();
  const [width, setWidth] = useState(0);
  const style: TextStyle[] = [
    typeScale.figure,
    { fontSize, lineHeight: Math.round(fontSize * 1.1), letterSpacing: -fontSize * 0.026, color: c.ink, padding: 0 },
  ];

  return (
    <View>
      <Text
        style={[...style, { position: 'absolute', opacity: 0 }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {value || placeholder}
      </Text>
      <TextInput
        {...rest}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={c.upcoming}
        style={[...style, { width: Math.ceil(width) + 2 }]}
      />
    </View>
  );
}
