import { View } from 'react-native';

import { BlancText } from '~/components/BlancText';
import { Capsule } from '~/components/Capsule';
import { Tally } from '~/components/Tally';
import { useSignInInstead } from '~/lib/auth';
import { space } from '~/theme/blanc';

/**
 * A saved session that could not be refreshed for lack of a network. The app
 * waits for the connection instead of asking to sign in again; "Sign in
 * instead" shows sign-in without discarding the saved session.
 */
export default function Offline() {
  const choose = useSignInInstead((state) => state.choose);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, padding: space.gutter }}>
      <Tally marks={[true, true, true, true, true]} current={null} height={22} accessibilityLabel="hyPer" />
      <BlancText variant="secondary" tone="graphite" style={{ textAlign: 'center' }}>
        Offline, waiting for a connection
      </BlancText>
      <Capsule title="Sign in instead" variant="quiet" onPress={choose} style={{ alignSelf: 'center' }} />
    </View>
  );
}
