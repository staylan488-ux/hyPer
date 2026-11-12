import { Linking, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlancText } from '~/components/BlancText';
import { BrandMark, EMBLEM_MARK_SIZE } from '~/components/BrandMark';
import { Capsule } from '~/components/Capsule';
import { appVersion } from '~/lib/appConfig';
import { appStoreUrl } from '~/lib/links';
import { space, useBlanc } from '~/theme/blanc';

/**
 * The server no longer allows this build (app_config.min_app_version). Nothing
 * else opens until it's updated; what's saved stays on the server. Laid out
 * as the not-on-the-list screen is.
 */
export default function UpdateRequired() {
  const c = useBlanc();
  const insets = useSafeAreaInsets();
  const version = appVersion();
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
          Update hyPer
        </BlancText>
        <BlancText variant="secondary" tone="graphite">
          {`This version${version ? ` (${version})` : ''} no longer works with hyPer’s servers. Update to keep logging. Everything you’ve saved is kept.`}
        </BlancText>
      </View>
      <View style={{ marginHorizontal: space.inset }}>
        <Capsule title="Open the App Store" size="large" fill onPress={() => void Linking.openURL(appStoreUrl()).catch(() => {})} />
      </View>
    </ScrollView>
  );
}
