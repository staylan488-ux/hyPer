import { useState } from 'react';
import { Keyboard, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/stores/authStore';
import { AuthField, MIN_PASSWORD_LENGTH, SHORT_PASSWORD_MESSAGE, TextLink } from '~/components/AuthForm';
import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { Label } from '~/components/Label';
import { Hairline } from '~/components/Row';
import { announce, useAnnounce } from '~/lib/accessibility';
import { authErrorWords } from '~/lib/auth';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Opened by a password reset link: the link signed in on this phone, and the
 * new password comes before the app. Saving it (or Not now) opens the app.
 */
export default function NewPassword() {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const email = useAuthStore((state) => state.user?.email ?? '');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useAnnounce(error);

  const canSave = password.length >= MIN_PASSWORD_LENGTH && !saving;

  const save = async () => {
    if (saving) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      haptics.error();
      setError(SHORT_PASSWORD_MESSAGE);
      return;
    }
    Keyboard.dismiss();
    setError(null);
    setSaving(true);
    const { error: saveError } = await useAuthStore.getState().updatePassword(password);
    setSaving(false);
    if (saveError) {
      haptics.error();
      setError(authErrorWords(saveError.message));
      return;
    }
    // The app takes over from here (authScreen).
    haptics.success();
    announce('Password saved');
  };

  return (
    <KeyboardAwareScrollView showsVerticalScrollIndicator={false}
      bottomOffset={24}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 28 }}>
      <View style={{ paddingHorizontal: space.gutter, alignItems: 'flex-start' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <BrandMark size={EMBLEM_MARK_SIZE} anchor tight />
      </View>
      <View style={{ paddingHorizontal: space.gutter, gap: 10, marginTop: 18, marginBottom: 24 }}>
        <BlancText variant="title" size={34} weight="700" accessibilityRole="header">
          New password
        </BlancText>
        <BlancText variant="secondary" tone="graphite">
          You’re signed in from the reset link. Choose the password you’ll use from now on.
        </BlancText>
      </View>

      <Label>
        {/* The account it belongs to, for iOS's Passwords to save it under. */}
        {email ? (
          <>
            <AuthField
              value={email}
              editable={false}
              accessibilityLabel={`Account, ${email}`}
              textContentType="username"
              autoComplete="email"
              style={{ color: c.graphite }}
            />
            <Hairline />
          </>
        ) : null}
        <AuthField
          value={password}
          onChangeText={(next) => {
            if (error === SHORT_PASSWORD_MESSAGE && next.length >= MIN_PASSWORD_LENGTH) setError(null);
            setPassword(next);
          }}
          placeholder="New password"
          accessibilityLabel="New password"
          autoFocus
          secureTextEntry
          textContentType="newPassword"
          autoComplete="new-password"
          passwordRules={`minlength: ${MIN_PASSWORD_LENGTH};`}
          enablesReturnKeyAutomatically
          returnKeyType="done"
          onSubmitEditing={() => void save()}
        />
      </Label>

      {error ? (
        <BlancText variant="secondary" tone="live" accessibilityRole="alert" style={{ marginHorizontal: space.gutter, marginTop: 14 }}>
          {error}
        </BlancText>
      ) : null}

      <View style={{ marginHorizontal: space.inset, marginTop: 18 }}>
        <Capsule title="Save password" size="large" fill busy={saving} disabled={!canSave} onPress={() => void save()} />
      </View>

      <View style={{ alignItems: 'center', marginTop: 22 }}>
        <TextLink
          title="Not now"
          accessibilityHint="Opens the app and keeps your old password"
          disabled={saving}
          onPress={() => useAuthStore.getState().endPasswordRecovery()}
        />
      </View>
    </KeyboardAwareScrollView>
  );
}
