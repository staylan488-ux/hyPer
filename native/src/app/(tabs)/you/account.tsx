import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Alert, Keyboard, View } from 'react-native';

import { signOutQuestion } from '@/lib/settingsUx';
import { useAuthStore } from '@/stores/authStore';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { announce, useAnnounce } from '~/lib/accessibility';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { isPreviewActive } from '~/platform/previewFlag';
import { space } from '~/theme/blanc';

/** Account: the name the app greets you by, signing out and deleting the account. */
export default function AccountScreen() {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const saved = profile?.display_name || '';
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const draft = name ?? saved;
  const changed = draft.trim() !== saved;
  // Save name goes away once the name saves, and VoiceOver's focus with it;
  // an error announces itself (FormNote).
  useAnnounce(message && !message.alert ? message.text : null);

  useLeaveGuard(changed, { title: 'Discard your new name?' }, { busy: saving });

  const save = async () => {
    if (saving || !changed) return;
    Keyboard.dismiss();
    setSaving(true);
    setMessage(null);
    const { error } = await useAuthStore.getState().updateDisplayName(draft);
    setSaving(false);
    if (error) {
      haptics.error();
      setMessage({ text: 'Could not save your name. Please try again.', alert: true });
      return;
    }
    haptics.success();
    setName(null);
  };

  const signOut = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: signOutQuestion(changed),
        message: user?.email ? `Signed in as ${user.email}` : undefined,
        options: ['Sign out', 'Cancel'],
        destructiveButtonIndex: 0,
        cancelButtonIndex: 1,
      },
      (index) => {
        if (index === 0) void useAuthStore.getState().signOut();
      },
    );
  };

  // Apple asks for this in the app. One clear confirm, then the server
  // deletes the account and all its data, and the app returns to sign-in.
  const deleteAccount = async () => {
    setDeleting(true);
    setDeleteFailed(false);
    const { error } = await useAuthStore.getState().deleteAccount();
    if (error) {
      setDeleting(false);
      setDeleteFailed(true);
      haptics.error();
      return;
    }
    haptics.success();
    announce('Account deleted');
  };

  const confirmDelete = () => {
    if (deleting) return;
    Keyboard.dismiss();
    Alert.alert(
      'Delete your account?',
      `Your workouts, food log, programs, targets and weigh-ins${user?.email ? ` for ${user.email}` : ''} are deleted for good. This can’t be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <TabScroll keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <Label style={{ marginTop: 12 }}>
          <FieldRow
            label="Name"
            wide
            value={draft}
            placeholder="Your name"
            autoCapitalize="words"
            textContentType="name"
            autoComplete="name"
            returnKeyType="done"
            onSubmitEditing={() => void save()}
            onChangeText={(text) => {
              setMessage(null);
              setName(text);
            }}
          />
        </Label>
        {changed ? (
          <View style={{ marginHorizontal: space.inset, marginTop: 14 }}>
            <Capsule title="Save name" size="large" fill busy={saving} onPress={() => void save()} />
          </View>
        ) : null}
        {message ? <FormNote alert={message.alert}>{message.text}</FormNote> : null}

        {isPreviewActive() ? (
          <FormNote>Sample data: sign-out is off, and nothing here touches an account.</FormNote>
        ) : (
          <>
            <Label style={{ marginTop: space.section }}>
              <Row title="Sign out" destructive accessibilityLabel="Sign out" onPress={signOut} />
            </Label>
            {user?.email ? <FormNote>Signed in as {user.email}</FormNote> : null}
            <Label style={{ marginTop: space.section }}>
              <Row
                title={deleting ? 'Deleting account…' : 'Delete account'}
                destructive
                disabled={deleting}
                accessibilityLabel="Delete account"
                onPress={confirmDelete}
              />
            </Label>
            {deleteFailed ? (
              <FormNote alert>Couldn’t delete your account. Check your connection and try again.</FormNote>
            ) : (
              <FormNote>Deletes your account and everything in it. This can’t be undone.</FormNote>
            )}
          </>
        )}
      </TabScroll>
    </>
  );
}
