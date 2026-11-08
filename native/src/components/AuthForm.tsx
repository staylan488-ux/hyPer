import type { ComponentRef, Ref } from 'react';
import { Pressable, TextInput, type TextInputProps } from 'react-native';

import { haptics } from '~/lib/haptics';
import { type as typeScale, useBlanc } from '~/theme/blanc';

import { BlancText } from './BlancText';

/** The shortest password the app sends (the project's Supabase minimum). */
export const MIN_PASSWORD_LENGTH = 6;
export const SHORT_PASSWORD_MESSAGE = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;

export type AuthInputRef = ComponentRef<typeof TextInput>;

/** A field of the sign-in and new password forms: one line, 50 pt, on a white Label. */
export function AuthField({ ref, style, ...props }: TextInputProps & { ref?: Ref<AuthInputRef> }) {
  const c = useBlanc();
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={c.graphite}
      selectionColor={c.ink}
      lineBreakModeIOS="tail"
      style={[typeScale.field, { minHeight: 50, paddingHorizontal: 18, color: c.ink }, style]}
      {...props}
    />
  );
}

/** A quiet text button under a form ("Sign up", "Forgot password?"). */
export function TextLink({ title, onPress, disabled, accessibilityHint }: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={10}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({ paddingHorizontal: 6, paddingVertical: 4, opacity: pressed || disabled ? 0.5 : 1 })}>
      <BlancText variant="secondary" weight="600">
        {title}
      </BlancText>
    </Pressable>
  );
}
