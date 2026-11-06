import { DatePicker, Host, Picker, Text as SwiftText } from '@expo/ui/swift-ui';
import { accessibilityLabel as swiftAccessibilityLabel, datePickerStyle, disabled as swiftDisabled, labelsHidden, pickerStyle, tag, tint } from '@expo/ui/swift-ui/modifiers';
import { SymbolView } from 'expo-symbols';
import { Children, useEffect, useImperativeHandle, useRef, useState, type ComponentRef, type ReactNode, type Ref } from 'react';
import { ActionSheetIOS, Pressable, Switch, TextInput, View, type KeyboardTypeOptions, type ReturnKeyTypeOptions, type TextInputProps } from 'react-native';

import { fieldLabel, speak, useAnnounce, useLargeText, useScreenReader } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { space, type as typeScale, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

const rowStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  gap: 12,
  minHeight: 52,
  paddingLeft: 18,
  paddingRight: 16,
};

/**
 * At the accessibility text sizes a form row stacks its label over its
 * control, as iOS's Settings does, so neither is squeezed or cut short.
 */
const stackedRowStyle = {
  gap: 4,
  minHeight: 52,
  paddingLeft: 18,
  paddingRight: 16,
  paddingVertical: 12,
};

/** Text that VoiceOver skips: what it says is part of the control beside it. */
const spokenByControl = { accessibilityElementsHidden: true, importantForAccessibility: 'no' as const };

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
  /**
   * With `wide`: a long value wraps onto more lines and the row grows with
   * it, as the program editor's names do; Return finishes instead of adding a line.
   */
  grows?: boolean;
  /** With grows: Return adds a line and line breaks are kept (notes). */
  paragraphs?: boolean;
  invalid?: boolean;
};

/**
 * A labelled field inside a Label, like an iOS settings form row: a tap
 * anywhere on the row puts the cursor in its field. A field that cannot be
 * edited reads in graphite. VoiceOver finds one element, the field, named
 * with its label and unit ("Protein, grams"); at the accessibility text
 * sizes the label sits over the field.
 */
export function FieldRow({ ref, label, unit, wide, grows, paragraphs, invalid, keyboardType, returnKeyType, accessibilityLabel, ...input }: FieldRowProps) {
  const c = useBlanc();
  const large = useLargeText();
  const field = useRef<TextField>(null);
  useImperativeHandle(ref, () => field.current as TextField);
  const locked = input.editable === false;
  const wraps = Boolean(wide && grows);
  const { onChangeText } = input;
  const name = accessibilityLabel ?? fieldLabel(label, unit);
  const textInput = (
      <TextInput
        selectionColor={c.ink}
        ref={field}
        placeholderTextColor={c.upcoming}
        // The red label's meaning, in words.
        accessibilityLabel={invalid ? `${name}, invalid` : name}
        keyboardType={keyboardType}
        returnKeyType={wraps ? (paragraphs ? returnKeyType : returnKeyType ?? 'done') : numberPadReturnKey(keyboardType, returnKeyType)}
        {...(wraps ? { multiline: true, scrollEnabled: false, submitBehavior: paragraphs ? ('newline' as const) : ('blurAndSubmit' as const) } : null)}
        // Tail truncation is for one line only: in a wrapping field it would cut each paragraph short.
        lineBreakModeIOS={wraps ? undefined : 'tail'}
        {...input}
        onChangeText={wraps && !paragraphs && onChangeText ? (text) => onChangeText(text.replace(/\n/g, ' ')) : onChangeText}
        style={[
          // Wrapped lines keep body's line height; one line takes none (see type.field).
          wraps ? typeScale.fieldLines : typeScale.field,
          { color: locked ? c.graphite : c.ink, padding: 0, minHeight: wraps ? 22 : 44, textAlign: wide ? 'left' : 'right' },
          wraps ? { paddingTop: 0 } : null,
          wide ? { flex: 1 } : { minWidth: 72, fontVariant: ['tabular-nums'] },
          // Stacked under its label, a number starts at the left like a name.
          large ? { flex: 1, textAlign: 'left' } : null,
        ]}
      />
  );
  const unitText = unit ? (
    <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }} {...spokenByControl}>
      {unit}
    </BlancText>
  ) : null;
  return (
    <Pressable
      accessible={false}
      onPress={() => field.current?.focus()}
      disabled={locked}
      // a wrapped value starts on the label's line
      style={large ? stackedRowStyle : wraps ? [rowStyle, { alignItems: 'flex-start', paddingVertical: 15 }] : rowStyle}>
      <BlancText variant="body" tone={invalid ? 'live' : 'ink'} style={wide || large ? undefined : { flex: 1 }} {...spokenByControl}>
        {label}
      </BlancText>
      {large ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {textInput}
          {unitText}
        </View>
      ) : (
        <>
          {textInput}
          {unitText}
        </>
      )}
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
 * VoiceOver finds one element, the switch, named with the label and the
 * quiet line, as iOS reads a settings cell with a subtitle.
 */
export function ToggleRow({ label, detail, value, onChange, disabled, list }: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** Among list Rows rather than form fields: 60 pt, label and line as a Row's. */
  list?: boolean;
}) {
  const c = useBlanc();
  const [pending, setPending] = useState<boolean | null>(null);
  useEffect(() => {
    if (!disabled) setPending(null);
  }, [disabled, value]);
  return (
    <View style={[rowStyle, { paddingVertical: 10 }, list ? { minHeight: detail ? 60 : 52 } : null]}>
      <View style={{ flex: 1 }} {...spokenByControl}>
        <BlancText variant={list && detail ? 'bodyStrong' : 'body'}>{label}</BlancText>
        {detail ? (
          <BlancText variant={list ? 'secondary' : 'footnote'} tone="graphite" style={{ marginTop: list ? 1 : 2 }}>
            {detail}
          </BlancText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
        trackColor={{ true: c.switchOn }}
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

/**
 * A row holding iOS's compact date or time picker. The picker carries the
 * label for VoiceOver (SwiftUI keeps a hidden label for it); at the
 * accessibility text sizes the label sits over the picker.
 */
export function PickerRow({ label, value, mode, min, max, onChange, disabled }: {
  label: string;
  value: Date;
  mode: 'date' | 'time';
  /** The earliest selectable value (a time on the same day as value). */
  min?: Date;
  max?: Date;
  onChange: (value: Date) => void;
  disabled?: boolean;
}) {
  const c = useBlanc();
  const large = useLargeText();
  const screenReader = useScreenReader();
  return (
    <View
      style={[large ? [stackedRowStyle, { alignItems: 'flex-start' as const }] : rowStyle, { opacity: disabled ? 0.5 : 1 }]}
      pointerEvents={disabled ? 'none' : 'auto'}>
      <BlancText variant="body" style={large ? undefined : { flex: 1 }} {...spokenByControl}>
        {label}
      </BlancText>
      <Host matchContents>
        <DatePicker
          title={label}
          selection={value}
          displayedComponents={[mode === 'date' ? 'date' : 'hourAndMinute']}
          range={min || max ? { start: min, end: max } : undefined}
          onDateChange={(next) => {
            haptics.select();
            onChange(next);
          }}
          // pointerEvents stops touches only; VoiceOver acts without them, so while it
          // runs SwiftUI's own disabled state holds the picker. Without VoiceOver the
          // modifiers stay as they were, so the row's fade is the only dimming.
          modifiers={[datePickerStyle('compact'), labelsHidden(), tint(c.ink), ...(disabled && screenReader ? [swiftDisabled(true)] : [])]}
        />
      </Host>
    </View>
  );
}

/**
 * A label and iOS's pull-down menu of choices, like a Settings row. The menu
 * carries the name for VoiceOver (one stop: "Type, Run"). At the
 * accessibility text sizes the choice sits under its label as wrapping text
 * and a tap lists the choices in an action sheet: iOS's menu button keeps its
 * label on one line, so a long choice ran off the screen.
 */
export function MenuRow({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const c = useBlanc();
  const large = useLargeText();
  if (large) {
    const current = options.find((option) => option.value === value)?.label ?? value;
    const choose = () => {
      const labels = [...options.map((option) => option.label), 'Cancel'];
      ActionSheetIOS.showActionSheetWithOptions({ title: label, options: labels, cancelButtonIndex: options.length }, (index) => {
        const next = options[index];
        if (!next || next.value === value) return;
        haptics.select();
        onChange(next.value);
      });
    };
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={speak(`${label}, ${current}`)}
        accessibilityHint="Shows the choices"
        onPress={choose}
        style={({ pressed }) => [stackedRowStyle, { backgroundColor: pressed ? c.pressed : 'transparent' }]}>
        <BlancText variant="body">{label}</BlancText>
        <BlancText variant="body" tone="graphite">
          {current}
        </BlancText>
      </Pressable>
    );
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, paddingLeft: 18, paddingRight: 8 }}>
      <BlancText variant="body" style={{ flex: 1 }} {...spokenByControl}>
        {label}
      </BlancText>
      <Host matchContents>
        <Picker
          selection={value}
          onSelectionChange={(next) => {
            if (next === value) return;
            haptics.select();
            onChange(String(next));
          }}
          modifiers={[pickerStyle('menu'), tint(c.graphite), swiftAccessibilityLabel(label)]}>
          {options.map((option) => (
            <SwiftText key={option.value} modifiers={[tag(option.value)]}>
              {option.label}
            </SwiftText>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

/** One choice of a list (a radio row): a fixed title, an optional quiet line, a checkmark when chosen. */
export function ChoiceRow({ title, detail, checked, onPress }: { title: string; detail?: string; checked: boolean; onPress: () => void }) {
  const c = useBlanc();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked }}
      accessibilityLabel={speak(detail ? `${title}, ${detail}` : title)}
      onPress={() => {
        if (!checked) haptics.select();
        onPress();
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingVertical: 10,
        paddingLeft: 18,
        paddingRight: 16,
        backgroundColor: pressed ? c.pressed : 'transparent',
      })}>
      <View style={{ flex: 1 }}>
        <BlancText variant="bodyStrong">{title}</BlancText>
        {detail ? (
          <BlancText variant="secondary" tone="graphite" style={{ marginTop: 1 }}>
            {detail}
          </BlancText>
        ) : null}
      </View>
      {checked ? <SymbolView name="checkmark" size={15} weight="semibold" tintColor={c.ink} /> : null}
    </Pressable>
  );
}

/** Plain text children as one string (null when they hold anything else). */
function plainText(children: ReactNode): string | null {
  let text = '';
  for (const child of Children.toArray(children)) {
    if (typeof child === 'string' || typeof child === 'number') text += String(child);
    else return null;
  }
  return text;
}

/**
 * Text under a form block: a hint, or an error in red. Starts on the row
 * text's edge. VoiceOver announces an error when it appears or changes (iOS
 * has no live regions).
 */
export function FormNote({ children, alert, accessibilityLabel, announcement }: {
  children: ReactNode;
  alert?: boolean;
  accessibilityLabel?: string;
  /** What VoiceOver announces, when it should differ from what it reads: text with live numbers would be announced again on every keystroke. */
  announcement?: string;
}) {
  useAnnounce(alert ? (announcement ?? accessibilityLabel ?? plainText(children)) : null);
  return (
    <BlancText
      variant="footnote"
      tone={alert ? 'live' : 'graphite'}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={alert ? 'alert' : undefined}
      style={{ marginHorizontal: space.inset + 18, marginTop: 8 }}>
      {children}
    </BlancText>
  );
}
