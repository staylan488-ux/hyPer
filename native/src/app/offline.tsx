import { View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { useAnnounce } from '~/lib/accessibility';
import { useSignInInstead } from '~/lib/auth';
import { space } from '~/theme/blanc';

const STATUS = 'Offline, waiting for a connection';

/**
 * A saved session that could not be refreshed for lack of a network. The app
 * waits for the connection instead of asking to sign in again; "Sign in
 * instead" shows sign-in without discarding the saved session.
 */
export default function Offline() {
  const choose = useSignInInstead((state) => state.choose);
  // VoiceOver starts on the mark; the wait is the news.
  useAnnounce(STATUS);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: space.gutter }}>
      <BrandMark size={EMBLEM_MARK_SIZE} anchor tight style={{ marginBottom: 6 }} />
      <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center' }}>
        {STATUS}
      </BlancText>
      <Capsule title="Sign in instead" variant="quiet" onPress={choose} style={{ alignSelf: 'center' }} />
    </View>
  );
}
