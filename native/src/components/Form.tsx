import { DatePicker, Host } from '@expo/ui/swift-ui';
import { datePickerStyle, labelsHidden, tint } from '@expo/ui/swift-ui/modifiers';
import type { ReactNode } from 'react';
import { Switch, TextInput, View, type TextInputProps } from 'react-native';

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

type FieldRowProps = Omit<TextInputProps, 'style'> & {
  label: string;
  /** A unit after the value, such as kcal or g. */
  unit?: string;
  /** Full-width text (a name) instead of a right-aligned number. */
  wide?: boolean;
  invalid?: boolean;
};

/** A labelled field inside a Label, like an iOS settings form row. */
export function FieldRow({ label, unit, wide, invalid, ...input }: FieldRowProps) {
  const c = useBlanc();
  return (
    <View style={rowStyle}>
      <BlancText variant="body" tone={invalid ? 'live' : 'ink'} style={wide ? undefined : { flex: 1 }}>
        {label}
      </BlancText>
      <TextInput
        placeholderTextColor={c.upcoming}
        accessibilityLabel={label}
        {...input}
        style={[
          typeScale.body,
          { color: c.ink, padding: 0, minHeight: 44, textAlign: wide ? 'left' : 'right' },
          wide ? { flex: 1 } : { minWidth: 72, fontVariant: ['tabular-nums'] },
        ]}
      />
      {unit ? (
        <BlancText variant="body" tone="graphite" style={{ minWidth: 30 }}>
          {unit}
        </BlancText>
      ) : null}
    </View>
  );
}

/** A labelled switch row, with an optional quiet line under the label. */
export function ToggleRow({ label, detail, value, onChange, disabled }: {
  label: string;
  detail?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
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
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          haptics.select();
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
