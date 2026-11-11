import { useState } from 'react';
import { ActionSheetIOS, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '@/stores/authStore';
import { TextLink } from '~/components/AuthForm';
import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { announce } from '~/lib/accessibility';
import { useAppConfigStore } from '~/lib/appConfig';
import { openPage, SUPPORT_URL } from '~/lib/links';
import { haptics } from '~/lib/haptics';
import { space, useBlanc } from '~/theme/blanc';

/**
 * Signed in, and the server clearly says this account is not approved
 * (hyPer is invite-only). Check again asks once more; an approval opens the
 * app at once (authScreen). Sign out also offers deleting the account, which
 * works without approval.
 */
export default function NotApproved() {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const email = useAuthStore((state) => state.user?.email ?? '');
  const [checking, setChecking] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // With sign-up open to everyone, an account here was suspended, not left uninvited.
  const open = useAppConfigStore((state) => state.config?.signupMode === 'open');

  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    await useAuthStore.getState().checkBetaAccess();
    setChecking(false);
    // Approved: the app replaces this screen. Otherwise say the answer is the same.
    if (useAuthStore.getState().betaAccess === 'not-approved') announce('Still not on the list');
  };

  const deleteAccount = async () => {
    setDeleting(true);
    const { error } = await useAuthStore.getState().deleteAccount();
    if (error) {
      setDeleting(false);
      haptics.error();
      Alert.alert('Couldn’t delete your account', 'Check your connection and try again.');
      return;
    }
    haptics.success();
    announce('Account deleted');
  };

  const leave = () => {
    ActionSheetIOS.showActionSheetWithOptions(
      {
        message: email ? `Signed in as ${email}` : undefined,
        options: ['Sign out', 'Delete account', 'Cancel'],
        destructiveButtonIndex: 1,
        cancelButtonIndex: 2,
      },
      (index) => {
        if (index === 0) void useAuthStore.getState().signOut();
        if (index === 1) {
          Alert.alert('Delete your account?', 'The account and anything in it are deleted for good. This can’t be undone.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete account', style: 'destructive', onPress: () => void deleteAccount() },
          ]);
        }
      },
    );
  };

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      style={{ flex: 1, backgroundColor: c.ground }}
      contentContainerStyle={{ paddingTop: insets.top + 44, paddingBottom: insets.bottom + 28 }}>
      <View style={{ paddingHorizontal: space.gutter, alignItems: 'flex-start' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <BrandMark size={EMBLEM_MARK_SIZE} anchor tight />
      </View>
      <View style={{ paddingHorizontal: space.gutter, gap: 10, marginTop: 18, marginBottom: 24 }}>
        <BlancText variant="title" size={34} weight="700" accessibilityRole="header">
          {open ? 'Account paused' : 'Not on the list yet'}
        </BlancText>
        <BlancText variant="secondary" tone="graphite">
          {open
            ? `${email || 'This account'} can’t use hyPer right now. If that seems wrong, contact support.`
            : `hyPer is invite-only for now. Ask for an invite for ${email || 'this email'}, then check again.`}
        </BlancText>
      </View>

      <View style={{ marginHorizontal: space.inset }}>
        <Capsule title="Check again" size="large" fill busy={checking} disabled={deleting} onPress={() => void checkAgain()} />
      </View>

      <View style={{ alignItems: 'center', marginTop: 22, gap: 8 }}>
        {open ? <TextLink title="Contact support" onPress={() => void openPage(SUPPORT_URL)} /> : null}
        <TextLink
          title={deleting ? 'Deleting account…' : 'Sign out'}
          accessibilityHint="Sign out, or delete this account"
          disabled={deleting || checking}
          onPress={leave}
        />
      </View>
    </ScrollView>
  );
}
