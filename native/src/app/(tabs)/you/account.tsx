import { Stack } from 'expo-router';
import { useState } from 'react';
import { ActionSheetIOS, Keyboard, View } from 'react-native';

import { signOutQuestion } from '@/lib/settingsUx';
import { useAuthStore } from '@/stores/authStore';
import { Capsule } from '~/components/Capsule';
import { FieldRow, FormNote } from '~/components/Form';
import { Label } from '~/components/Label';
import { Row } from '~/components/Row';
import { TabScroll } from '~/components/TabScroll';
import { haptics } from '~/lib/haptics';
import { useLeaveGuard } from '~/lib/leaveGuard';
import { isPreviewActive } from '~/platform/previewFlag';
import { space } from '~/theme/blanc';

/** Account: the name the app greets you by, and signing out. */
export default function AccountScreen() {
  const user = useAuthStore((state) => state.user);
  const profile = useAuthStore((state) => state.profile);
  const saved = profile?.display_name || '';
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; alert?: boolean } | null>(null);
  const draft = name ?? saved;
  const changed = draft.trim() !== saved;

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
    setMessage({ text: 'Name saved.' });
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

  return (
    <>
      <Stack.Screen options={{ title: 'Account' }} />
      <TabScroll keyboardShouldPersistTaps="handled">
        <Label style={{ marginTop: 12 }}>
          <FieldRow
            label="Name"
            wide
            value={draft}
            placeholder="Your name"
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
            <Capsule title="Save name" fill busy={saving} onPress={() => void save()} />
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
          </>
        )}
      </TabScroll>
    </>
  );
}
