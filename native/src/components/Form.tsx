import { DatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';
import { useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { Pressable, Switch, TextInput, View, type KeyboardTypeOptions, type ReturnKeyTypeOptions, type TextInputProps } from 'react-native';

import { haptics } from '~/lib/haptics';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  minHeight: 52,
  paddingLeft: 18,
  paddingRight: 16,
};

/** The instance a TextInput's ref holds. */
export type TextField = ComponentRef<typeof TextInput>;

const NUMBER_PADS = new Set<KeyboardTypeOptions>(['number-pad', 'decimal-pad', 'numeric', 'phone-pad']);

/**
 * iOS's number pads have no return key: with "done" React Native adds the
 * system Done bar above the pad. A field that sets its own return key keeps it.
 */
export function numberPadReturnKey(keyboardType?: KeyboardTypeOptions, returnKeyType?: ReturnKeyTypeOptions) {
  return returnKeyType ?? (keyboardType && NUMBER_PADS.has(keyboardType) ? 'done' : undefined);
}

type FieldRowProps = Omit<TextInputProps, 'style'> & {
  ref?: Ref<TextField | null>;
  label: string;
  /** A unit after the value, such as kcal or g. */
  unit?: string;
  /** Full-width text (a name) instead of a right-aligned number. */
  wide?: boolean;
  invalid?: boolean;
};

/**
 * A labelled field inside a Label, like an iOS settings form row: a tap
 * anywhere on the row puts the cursor in its field. A field that cannot be
 * edited reads in graphite.
 */
export function FieldRow({ ref, label, unit, wide, invalid, keyboardType, returnKeyType, ...input }: FieldRowProps) {
  const c = useBlanc();
  const field = useRef<TextField>(null);
  useImperativeHandle(ref, () => field.current as TextField);
  const locked = input.editable === false;
  return (
    <Pressable accessible={false} onPress={() => field.current?.focus()} disabled={locked} style={rowStyle}>
      <BlancText variant="body" tone={invalid ? 'live' : 'ink'} style={wide ? undefined : { flex: 1 }}>
        {label}
      </BlancText>
      <TextInput
        ref={field}
        placeholderTextColor={c.upcoming}
        accessibilityLabel={label}
        keyboardType={keyboardType}
        returnKeyType={numberPadReturnKey(keyboardType, returnKeyType)}
        lineBreakModeIOS="tail"
        {...input}
        style={[
          typeScale.field,
          { color: locked ? c.graphite : c.ink, padding: 0, minHeight: 44, textAlign: wide ? 'left' : 'right' },
          wide ? { flex: 1 } : { minWidth: 72, fontVariant: ['tabular-nums'] },
        ]}
      />
      {unit ? (
        <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }}>
          {unit}
        </BlancText>
      ) : null}
    </Pressable>
  );
}

/**
 * What a number field shows while it is typed ("1.", "0.", ""), with the
 * number underneath kept valid. Writing the number straight back into the
 * field turned "1." into "1", so a decimal could not be typed.
 */
export function useDecimalText(value: number, onChangeValue: (value: number) => void) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? String(value) : ''));
  useEffect(() => {
    // Follow outside changes (a rescale, a new estimate), never the typing itself.
    setText((current) => {
      const shown = current.trim() === '' || current.trim() === '.' ? 0 : Number(current);
      return shown === value ? current : Number.isFinite(value) ? String(value) : '';
    });
  }, [value]);
  const onChangeText = (next: string) => {
    const cleaned = next.replace(',', '.');
    if (!/^\d*\.?\d*$/.test(cleaned)) return;
    setText(cleaned);
    onChangeValue(cleaned === '' || cleaned === '.' ? 0 : Number(cleaned));
  };
  return { text, onChangeText };
}

/** FieldRow for a decimal number; see useDecimalText. */
export function NumberFieldRow({ value, onChangeValue, ...props }: Omit<FieldRowProps, 'value' | 'onChangeText'> & {
  value: number;
  onChangeValue: (value: number) => void;
}) {
  const { text, onChangeText } = useDecimalText(value, onChangeValue);
  return <FieldRow {...props} keyboardType="decimal-pad" value={text} onChangeText={onChangeText} />;
}

/**
 * A labelled switch row, with an optional quiet line under the label. The
 * switch stays where it was flipped while the change saves (the caller sets
 * `disabled` meanwhile) and goes back only if the saved value differs.
 */
export function ToggleRow({ label, detail, value, onChange, disabled }: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!disabled) setPending(null);
  }, [disabled, value]);
  return (
    <View style={[rowStyle, { paddingVertical: 10 }]}>
      <View style={{ flex: 1 }}>
        <BlancText variant="body">{label}</BlancText>
        {detail ? (
          <BlancText variant="footnote" tone="graphite" style={{ marginTop: 2 }}>
            {detail}
          </BlancText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={pending ?? value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.select();
          setPending(next);
          onChange(next);
        }}
      />
    </View>
  );
}

/** A row holding iOS's compact date or time picker. */
export function PickerRow({ label, value, mode, max, onChange, disabled }: {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  max?: Date;
  onChange: (value: Date) => void;
  disabled?: boolean;
}) {
  const c = useBlanc();
  return (
    <View style={[rowStyle, { opacity: disabled ? 0.5 : 1 }]} pointerEvents={disabled ? 'none' : 'auto'}>
      <BlancText variant="body" style={{ flex: 1 }}>
        {label}
      </BlancText>
      <Host matchContents>
        <DatePicker
          selection={value}
          displayedComponents={[mode === 'date' ? 'date' : 'hourAndMinute']}
          range={max ? { end: max } : undefined}
          onDateChange={(next) => {
            haptics.select();
            onChange(next);
          }}
          modifiers={[datePickerStyle('compact'), labelsHidden(), tint(c.ink)]}
        />
      </Host>
    </View>
  );
}

/** Text under a form block: a hint, or an error in red. */
export function FormNote({ children, alert }: { children: ReactNode; alert?: boolean }) {
  return (
    <BlancText
      variant="footnote"
      tone={alert ? 'live' : 'graphite'}
      accessibilityRole={alert ? 'alert' : undefined}
      style={{ marginHorizontal: 32, marginTop: 8 }}>
      {children}
    </BlancText>
  );
}
